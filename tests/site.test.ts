import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildWeb, origin } from "../scripts/build-web.mjs";
async function fixture(
  run: (root: string, inputDir: string, outputDir: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "aurora-seo-"));
  const inputDir = path.join(root, "dist");
  const outputDir = path.join(root, "web");
  await mkdir(path.join(inputDir, "assets"), { recursive: true });
  await writeFile(
    path.join(inputDir, "index.html"),
    '<!doctype html><html><head><script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"></head><body><div id="root"></div></body></html>',
  );
  await writeFile(path.join(inputDir, "assets/app.js"), "// fixture");
  try {
    await run(root, inputDir, outputDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("web pages expose localized content, self canonicals, reciprocal alternates and visible schema", async () =>
  fixture(async (_, inputDir, outputDir) => {
    await buildWeb({ inputDir, outputDir, production: true });
    const en = await readFile(path.join(outputDir, "index.html"), "utf8");
    const ko = await readFile(path.join(outputDir, "ko/index.html"), "utf8");
    for (const [lang, html, url] of [
      ["en", en, origin + "/"],
      ["ko", ko, origin + "/ko/"],
    ]) {
      assert.ok(html.includes(`<html lang="${lang}">`));
      assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
      assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
      assert.ok(html.includes('hreflang="ko"'));
      assert.ok(html.includes('hreflang="en"'));
      assert.ok(html.includes('hreflang="x-default"'));
      assert.ok(
        html.includes('content="index,follow,max-image-preview:large"'),
      );
      assert.ok(html.includes('id="overview"'));
      const json = html.match(
        /<script type="application\/ld\+json">(.*?)<\/script>/s,
      )![1];
      const schema = JSON.parse(json);
      assert.equal(schema["@type"], "WebPage");
      assert.equal(schema.url, url);
      assert.equal(schema.aggregateRating, undefined);
      assert.ok(
        html.includes(
          `'sha256-${createHash("sha256").update(json).digest("base64")}'`,
        ),
      );
    }
    // The landing pages carry no app; the web version of the app has its own page at /app/.
    const app = await readFile(path.join(outputDir, "app/index.html"), "utf8");
    assert.ok(!en.includes('src="/assets/app.js"'));
    assert.ok(app.includes('src="/assets/app.js"'));
    assert.ok(app.includes('href="/assets/app.css"'));
    assert.ok(en.includes('href="/app/"') && ko.includes('href="/app/"'));
    // Only the app page may connect out, and only to https or this computer.
    assert.ok(en.includes("connect-src 'none'"));
    assert.ok(app.includes("connect-src https: http://127.0.0.1:* http://localhost:*"));
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    // A beta names its base version and says it is a beta; the stable version is named as well.
    const beta = /^(\d+\.\d+\.\d+)-beta\.\d+$/.exec(version);
    assert.ok(
      beta ? en.includes(`The ${beta[1]} beta`) : en.includes(`The public ${version} preview`),
    );
    assert.ok(!ko.includes('src="/assets/app.js"'));
    assert.ok(
      (await readFile(path.join(inputDir, "index.html"), "utf8")).includes(
        'src="./assets/app.js"',
      ),
    );
    const sitemap = await readFile(path.join(outputDir, "sitemap.xml"), "utf8");
    assert.equal((sitemap.match(/<loc>/g) || []).length, 3);
    assert.ok(
      (await readFile(path.join(outputDir, "robots.txt"), "utf8")).includes(
        `Sitemap: ${origin}/sitemap.xml`,
      ),
    );
    assert.ok(
      (await readFile(path.join(outputDir, "404.html"), "utf8")).includes(
        'content="noindex"',
      ),
    );
  }));
test("preview deployments do not invite search indexing", async () =>
  fixture(async (_, inputDir, outputDir) => {
    await buildWeb({ inputDir, outputDir, production: false });
    for (const file of ["index.html", "ko/index.html"]) {
      assert.ok(
        (await readFile(path.join(outputDir, file), "utf8")).includes(
          'content="noindex,nofollow"',
        ),
      );
    }
    assert.equal(
      await readFile(path.join(outputDir, "robots.txt"), "utf8"),
      "User-agent: *\nDisallow: /\n",
    );
  }));

test("Vercel upload retains build dependencies while excluding desktop and private inputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aurora-upload-policy-"));
  try {
    await writeFile(
      path.join(root, ".gitignore"),
      await readFile(new URL("../.vercelignore", import.meta.url)),
    );
    const init = spawnSync("git", [
      "-c",
      "init.templateDir=",
      "init",
      "--quiet",
      root,
    ]);
    assert.equal(init.status, 0);
    for (const file of ["scripts/build-web.mjs", "public/landing.css"]) {
      const result = spawnSync(
        "git",
        [
          "-c",
          "core.excludesfile=/dev/null",
          "check-ignore",
          "--no-index",
          "--quiet",
          file,
        ],
        { cwd: root },
      );
      assert.equal(result.status, 1, `${file} must be uploaded`);
    }
    for (const file of [
      ".github/workflows/release.yml",
      ".github/scripts/check-public-docs.py",
      ".env.local",
      "electron/main.cjs",
      "distribution/Aurora.app",
      "scripts/package.mjs",
    ]) {
      const result = spawnSync(
        "git",
        [
          "-c",
          "core.excludesfile=/dev/null",
          "check-ignore",
          "--no-index",
          "--quiet",
          file,
        ],
        { cwd: root },
      );
      assert.equal(result.status, 0, `${file} must remain excluded`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the desktop sign-in return page only ever hands the code to this computer", async () => {
  const js = await readFile(new URL("../public/desktop-login.js", import.meta.url), "utf8");
  const run = (search: string) => {
    let went = "";
    const els = [{ hidden: false, dataset: { step: "going" } }, { hidden: true, dataset: { step: "failed" } }];
    new Function("location", "document", js)(
      { search, replace: (u: string) => (went = u) },
      { querySelectorAll: () => els, querySelector: () => ({}) },
    );
    return { went, failed: !els[1].hidden };
  };
  // From 0.2.1 the app opens through its own link.
  assert.equal(run("?code=abc&state=xY_-z").went, "pumasi-agent://openrouter?state=xY_-z&code=abc");
  // Apps up to 0.2.0 carry a port after the last dot and wait on 127.0.0.1.
  assert.equal(run("?code=abc&state=xY_-z.51423").went, "http://127.0.0.1:51423/callback?state=xY_-z.51423&code=abc");
  // No state, a port outside the range, or a host smuggled into state: nothing is opened.
  for (const bad of ["?code=abc", "?code=a&state=s.80", "?code=a&state=s.evil.com:8080", "?code=a&state=s.99999", "?code=a&state=a/b", "?code=a&state=x%26y"]) {
    const r = run(bad);
    assert.equal(r.went, "");
    assert.equal(r.failed, true);
  }
});
