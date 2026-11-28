// Writes public/sandbox.html from scripts/sandbox-page.js: the script goes inline and the page's
// policy allows exactly that script by its hash. (A frame with sandbox="allow-scripts" has an
// origin of its own, so 'self' would not let a separate script file load.)
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function sandboxPage() {
  const js = await readFile(new URL("./sandbox-page.js", import.meta.url), "utf8");
  if (js.includes("</script")) throw new Error("sandbox-page.js must not contain a closing script tag");
  const hash = createHash("sha256").update(js).digest("base64");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; worker-src blob:">
<title>Pumasi Agent</title>
</head>
<body><script>${js}</script></body>
</html>
`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()))
  await writeFile(new URL("../public/sandbox.html", import.meta.url), await sandboxPage());
