// Main-process messages in the language the window chose. Same dictionary files as the window.
const EN = Object.assign(
  {},
  require("../src/i18n/en-electron.json"),
  require("../src/i18n/en-domain.json"),
);
let lang = "ko";
function setLang(next) {
  if (next === "ko" || next === "en") lang = next;
}
function tr(ko, vars) {
  const s = lang === "en" ? (EN[ko] ?? ko) : ko;
  return vars
    ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
    : s;
}
module.exports = { tr, setLang, getLang: () => lang };
