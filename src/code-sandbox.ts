// Runs a program a model wrote, shut away from the app: a hidden frame with its own origin and no
// network (public/sandbox.html), made new for each run and removed afterwards.
export type RunResult = { ok: boolean; out: string; error?: string };

const TIMEOUT_MS = 15000;

export function runCode(code: string, timeoutMs = TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // allow-scripts only: the frame gets an origin of its own and cannot reach this page.
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.display = "none";
    const id = crypto.randomUUID();
    const finish = (result: RunResult) => {
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      // Removing the frame also ends a program that is still running.
      frame.remove();
      resolve(result);
    };
    // A little longer than the frame's own limit, in case the frame never loads or answers.
    const timer = setTimeout(() => finish({ ok: false, out: "", error: "timeout" }), timeoutMs + 3000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const d = event.data;
      if (d?.type === "sandbox-ready")
        frame.contentWindow?.postMessage({ type: "run", id, code, timeoutMs }, "*");
      else if (d?.type === "ran" && d.id === id)
        finish({
          ok: d.ok === true,
          out: String(d.out ?? "").slice(0, 8000),
          ...(d.error ? { error: String(d.error).slice(0, 500) } : {}),
        });
    };
    addEventListener("message", onMessage);
    // The page sits at the root of the app, both in the desktop app and on the web.
    frame.src = new URL("/sandbox.html", location.href).href;
    document.body.appendChild(frame);
  });
}
