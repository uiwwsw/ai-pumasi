// Code mode: read and write files inside the one folder the user opened. Nothing outside it.
const fs = require("node:fs");
const path = require("node:path");
const { tr } = require("./i18n.cjs");

function isSecretName(basename) {
  // .env files except .env.example
  if (/^\.env(\..*)?$/.test(basename) && basename !== ".env.example") {
    return true;
  }
  // Private key / certificate extensions
  if (/\.(pem|key|p12|pfx|keystore|jks)$/.test(basename)) {
    return true;
  }
  // SSH private keys - exact prefix match followed by end of string or non-alphanumeric
  if (/^id_(rsa|ed25519)($|[^a-zA-Z0-9])/.test(basename)) {
    return true;
  }
  // Known secret filenames
  if (basename === "credentials.json" || basename === ".npmrc") {
    return true;
  }
  return false;
}

const SKIP = new Set([".git", "node_modules", ".DS_Store", "dist", "build", ".next", ".venv"]);

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function createWorkspace() {
  let allowedRoot = null;

  function validateRel(rel) {
    if (allowedRoot === null) {
      throw new Error(tr("먼저 폴더를 열어 주세요."));
    }
    if (path.isAbsolute(rel)) {
      throw new Error(tr("열어 둔 폴더 밖의 파일은 다룰 수 없습니다."));
    }
    if (rel.includes("\0")) {
      throw new Error(tr("열어 둔 폴더 밖의 파일은 다룰 수 없습니다."));
    }
    const segments = rel.split(/[\\/]/);
    for (const seg of segments) {
      if (seg === "..") {
        throw new Error(tr("열어 둔 폴더 밖의 파일은 다룰 수 없습니다."));
      }
    }
  }

  function checkPathSafety(targetPath, forWrite = false) {
    let checkPath = targetPath;
    if (forWrite && !fs.existsSync(targetPath)) {
      // For write, check the nearest existing parent
      let parent = path.dirname(targetPath);
      while (parent !== allowedRoot && parent !== path.dirname(parent) && !fs.existsSync(parent)) {
        parent = path.dirname(parent);
      }
      checkPath = parent;
    }
    const realTarget = fs.realpathSync(checkPath);
    const realRoot = fs.realpathSync(allowedRoot);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(tr("열어 둔 폴더 밖의 파일은 다룰 수 없습니다."));
    }
  }

  function allow(root) {
    const realRoot = fs.realpathSync(root);
    const stat = fs.statSync(realRoot);
    if (!stat.isDirectory()) {
      throw new Error(tr("디렉터리가 아닙니다."));
    }
    allowedRoot = realRoot;
    return { root: realRoot, name: path.basename(realRoot) };
  }

  function current() {
    if (allowedRoot === null) {
      return null;
    }
    return { root: allowedRoot, name: path.basename(allowedRoot) };
  }

  function list(rel) {
    validateRel(rel);
    const targetPath = path.join(allowedRoot, rel);
    checkPathSafety(targetPath);

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      const name = entry.name;
      if (name === ".git" || name === "node_modules" || name === ".DS_Store") {
        continue;
      }
      const fullPath = path.join(targetPath, name);
      const relPath = path.relative(allowedRoot, fullPath).split(path.sep).join("/");
      result.push({
        path: relPath,
        name,
        dir: entry.isDirectory()
      });
    }

    // Directories first, then files, each sorted by name (localeCompare)
    result.sort((a, b) => {
      if (a.dir !== b.dir) {
        return a.dir ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // At most 2000 entries
    return result.slice(0, 2000);
  }

  function read(rel) {
    validateRel(rel);
    const targetPath = path.join(allowedRoot, rel);
    checkPathSafety(targetPath);

    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      throw new Error(tr("파일이 아닙니다."));
    }

    // Check size limit
    if (stat.size > 1_000_000) {
      throw new Error(tr("파일이 너무 큽니다 (1MB 초과)."));
    }

    // Check for binary (NUL byte in first 8000 bytes)
    const buffer = Buffer.alloc(Math.min(8000, stat.size));
    const fd = fs.openSync(targetPath, "r");
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    if (buffer.includes(0)) {
      throw new Error(tr("바이너리 파일이라 열 수 없습니다."));
    }

    // Check secret name
    const basename = path.basename(targetPath);
    if (isSecretName(basename)) {
      throw new Error(tr("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다."));
    }

    const text = fs.readFileSync(targetPath, "utf8");
    return { path: rel, text, size: stat.size };
  }

  function write(rel, text) {
    if (typeof text !== "string") {
      throw new Error(tr("저장할 내용이 올바르지 않습니다."));
    }
    if (text.length > 2_000_000) {
      throw new Error(tr("저장할 내용이 너무 깁니다."));
    }

    validateRel(rel);
    const targetPath = path.join(allowedRoot, rel);

    // Check secret name
    const basename = path.basename(targetPath);
    if (isSecretName(basename)) {
      throw new Error(tr("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다."));
    }

    // An existing file may be a link to somewhere else: writing would follow it out of the folder.
    if (fs.existsSync(targetPath) || isLink(targetPath)) checkPathSafety(targetPath);
    // Create parent directories
    const parentDir = path.dirname(targetPath);
    if (parentDir !== allowedRoot) {
      checkPathSafety(parentDir, true);
    }
    fs.mkdirSync(parentDir, { recursive: true });

    // Write file
    fs.writeFileSync(targetPath, text, "utf8");

    const stat = fs.statSync(targetPath);
    return { path: rel, size: stat.size };
  }

  /** Delete one file in the folder (used only to undo a file the agent created). */
  function remove(rel) {
    validateRel(rel);
    const targetPath = path.join(allowedRoot, rel);
    if (isSecretName(path.basename(targetPath)))
      throw new Error(tr("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다."));
    if (isLink(targetPath)) throw new Error(tr("열어 둔 폴더 밖의 파일은 다룰 수 없습니다."));
    checkPathSafety(targetPath);
    if (!fs.statSync(targetPath).isFile()) throw new Error(tr("파일이 아닙니다."));
    fs.unlinkSync(targetPath);
  }

  /** Lines containing the text (case-insensitive) in readable files under the folder. */
  function search(query, { maxHits = 100, maxFiles = 5000 } = {}) {
    if (allowedRoot === null) throw new Error(tr("먼저 폴더를 열어 주세요."));
    const q = String(query ?? "").toLowerCase();
    if (!q.trim()) return [];
    const hits = [];
    let files = 0;
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (hits.length >= maxHits || files >= maxFiles) return;
        if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && !isSecretName(e.name)) {
          files++;
          let text;
          try {
            if (fs.statSync(full).size > 1_000_000) continue;
            text = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          if (text.includes("\0")) continue;
          const rel = path.relative(allowedRoot, full).split(path.sep).join("/");
          text.split("\n").forEach((line, i) => {
            if (hits.length < maxHits && line.toLowerCase().includes(q))
              hits.push({ path: rel, line: i + 1, text: line.slice(0, 300) });
          });
        }
      }
    };
    walk(allowedRoot);
    return hits;
  }

  return { allow, current, list, read, write, remove, search };
}

module.exports = { createWorkspace, isSecretName };