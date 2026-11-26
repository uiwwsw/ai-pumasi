import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
// Small expect() over node:assert, so these read like the rest of the suite.
const expect = (actual: any) => ({
  toBe: (v: any) => assert.equal(actual, v),
  toBeNull: () => assert.equal(actual, null),
  toEqual: (v: any) => assert.deepEqual(actual, v),
  toContain: (v: any) => assert.ok(actual.includes(v)),
  toThrow: (msg?: string) =>
    assert.throws(actual, (e: any) => !msg || String(e?.message).includes(msg)),
  not: {
    toContain: (v: any) => assert.ok(!actual.includes(v)),
    toBeNull: () => assert.notEqual(actual, null),
    toThrow: () => assert.doesNotThrow(actual),
  },
});
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const { createWorkspace, isSecretName } = require("../electron/workspace.cjs");

describe("workspace", () => {
  let tempDir: string;
  let workspace: ReturnType<typeof createWorkspace>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    workspace = createWorkspace();
    workspace.allow(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("allow / current", () => {
    it("returns root and name", () => {
      const result = workspace.allow(tempDir);
      expect(result.root).toBe(fs.realpathSync(tempDir));
      expect(result.name).toBe(path.basename(fs.realpathSync(tempDir)));
    });

    it("throws if not a directory", () => {
      const filePath = path.join(tempDir, "not-a-dir.txt");
      fs.writeFileSync(filePath, "hello");
      expect(() => workspace.allow(filePath)).toThrow("디렉터리가 아닙니다");
    });

    it("current returns null before allow", () => {
      const ws = createWorkspace();
      expect(ws.current()).toBeNull();
    });

    it("current returns root after allow", () => {
      const result = workspace.current();
      expect(result).not.toBeNull();
      expect(result?.root).toBe(fs.realpathSync(tempDir));
    });
  });

  describe("list", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, "adir"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "bdir"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "afile.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "bfile.txt"), "b");
      fs.writeFileSync(path.join(tempDir, ".git", "config"), "git");
      fs.writeFileSync(path.join(tempDir, "node_modules", "pkg", "index.js"), "// pkg");
      fs.writeFileSync(path.join(tempDir, ".DS_Store"), "ds");
    });

    it("lists directories first then files, sorted by name", () => {
      const result = workspace.list("");
      const names = result.map((e: any) => e.name);
      // dirs first: adir, bdir, then files: afile.txt, bfile.txt
      expect(names).toEqual(["adir", "bdir", "afile.txt", "bfile.txt"]);
    });

    it("skips .git, node_modules, .DS_Store", () => {
      const result = workspace.list("");
      const names = result.map((e: any) => e.name);
      expect(names).not.toContain(".git");
      expect(names).not.toContain("node_modules");
      expect(names).not.toContain(".DS_Store");
    });

    it("returns relative posix paths", () => {
      const result = workspace.list("");
      const paths = result.map((e: any) => e.path);
      expect(paths).toEqual(["adir", "bdir", "afile.txt", "bfile.txt"]);
    });

    it("throws before allow", () => {
      const ws = createWorkspace();
      expect(() => ws.list("")).toThrow("먼저 폴더를 열어 주세요");
    });

    it("throws for absolute path", () => {
      expect(() => workspace.list("/etc")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with .. segment", () => {
      expect(() => workspace.list("a/../../x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with NUL", () => {
      expect(() => workspace.list("a\0b")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });
  });

  describe("read", () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, "hello.txt"), "hello world");
      fs.writeFileSync(path.join(tempDir, ".env.example"), "EXAMPLE=1");
      fs.writeFileSync(path.join(tempDir, ".env"), "SECRET=1");
      fs.writeFileSync(path.join(tempDir, "secret.key"), "key");
      fs.writeFileSync(path.join(tempDir, "id_rsa"), "private");
      fs.writeFileSync(path.join(tempDir, "credentials.json"), '{"x":1}');
      fs.writeFileSync(path.join(tempDir, ".npmrc"), "//registry");
      // binary file with NUL in first 8000 bytes
      const binary = Buffer.alloc(100);
      binary[50] = 0;
      fs.writeFileSync(path.join(tempDir, "binary.bin"), binary);
      // large file > 1MB
      const large = Buffer.alloc(1_000_001, "x");
      fs.writeFileSync(path.join(tempDir, "large.txt"), large);
    });

    it("reads text file", () => {
      const result = workspace.read("hello.txt");
      expect(result.path).toBe("hello.txt");
      expect(result.text).toBe("hello world");
      expect(result.size).toBe(11);
    });

    it("allows .env.example", () => {
      const result = workspace.read(".env.example");
      expect(result.text).toBe("EXAMPLE=1");
    });

    it("refuses .env", () => {
      expect(() => workspace.read(".env")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
    });

    it("refuses .pem, .key, .p12, .pfx, .keystore, .jks", () => {
      fs.writeFileSync(path.join(tempDir, "test.pem"), "pem");
      fs.writeFileSync(path.join(tempDir, "test.key"), "key");
      fs.writeFileSync(path.join(tempDir, "test.p12"), "p12");
      fs.writeFileSync(path.join(tempDir, "test.pfx"), "pfx");
      fs.writeFileSync(path.join(tempDir, "test.keystore"), "ks");
      fs.writeFileSync(path.join(tempDir, "test.jks"), "jks");

      expect(() => workspace.read("test.pem")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read("test.key")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read("test.p12")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read("test.pfx")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read("test.keystore")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read("test.jks")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
    });

    it("refuses id_rsa and id_ed25519", () => {
      expect(() => workspace.read("id_rsa")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      fs.writeFileSync(path.join(tempDir, "id_ed25519"), "key");
      expect(() => workspace.read("id_ed25519")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
    });

    it("refuses credentials.json and .npmrc", () => {
      expect(() => workspace.read("credentials.json")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.read(".npmrc")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
    });

    it("refuses binary file (NUL in first 8000 bytes)", () => {
      expect(() => workspace.read("binary.bin")).toThrow("바이너리 파일이라 열 수 없습니다");
    });

    it("refuses file larger than 1MB", () => {
      expect(() => workspace.read("large.txt")).toThrow("파일이 너무 큽니다");
    });

    it("throws before allow", () => {
      const ws = createWorkspace();
      expect(() => ws.read("hello.txt")).toThrow("먼저 폴더를 열어 주세요");
    });

    it("throws for absolute path", () => {
      expect(() => workspace.read("/etc/passwd")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with ..", () => {
      expect(() => workspace.read("../x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with NUL", () => {
      expect(() => workspace.read("a\0b")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("rejects symlink pointing outside root", () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
      fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
      const linkPath = path.join(tempDir, "link.txt");
      fs.symlinkSync(path.join(outside, "secret.txt"), linkPath);
      expect(() => workspace.read("link.txt")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
      fs.rmSync(outside, { recursive: true, force: true });
    });
  });

  describe("write", () => {
    it("creates nested directories", () => {
      const result = workspace.write("a/b/c.txt", "hello");
      expect(result.path).toBe("a/b/c.txt");
      expect(result.size).toBe(5);
      expect(fs.readFileSync(path.join(tempDir, "a/b/c.txt"), "utf8")).toBe("hello");
    });

    it("refuses secret filenames", () => {
      expect(() => workspace.write(".env", "x")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.write("secret.key", "x")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.write("id_rsa", "x")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.write("credentials.json", "x")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
      expect(() => workspace.write(".npmrc", "x")).toThrow("비밀 정보가 들어 있을 수 있는 파일이라 열지 않습니다");
    });

    it("allows .env.example", () => {
      const result = workspace.write(".env.example", "EXAMPLE=1");
      expect(result.path).toBe(".env.example");
    });

    it("throws if text > 2M chars", () => {
      const large = "x".repeat(2_000_001);
      expect(() => workspace.write("large.txt", large)).toThrow("저장할 내용이 너무 깁니다");
    });

    it("throws before allow", () => {
      const ws = createWorkspace();
      expect(() => ws.write("x.txt", "x")).toThrow("먼저 폴더를 열어 주세요");
    });

    it("throws for absolute path", () => {
      expect(() => workspace.write("/etc/passwd", "x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with ..", () => {
      expect(() => workspace.write("a/../../x", "x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("throws for path with NUL", () => {
      expect(() => workspace.write("a\0b", "x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
    });

    it("rejects symlink parent pointing outside root", () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
      const linkDir = path.join(tempDir, "linkdir");
      fs.symlinkSync(outside, linkDir);
      expect(() => workspace.write("linkdir/file.txt", "x")).toThrow("열어 둔 폴더 밖의 파일은 다룰 수 없습니다");
      fs.rmSync(outside, { recursive: true, force: true });
    });
  });

  describe("isSecretName", () => {
    it("returns true for secret patterns", () => {
      expect(isSecretName(".env")).toBe(true);
      expect(isSecretName(".env.local")).toBe(true);
      expect(isSecretName(".env.production")).toBe(true);
      expect(isSecretName("test.pem")).toBe(true);
      expect(isSecretName("test.key")).toBe(true);
      expect(isSecretName("test.p12")).toBe(true);
      expect(isSecretName("test.pfx")).toBe(true);
      expect(isSecretName("test.keystore")).toBe(true);
      expect(isSecretName("test.jks")).toBe(true);
      expect(isSecretName("id_rsa")).toBe(true);
      expect(isSecretName("id_ed25519")).toBe(true);
      expect(isSecretName("id_rsa.pub")).toBe(true);
      expect(isSecretName("id_rsa_backup")).toBe(true);
      expect(isSecretName("credentials.json")).toBe(true);
      expect(isSecretName(".npmrc")).toBe(true);
    });

    it("returns false for non-secret names", () => {
      expect(isSecretName(".env.example")).toBe(false);
      expect(isSecretName("config.env")).toBe(false);
      expect(isSecretName("test.txt")).toBe(false);
      expect(isSecretName("my_credentials.json")).toBe(false);
    });
  });
});
describe("write through links", () => {
  it("refuses to write through a link that points outside the folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ws-out-"));
    fs.writeFileSync(path.join(outside, "target.txt"), "keep");
    fs.symlinkSync(path.join(outside, "target.txt"), path.join(root, "link.txt"));
    const ws = createWorkspace();
    ws.allow(root);
    assert.throws(() => ws.write("link.txt", "overwritten"), /폴더 밖/);
    assert.equal(fs.readFileSync(path.join(outside, "target.txt"), "utf8"), "keep");
    assert.throws(() => ws.read("a\\..\\..\\x"), /폴더 밖/);
  });
});
