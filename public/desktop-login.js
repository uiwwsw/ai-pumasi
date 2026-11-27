// The desktop app's OpenRouter sign-in comes back here, and this page only sends the browser on to
// the app waiting on this computer. The port is the number after the last dot of `state`. It goes
// to 127.0.0.1 and nowhere else, so this page cannot be used to redirect to another site.
(() => {
  const q = new URLSearchParams(location.search);
  const state = q.get("state") || "";
  const port = Number(state.slice(state.lastIndexOf(".") + 1));
  const ok = Number.isInteger(port) && port >= 1024 && port <= 65535;
  const show = (id) => {
    for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== id;
  };
  if (!ok) return show("failed");
  const back = new URLSearchParams({ state });
  if (q.get("code")) back.set("code", q.get("code"));
  const url = `http://127.0.0.1:${port}/callback?${back}`;
  document.querySelector("[data-continue]").href = url;
  show("going");
  location.replace(url);
})();
