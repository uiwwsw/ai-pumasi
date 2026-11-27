// "Start with OpenRouter" on the desktop: listen once on localhost, open the sign-in page in the
// browser, and turn the returned code into the user's key.
//
// OpenRouter names the app on its approval screen after the callback address, so a localhost
// callback reads "localhost:51423" to the user. The callback is therefore a page on our site,
// which does nothing but send the browser on to this computer (public/desktop-login.js). The port
// rides in `state`. The code that passes through that page is useless without the verifier, which
// never leaves this app.
const http = require("node:http");
const providers = require("./providers.cjs");
const { tr } = require("./i18n.cjs");

const WAIT_MS = 10 * 60 * 1000; // the code itself expires after 10 minutes
const RETURN_PAGE = "https://pumasi-agent.vercel.app/desktop-login/";

const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Pumasi Agent</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#faf9f6;color:#34342f;display:grid;place-items:center;height:100vh;margin:0}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#65665c;font-size:14px;line-height:1.6;margin:0}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

/**
 * Run one sign-in. Resolves to the key; rejects on cancel, timeout or a failed exchange.
 * `open(url)` shows the sign-in page in the user's browser. Returns {promise, cancel}.
 */
function startLogin({ open, fetchImpl = fetch, waitMs = WAIT_MS }) {
  let finish;
  let done = false;
  const servers = [];
  // Stop listening and drop any kept-alive browser connection, so nothing stays open.
  const close = () =>
    servers.forEach((s) => {
      s.close();
      s.closeAllConnections?.();
    });
  const promise = new Promise((resolve, reject) => {
    finish = (error, key) => {
      done = true;
      clearTimeout(timer);
      close();
      error ? reject(error) : resolve(key);
      finish = () => {};
    };
    const timer = setTimeout(
      () => finish(new Error(tr("OpenRouter 로그인을 기다리다 시간이 지났습니다. 다시 시도해 주세요."))),
      waitMs,
    );
    (async () => {
      const pkce = await providers.openRouterPkce();
      let state = pkce.state;
      const handler = async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        // A callback that does not carry our state was not started by this sign-in.
        if (!code || url.searchParams.get("state") !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page(tr("로그인을 마치지 못했습니다"), tr("Pumasi Agent로 돌아가 다시 시도해 주세요.")));
          if (!code) finish(new Error(tr("OpenRouter 로그인이 취소되었습니다.")));
          return;
        }
        try {
          const key = await providers.openRouterExchange(code, pkce.verifier, fetchImpl);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page(tr("로그인했습니다"), tr("이 창을 닫고 Pumasi Agent로 돌아가세요.")));
          finish(null, key);
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page(tr("로그인을 마치지 못했습니다"), tr("Pumasi Agent로 돌아가 다시 시도해 주세요.")));
          finish(error);
        }
      };
      // "localhost" may resolve to IPv4 or IPv6 in the browser: answer on both, same port.
      const v4 = http.createServer(handler);
      servers.push(v4);
      await new Promise((ok, fail) => v4.once("error", fail).listen(0, "127.0.0.1", ok));
      const port = v4.address().port;
      const v6 = http.createServer(handler);
      v6.on("error", () => {});
      servers.push(v6);
      v6.listen(port, "::1");
      // Cancelled or timed out while the servers were starting: shut them again.
      if (done) return close();
      state = `${pkce.state}.${port}`;
      await open(
        providers.openRouterAuthUrl({
          callbackUrl: RETURN_PAGE,
          challenge: pkce.challenge,
          state,
        }),
      );
    })().catch((error) => finish(error));
  });
  return {
    promise,
    cancel: () => finish(new Error(tr("OpenRouter 로그인을 취소했습니다."))),
  };
}

module.exports = { startLogin };
