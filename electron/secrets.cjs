// Write-only API key vault for the main process.
// Values are encrypted with the OS keychain (Electron safeStorage) and decrypted only in the main
// process at request time. Nothing here returns a stored value: not to the window, not to a model,
// not to a log. Callers can learn whether a key is set and when it was saved, nothing more.
const fs = require("node:fs");
const path = require("node:path");

// The only names the window may write. Anything else is rejected.
const SECRET_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "AURORA_OPENAI_COMPAT_KEY",
];
// Not secret, but tied to the compat key: changing it removes the key so a hijacked window
// cannot point the saved key at another server.
const URL_NAME = "AURORA_OPENAI_COMPAT_URL";

function checkValue(value) {
  if (typeof value !== "string") throw new Error("키 형식이 올바르지 않습니다.");
  const v = value.trim();
  if (v.length < 8 || v.length > 512 || !/^[\x21-\x7e]+$/.test(v))
    throw new Error("키는 공백 없는 8~512자 영문·숫자·기호여야 합니다.");
  return v;
}

function checkUrl(value) {
  if (typeof value !== "string" || value.length > 512)
    throw new Error("주소 형식이 올바르지 않습니다.");
  const v = value.trim();
  if (!v) return "";
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new Error("주소 형식이 올바르지 않습니다.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local)))
    throw new Error("https 주소이거나 이 기기(127.0.0.1·localhost) 주소여야 합니다.");
  if (url.username || url.password)
    throw new Error("주소에 계정 정보를 넣지 마세요. 키는 키 칸에 따로 넣으세요.");
  return url.href;
}

/**
 * @param {{file:string, safeStorage:{isEncryptionAvailable():boolean, encryptString(s:string):Buffer, decryptString(b:Buffer):string}, now?:()=>number}} opts
 */
function createSecretStore({ file, safeStorage, now = Date.now }) {
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  };
  const write = (data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
  };
  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  };

  return {
    /** Only whether each key is set, when it was saved, and the compat URL (not secret). */
    list() {
      const data = read();
      const keys = {};
      for (const name of SECRET_NAMES) {
        const entry = data.keys?.[name];
        keys[name] = entry ? { set: true, savedAt: entry.savedAt ?? null } : { set: false };
      }
      return { encryption: available(), keys, compatUrl: data.compatUrl ?? "" };
    },
    set(name, value) {
      if (!SECRET_NAMES.includes(name)) throw new Error("저장할 수 없는 키 이름입니다.");
      const v = checkValue(value);
      // Never fall back to plain text. Without the OS keychain, saving is refused.
      if (!available())
        throw new Error("이 기기에서 키를 암호화할 수 없어 저장하지 않았습니다.");
      const data = read();
      data.keys = { ...(data.keys ?? {}) };
      data.keys[name] = {
        enc: safeStorage.encryptString(v).toString("base64"),
        savedAt: new Date(now()).toISOString(),
      };
      write(data);
      return this.list();
    },
    remove(name) {
      if (!SECRET_NAMES.includes(name)) throw new Error("지울 수 없는 키 이름입니다.");
      const data = read();
      if (data.keys?.[name]) {
        data.keys = { ...data.keys };
        delete data.keys[name];
        write(data);
      }
      return this.list();
    },
    setCompatUrl(value) {
      const url = checkUrl(value);
      const data = read();
      if ((data.compatUrl ?? "") !== url) {
        data.compatUrl = url;
        if (data.keys?.AURORA_OPENAI_COMPAT_KEY) {
          data.keys = { ...data.keys };
          delete data.keys.AURORA_OPENAI_COMPAT_KEY;
        }
        write(data);
      }
      return this.list();
    },
    /**
     * Main process only: process env plus decrypted saved keys, for one provider call.
     * Saved values win over the environment. A key that no longer decrypts is skipped.
     */
    env(base = process.env) {
      const data = read();
      const out = { ...base };
      if (data.compatUrl) out[URL_NAME] = data.compatUrl;
      if (!available()) return out;
      for (const name of SECRET_NAMES) {
        const entry = data.keys?.[name];
        if (!entry?.enc) continue;
        try {
          out[name] = safeStorage.decryptString(Buffer.from(entry.enc, "base64"));
        } catch {}
      }
      return out;
    },
  };
}

/** Replace every secret value (and anything key-shaped) in text that may reach the window. */
// `patterns: false` replaces only the exact saved values, for model answers that may quote example keys.
function redact(text, env, { patterns = true } = {}) {
  let s = String(text ?? "");
  for (const name of SECRET_NAMES) {
    const v = env?.[name];
    if (typeof v === "string" && v.length >= 8) s = s.split(v).join("[키 숨김]");
  }
  if (!patterns) return s;
  return s
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, "[키 숨김]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[키 숨김]")
    .replace(/\bnvapi-[A-Za-z0-9_-]{8,}/g, "[키 숨김]")
    .replace(/\b(gsk|xai)_[A-Za-z0-9]{8,}/g, "[키 숨김]")
    .replace(/(Bearer\s+)[^\s"']{8,}/gi, "$1[키 숨김]");
}

module.exports = { createSecretStore, redact, SECRET_NAMES, URL_NAME };
