import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// @ts-expect-error plain script without types
import { sandboxPage } from "../scripts/build-sandbox.mjs";

test("the sandbox page is the generated one and allows nothing but its own script", async () => {
  const page = await readFile(new URL("../public/sandbox.html", import.meta.url), "utf8");
  // Edit scripts/sandbox-page.js, then run: node scripts/build-sandbox.mjs
  assert.equal(page, await sandboxPage());
  const script = /<script>([\s\S]*)<\/script>/.exec(page)![1];
  const hash = createHash("sha256").update(script).digest("base64");
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(page)![1];
  assert.equal(csp, `default-src 'none'; script-src 'sha256-${hash}'; worker-src blob:`);
  // No network of any kind: nothing in the policy names a host, 'self' or a scheme other than blob.
  assert.ok(!/connect-src|https?:|'self'|\*|unsafe/.test(csp));
});
