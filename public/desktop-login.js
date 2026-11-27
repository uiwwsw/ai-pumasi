// The desktop app's OpenRouter sign-in comes back here, and this page only hands the code on to
// the app on this computer. From 0.2.1 it opens the app's own link, pumasi-agent://openrouter,
// which the browser asks to open in Pumasi Agent. Apps up to 0.2.0 put a port after the last dot
// of `state` and wait on 127.0.0.1; those still go there. Either way the code goes to this
// computer and nowhere else, so this page cannot be used to redirect to another site.
(() => {
  const q = new URLSearchParams(location.search);
  const state = q.get("state") || "";
  const show = (id) => {
    for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== id;
  };
  if (!/^[\w-]+(\.\d+)?$/.test(state)) return show("failed");
  const back = new URLSearchParams({ state });
  if (q.get("code")) back.set("code", q.get("code"));
  const dot = state.lastIndexOf(".");
  let url = `pumasi-agent://openrouter?${back}`;
  if (dot >= 0) {
    const port = Number(state.slice(dot + 1));
    if (!(Number.isInteger(port) && port >= 1024 && port <= 65535)) return show("failed");
    url = `http://127.0.0.1:${port}/callback?${back}`;
  }
  document.querySelector("[data-continue]").href = url;
  show("going");
  location.replace(url);
})();
