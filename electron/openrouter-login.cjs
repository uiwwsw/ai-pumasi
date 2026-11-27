// "Start with OpenRouter" on the desktop: open the sign-in page in the browser and turn the
// returned code into the user's key.
//
// OpenRouter names the app on its approval screen after the callback address, so the callback is
// a page on our site (public/desktop-login.js). That page hands the code to this app through the
// app's own link, pumasi-agent://openrouter?code=…&state=…, which the browser asks to open in
// Pumasi Agent. An earlier version sent the browser on to a port on 127.0.0.1 instead; some
// browsers block a public page from opening a local address, and the user was left on that page.
// The code is useless without the verifier, which never leaves this app.
const providers = require("./providers.cjs");
const { tr } = require("./i18n.cjs");

const WAIT_MS = 10 * 60 * 1000; // the code itself expires after 10 minutes
const RETURN_PAGE = "https://pumasi-agent.vercel.app/desktop-login/";
const SCHEME = "pumasi-agent";

/**
 * Run one sign-in. Resolves to the key; rejects on cancel, timeout or a failed exchange.
 * `open(url)` shows the sign-in page in the user's browser. Returns {promise, cancel, receive}.
 * `receive(link)` takes a pumasi-agent:// link the system handed to the app and returns true when
 * it belonged to this sign-in.
 */
function startLogin({ open, fetchImpl = fetch, waitMs = WAIT_MS }) {
  let finish;
  let pkce = null;
  let busy = false;
  const promise = new Promise((resolve, reject) => {
    finish = (error, key) => {
      clearTimeout(timer);
      error ? reject(error) : resolve(key);
      finish = () => {};
    };
    const timer = setTimeout(
      () => finish(new Error(tr("OpenRouter 로그인을 기다리다 시간이 지났습니다. 다시 시도해 주세요."))),
      waitMs,
    );
    (async () => {
      const p = await providers.openRouterPkce();
      pkce = p;
      await open(
        providers.openRouterAuthUrl({ callbackUrl: RETURN_PAGE, challenge: p.challenge, state: p.state }),
      );
    })().catch((error) => finish(error));
  });
  const receive = (link) => {
    let url;
    try {
      url = new URL(String(link));
    } catch {
      return false;
    }
    if (url.protocol !== `${SCHEME}:` || url.hostname !== "openrouter") return false;
    // A link that does not carry our state was not started by this sign-in.
    if (!pkce || busy || url.searchParams.get("state") !== pkce.state) return false;
    const code = url.searchParams.get("code");
    if (!code) {
      finish(new Error(tr("OpenRouter 로그인이 취소되었습니다.")));
      return true;
    }
    busy = true;
    providers
      .openRouterExchange(code, pkce.verifier, fetchImpl)
      .then((key) => finish(null, key), (error) => finish(error));
    return true;
  };
  return {
    promise,
    cancel: () => finish(new Error(tr("OpenRouter 로그인을 취소했습니다."))),
    receive,
  };
}

module.exports = { startLogin, SCHEME };
