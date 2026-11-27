import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export const origin = "https://pumasi-agent.vercel.app";
// One download link for everyone: yatko.app picks the installer for the visitor's platform from the
// latest GitHub release (public/download.js narrows it to this computer). All versions: GitHub.
const download = "https://yatko.app/uiwwsw/pumasi-agent";
const release = "https://github.com/uiwwsw/pumasi-agent/releases";
const repo = "https://github.com/uiwwsw/pumasi-agent";
const verification =
  '<meta name="google-site-verification" content="b7vKjUgQjabMbz1oYHEAqD3DvJJexV7WSpJPxTTTs_c"><meta name="naver-site-verification" content="5ffb0ec5bd027c7691da31041883a09b2fb98892">';
const translations = {
  "ko": {
    "title": "Pumasi Agent — 무료 AI가 팀으로 일하는 앱",
    "description": "Pumasi Agent는 리더 모델이 일을 나누고 무료 모델이 처리하는 앱입니다. 웹에서 바로 쓰거나 macOS·Windows에 설치합니다. 손이 더 필요하면 다른 사용자가 자기 무료 키로 작업을 거들어 줍니다.",
    "heading": "무료 AI가 팀으로 일합니다.",
    "intro": "Pumasi Agent는 요청을 작업 여러 개로 나눕니다. 리더 모델이 계획하고 승인하며 작업은 무료 모델이 합니다. Pitch in을 켜면 다른 사용자가 자기 무료 키로 작업 하나를 대신 처리해 주고, 작업 글과 결과는 암호화되어 서버도 돕는 사람도 읽을 수 없습니다. 무료 한도에 걸리면 다음 제공자로 넘어갑니다. 이 페이지의 웹에서도 바로 쓸 수 있고, 키는 그 브라우저에만 저장됩니다.",
    "demo": "웹에서 쓰기",
    "allDownloads": "다른 버전·전체 목록 (GitHub)",
    "overview": "제품 소개",
    "download": "데스크톱 다운로드",
    "language": "English",
    "other": "/",
    "features": [
      [
        "일은 나누고, 돈은 아낍니다",
        "팀 모드는 요청 하나를 작업 최대 6개로 나눕니다. 리더가 계획하고 승인하며 작업과 합치기는 무료 모델이 합니다. 리더도 무료로 둘 수 있고, 유료 리더는 계획과 승인에만 토큰을 씁니다."
      ],
      [
        "문제를 나눕니다",
        "토큰을 한곳에 모아 나눠 주는 대신 문제를 공유합니다. 돕는 사람이 자기 키로 풀어 결과만 돌려주니, 가운데에서 오남용될 곳이 없습니다. 지금은 작업 하나를 다른 사용자의 앱이 맡는 첫 단계이고, 사람이 역할을 맡는 부분은 함께 만들 기여자를 모으고 있습니다."
      ],
      [
        "무료 모델도 충분히 셉니다",
        "여기서 쓸 수 있는 무료 모델 Nemotron 3.5 Super가 프로그램 채점 시험 세 개에서 30/30, 28/30, 23/25를 받았습니다. ChatGPT 무료는 23, 24, 13.4였습니다."
      ],
      [
        "키는 내 기기에만",
        "API 키는 OS 키체인으로 암호화해 저장하고 다시 보여 주지 않으며, 모델 답과 오류 메시지에서도 가립니다. 유료 키는 빌려주지 않습니다."
      ]
    ],
    "questions": [
      [
        "웹과 설치 앱은 무엇이 다른가요?",
        "웹에서도 채팅과 팀 모드를 그대로 씁니다. 설정에 넣은 키는 그 브라우저에만 저장되고, 질문은 브라우저에서 각 AI 회사로 바로 갑니다. 우리 서버는 거치지 않습니다. NVIDIA는 브라우저 호출을 막아서, 웹에서는 같은 Nemotron 모델을 OpenRouter 키로 씁니다. 코드 모드(폴더의 파일 읽고 고치기)와 Pitch in은 설치 앱에서만 됩니다."
      ],
      [
        "정말 무료 모델로 충분한가요?",
        "질문에 따라 다릅니다. 직접 만든 추론 시험과 AIME 2026에서 Nemotron 3.5 Super 혼자서 ChatGPT 무료보다 높았습니다. 같은 질문을 여러 모델에 묻고 투표하는 방식은 Super 혼자보다 점수가 높지 않고 토큰이 여러 배 들어 없앴습니다. 측정 방법과 원자료는 저장소의 측정 기록에 있습니다."
      ],
      [
        "키는 어디에 저장되나요?",
        "현재 기기의 OS 키체인으로 암호화해 저장합니다. 저장한 키는 다시 화면에 보여 주지 않고, 모델에게 보내는 글과 결과에서도 가립니다."
      ],
      [
        "대화는 어디에 저장되나요?",
        "대화 저장은 기본 꺼짐입니다. 켜면 현재 기기에만 기록합니다. 웹에서는 그 브라우저에 저장합니다."
      ],
      [
        "설치 앱 업데이트와 보안 경고는 어떻게 되나요?",
        "macOS 설치 파일은 Developer ID 서명과 Apple 공증을 거쳤고 자동 업데이트를 지원합니다. Windows 설치 파일은 개발자 인증서로 서명하지 않아 처음 실행할 때 보안 확인이 나타날 수 있습니다. 0.1.8까지 Aurora라는 이름으로 쓰던 대화와 설정은 그대로 이어집니다."
      ]
    ],
    "featureTitle": "Pumasi Agent에서 할 수 있는 일",
    "faq": "자주 묻는 질문",
    "limitations": "개발 프리뷰의 범위",
    "limitation": "코드 모드는 베타입니다. 연 폴더의 파일을 읽고, 승인한 뒤에만 고치거나 명령을 실행합니다. Pitch in은 미리보기 동안 초대제입니다. 개인이 만드는 개발 프리뷰이며, 측정 결과는 공개한 시험에 대한 것입니다.",
    "browser": "웹에서 쓰기 · 키는 이 브라우저에만",
    "open": "웹에서 바로 쓰기",
    "source": "소스와 문서",
    "guide": "영어 README",
    "links": "설치 파일 · 변경 기록 · MIT 라이선스",
    "nojs": "웹 버전은 JavaScript가 필요합니다. 설치 앱은 아래 다운로드 링크에서 받을 수 있습니다."
  },
  "en": {
    "title": "Pumasi Agent: free AI models, working as a team",
    "description": "Pumasi Agent is an app, on the web or installed on macOS and Windows, where a lead model splits the job and free models do the work. When you need more hands, other users can take a task with their own free keys. A free model you can run here outscored ChatGPT's free tier on three program-graded exams.",
    "heading": "Free AI models, working as a team.",
    "intro": "Pumasi Agent splits a request into tasks. A lead model plans and signs off, free models do the work, and with Pumasi other users can take a task off your hands with their own free keys, sealed so that neither the relay nor the helper can read it. When a free tier runs dry, the request moves to the next provider. You can use it on the web too; your keys stay in that browser.",
    "demo": "Use on the web",
    "allDownloads": "Other versions (GitHub)",
    "overview": "Overview",
    "download": "Download desktop app",
    "language": "한국어",
    "other": "/ko/",
    "features": [
      [
        "Split the work, not the bill",
        "Team mode turns one request into up to six tasks. A lead plans and signs off, free models do the tasks and merge them. The lead can be free, or a paid model that spends tokens only on planning and approval."
      ],
      [
        "Share the problem",
        "Instead of pooling tokens in one place, you share the problem. A helper solves it with their own key and sends back the result, so there is no central pool to abuse. Today another user's app can take one task; the part where people take roles is still an idea, and we're looking for contributors."
      ],
      [
        "Free models that hold their own",
        "Nemotron 3.5 Super, a free model you can run here, scored 30/30, 28/30 and 23/25 on three program-graded exams. ChatGPT free scored 23, 24 and 13.4."
      ],
      [
        "Keys stay on your machine",
        "API keys are encrypted with the OS keychain, never displayed again, and masked out of answers and error messages. Paid keys are never lent."
      ]
    ],
    "questions": [
      [
        "How is the web version different from the desktop app?",
        "Chat and team mode work the same. Keys you add are stored in that browser only, and your questions go from the browser straight to each AI provider, never through our server. NVIDIA blocks calls from web pages, so on the web the same Nemotron models run through an OpenRouter key. Code mode (reading and editing files in a folder) and Pitch in need the desktop app."
      ],
      [
        "Are free models really enough?",
        "For a lot of questions, yes. On our reasoning exam and AIME 2026, Nemotron 3.5 Super alone beat ChatGPT free. Asking several models the same question and voting did not score higher than Super alone and cost several times the tokens, so it was removed. Methods and raw data are in the repository."
      ],
      [
        "Who can read a task I hand to Pumasi?",
        "The helper's AI model and its provider. The relay can't, and the helper's screen shows only a token count. Because a stranger's model reads it, the app refuses to post text that looks like an email, a phone number or a key."
      ],
      [
        "Where are my keys and conversations stored?",
        "On this device. Keys are encrypted with the OS keychain. Saving conversations is off by default."
      ],
      [
        "How do updates and installation warnings work?",
        "macOS builds are signed with a Developer ID, notarized by Apple and update automatically. The Windows installer is not signed with a developer certificate, so a security prompt may appear the first time."
      ]
    ],
    "featureTitle": "Why it's different",
    "faq": "Frequently asked questions",
    "limitations": "Developer preview limitations",
    "limitation": "The public 0.2.0 preview has code mode as a beta: it reads files in a folder you open and edits them or runs commands only after you approve. Pitch in is invite-only during the preview. Built by one person; the measurements cover the published exams only.",
    "browser": "Use it on the web · keys stay in this browser",
    "open": "Use it on the web",
    "source": "Source and documentation",
    "guide": "English README",
    "links": "Installers · Changelog · MIT license",
    "nojs": "The web version needs JavaScript. The desktop app is in the downloads below."
  }
};
// English is the main page at "/"; Korean lives at "/ko/". The app itself is at "/app/".
const MAIN = "en";
const pathOf = (lang) => (lang === MAIN ? "/" : `/${lang}/`);
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function landingHero(lang) {
  const en = lang === "en";
  return `<section class="landing-hero" aria-label="${en ? "Meet Pumasi Agent" : "Pumasi Agent 소개"}"><div class="hero-orbit" aria-hidden="true"><i></i><i></i><i></i></div><div class="hero-copy"><p class="hero-kicker"><span></span> PUMASI AGENT · DEVELOPER PREVIEW</p><p class="hero-title">${en ? "Free AI models,<br>working as a team." : "무료 AI가<br>팀으로 일합니다."}</p><p class="hero-description">${en ? "A lead splits the job, free models do it.<br>Other users can lend a hand." : "리더가 일을 나누고 무료 모델이 처리합니다.<br>다른 사용자가 손을 보탤 수도 있습니다."}</p><div class="hero-actions"><a class="hero-primary" data-download href="${download}"><span aria-hidden="true">↓</span> ${en ? "Download Pumasi Agent" : "Pumasi Agent 다운로드"}</a><a class="hero-secondary" href="/app/">${en ? "Use it on the web" : "웹에서 바로 쓰기"} <span aria-hidden="true">↗</span></a></div><p class="hero-platforms">${en ? "Web" : "웹"} · macOS · Windows <span> / </span> ${en ? "Your keys, straight from your browser to each provider" : "키는 내 브라우저에서 각 회사로 바로 갑니다"} <span> / </span> <a href="${release}">${en ? "Other versions" : "다른 버전"}</a></p></div><div class="hero-workflow" aria-label="${en ? "Workflow" : "작업 흐름"}"><span><b>01</b> ${en ? "Ask once" : "한 번 요청하면"}</span><i aria-hidden="true">→</i><span><b>02</b> ${en ? "The lead splits it into tasks" : "리더가 작업을 나누고"}</span><i aria-hidden="true">→</i><span><b>03</b> ${en ? "Free models, or other users, do them" : "무료 모델이나 다른 사용자가 처리합니다"}</span></div><a class="hero-scroll" href="${lang === MAIN ? "#root" : "#overview"}">${en ? "Explore the workspace" : "작업 공간 살펴보기"} <span aria-hidden="true">↓</span></a></section>`;
}
const styles = `@font-face{font-family:SUITE;src:url('/fonts/SUITE-Variable.woff2') format('woff2');font-weight:100 900;font-display:swap}html{scroll-behavior:smooth}body{margin:0;color:#34342f;background:#faf9f6;font-family:SUITE,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}button,input,select,textarea{font:inherit}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,SUITE,monospace}.site-nav{height:52px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 28px;border-bottom:1px solid #e8e6df;background:#faf9f6}.site-nav nav{display:flex;gap:20px}.site-nav a,.site-content a,.site-footer a{color:#48684c;text-underline-offset:4px}.site-brand{font-weight:750;text-decoration:none}.site-content{max-width:1000px;margin:auto;padding:76px 28px;line-height:1.85}.site-content h1,.site-content h2{line-height:1.3;letter-spacing:-.035em}.site-content h1,.site-content>.site-hero h2{font-size:clamp(30px,4vw,48px);max-width:840px;margin:20px 0}.site-content h2{margin:54px 0 24px;font-size:28px}.site-content h3{font-size:20px;margin:0 0 12px}.site-lead{max-width:800px;color:#65665c;font-size:18px}.site-eyebrow{color:#607b64;font-size:13px;letter-spacing:.08em}.site-actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}.site-actions a{padding:10px 18px;border:1px solid #cdd7c7;border-radius:9px;text-decoration:none}.site-actions a:first-child{background:#607b64;color:#fff}.site-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.site-card,.site-limit{border:1px solid #e8e6df;border-radius:16px;padding:26px;background:#fffefa}.site-card p{margin:0;color:#65665c}.site-content details{border-bottom:1px solid #e8e6df;padding:18px 0}.site-content summary{cursor:pointer;font-weight:650}.site-content details p{color:#65665c}.site-footer{padding:24px 28px;border-top:1px solid #e8e6df;text-align:center;font-size:14px}.site-skip{position:absolute;left:20px;top:-100px;background:#fff;padding:12px;z-index:20}.site-skip:focus{top:5px}.site-notice{padding:16px 28px;color:#65665c}.site-web-demo .app{height:calc(100dvh - 52px)}.site-web-demo .site-content{border-top:1px solid #e8e6df}@media(max-width:680px){.site-nav{padding:0 16px;font-size:13px}.site-nav nav{gap:12px}.site-nav .site-source{display:none}.site-content{padding:48px 20px}.site-grid{grid-template-columns:1fr}.site-content h2{font-size:25px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
function body(lang) {
  const t = translations[lang];
  const tag = lang === MAIN ? "h2" : "h1";
  return `<article class="site-content" id="overview" aria-label="${t.overview}"><header class="site-hero"><p class="site-eyebrow">PUMASI AGENT · DEVELOPER PREVIEW</p><${tag}>${t.heading}</${tag}><p class="site-lead">${t.intro}</p><div class="site-actions"><a href="/app/">${t.open}</a><a data-download href="${download}">${t.download}</a><a href="${release}">${t.allDownloads}</a><a href="${repo}/blob/main/README.md">${t.guide}</a></div></header><section><h2>${t.featureTitle}</h2><div class="site-grid">${t.features.map(([h, p]) => `<section class="site-card"><h3>${h}</h3><p>${p}</p></section>`).join("")}</div></section><section><h2>${t.faq}</h2>${t.questions.map(([q, a]) => `<details open><summary>${q}</summary><p>${a}</p></details>`).join("")}</section><section class="site-limit"><h2>${t.limitations}</h2><p>${t.limitation}</p><a href="${release}">${t.links}</a></section></article>`;
}
function head(lang, production) {
  const t = translations[lang];
  const canonical = origin + pathOf(lang);
  // Only claims visible in the product overview are included. No fabricated ratings or offers.
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t.title,
    alternateName: "Pumasi Agent",
    url: canonical,
    description: t.description,
    isPartOf: {
      "@type": "WebSite",
      name: "Pumasi Agent",
      url: origin + "/",
      inLanguage: ["ko", "en"],
    },
    license: repo + "/blob/main/LICENSE",
    image: origin + "/social-preview.png",
    inLanguage: lang,
    sameAs: [repo],
  });
  const hash = createHash("sha256").update(schema).digest("base64");
  const csp = `default-src 'self'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${t.title}</title><meta name="description" content="${escape(t.description)}"><meta name="robots" content="${production ? "index,follow,max-image-preview:large" : "noindex,nofollow"}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="ko" href="${origin}/ko/"><link rel="alternate" hreflang="en" href="${origin}/"><link rel="alternate" hreflang="x-default" href="${origin}/"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="theme-color" content="#607b64"><meta property="og:type" content="website"><meta property="og:site_name" content="Pumasi Agent"><meta property="og:title" content="${t.title}"><meta property="og:description" content="${escape(t.description)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang === "ko" ? "ko_KR" : "en_US"}"><meta property="og:locale:alternate" content="${lang === "ko" ? "en_US" : "ko_KR"}"><meta property="og:image" content="${origin}/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Pumasi Agent desktop workspace preview"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t.title}"><meta name="twitter:description" content="${escape(t.description)}"><meta name="twitter:image" content="${origin}/social-preview.png">${verification}<script type="application/ld+json">${schema}</script><style>${styles}</style>`;
}
export async function buildWeb({
  inputDir = "dist",
  outputDir = "web-dist",
  production = process.env.VERCEL_ENV !== "preview" &&
    process.env.VERCEL_ENV !== "development",
} = {}) {
  if (path.resolve(inputDir) === path.resolve(outputDir))
    throw new Error("Web output must be separate from desktop output");
  // This directory contains only this script's generated web output.
  await rm(outputDir, { recursive: true, force: true });
  await cp(inputDir, outputDir, { recursive: true });
  const source = await readFile(path.join(inputDir, "index.html"), "utf8");
  const assets = [
    ...source.matchAll(
      /<(?:script\b[^>]*\bsrc=|link\b[^>]*\bhref=)["']([^"']+)["'][^>]*(?:><\/script>|>)/g,
    ),
  ].map((m) => m[0].replaceAll('"./assets/', '"/assets/'));
  for (const lang of ["ko", "en"]) {
    const t = translations[lang];
    const nav = `<a class="site-skip" href="#overview">${t.overview}</a><header class="site-nav"><a class="site-brand" href="/"><img class="site-brand-icon" src="/favicon.svg" width="28" height="28" alt=""> ${lang === "ko" ? "Pumasi Agent" : "Pumasi Agent"}</a><nav aria-label="${t.overview}"><a href="/app/">${t.demo}</a><a class="site-source" href="${repo}">GitHub</a><a href="${t.other}" lang="${lang === "ko" ? "en" : "ko"}" hreflang="${lang === "ko" ? "en" : "ko"}">${t.language}</a></nav></header>`;
    const demo = "";
    const html = `<!doctype html><html lang="${lang}"><head>${head(lang, production)}<link rel="stylesheet" href="/landing.css"><script src="/download.js" defer></script></head><body class="${lang === MAIN ? "site-english" : "site-korean"}">${nav}${landingHero(lang)}${demo}${body(lang)}<footer class="site-footer">Pumasi Agent · <a href="${repo}/blob/main/LICENSE">MIT</a> · <a data-download href="${download}">${t.download}</a> · <a href="${release}">${t.allDownloads}</a></footer></body></html>`;
    const file = path.join(
      outputDir,
      lang === MAIN ? "index.html" : `${lang}/index.html`,
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  // The web version of the app itself: full screen, its own page. It calls AI providers from the
  // browser, so only this page may connect out (https, or a server on this computer).
  const appCsp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'`;
  await mkdir(path.join(outputDir, "app"), { recursive: true });
  await writeFile(
    path.join(outputDir, "app", "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${appCsp}"><title>Pumasi Agent</title><meta name="description" content="Pumasi Agent on the web: free AI models working as a team, with your own keys."><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="theme-color" content="#607b64">${assets.join("")}</head><body><div id="root"></div><noscript>${translations.en.nojs}</noscript></body></html>`,
  );
  // Where the desktop app's OpenRouter sign-in returns. It forwards to the app on this computer
  // and holds nothing itself (see public/desktop-login.js).
  await mkdir(path.join(outputDir, "desktop-login"), { recursive: true });
  await writeFile(
    path.join(outputDir, "desktop-login", "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'"><title>Pumasi Agent</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#faf9f6;color:#34342f;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#65665c;font-size:14px;line-height:1.6;margin:0}a{color:#3c4538}.go{margin-top:20px}.go a{display:inline-block;padding:10px 16px;border-radius:8px;background:#1d6b49;color:#fff;text-decoration:none;font-weight:600}</style><script src="/desktop-login.js" defer></script></head><body><main><div data-step="going"><h1>Signed in to OpenRouter</h1><p>If your browser asks to open Pumasi Agent, choose Open.</p><p>브라우저가 Pumasi Agent를 열지 물으면 열기를 누르세요.</p><p class="go"><a data-continue href="#">Open Pumasi Agent · 앱 열기</a></p></div><div data-step="failed" hidden><h1>Sign-in could not be finished</h1><p>로그인을 마치지 못했습니다. Pumasi Agent로 돌아가 다시 시도해 주세요.</p></div></main></body></html>`,
  );
  const alternate = `<xhtml:link rel="alternate" hreflang="ko" href="${origin}/ko/"/><xhtml:link rel="alternate" hreflang="en" href="${origin}/"/><xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>`;
  await writeFile(
    path.join(outputDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>${origin}/</loc>${alternate}</url><url><loc>${origin}/ko/</loc>${alternate}</url><url><loc>${origin}/app/</loc></url></urlset>`,
  );
  await writeFile(
    path.join(outputDir, "robots.txt"),
    production
      ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
      : `User-agent: *\nDisallow: /\n`,
  );
  await writeFile(
    path.join(outputDir, "404.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page not found — Pumasi Agent</title><style>${styles}</style></head><body><main class="site-content"><h1>Page not found</h1><a href="/">Pumasi Agent</a> · <a href="/en/">English overview</a></main></body></html>`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await buildWeb();
  console.log(
    "Built crawlable Korean and English web pages, sitemap and robots policy.",
  );
}
