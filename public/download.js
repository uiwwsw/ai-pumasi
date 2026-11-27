// One download button: pick this computer's installer and get it through yatko.app, which always
// serves the latest release from GitHub. Without this script the button opens yatko's own page,
// which detects the platform itself.
(async () => {
  const base = "https://yatko.app/dl/uiwwsw/pumasi-agent";
  const ua = navigator.userAgent;
  let href = null;
  if (/Windows/.test(ua)) href = `${base}?platform=windows&arch=amd64`;
  else if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) {
    // Safari reports "Intel" on every Mac, so ask the browser when it can tell; otherwise assume
    // Apple Silicon, which nearly every Mac sold since 2021 has.
    let arch = "arm64";
    try {
      const info = await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]);
      if (info?.architecture === "x86") arch = "amd64";
    } catch {}
    href = `${base}?platform=macos&arch=${arch}&prefer=dmg`;
  }
  if (!href) return;
  for (const a of document.querySelectorAll("a[data-download]")) a.href = href;
})();
