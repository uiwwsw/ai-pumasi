import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export const origin = "https://pumasi-agent.vercel.app";
const release = "https://github.com/uiwwsw/pumasi-agent/releases/tag/v0.1.10";
const repo = "https://github.com/uiwwsw/pumasi-agent";
const verification =
  '<meta name="google-site-verification" content="b7vKjUgQjabMbz1oYHEAqD3DvJJexV7WSpJPxTTTs_c"><meta name="naver-site-verification" content="5ffb0ec5bd027c7691da31041883a09b2fb98892">';
const translations = {
  "ko": {
    "title": "품앗이 에이전트 Pumasi Agent — 무료 AI 여럿이 함께 풀고 투표로 답을 정하는 데스크톱 앱",
    "description": "품앗이 에이전트(Pumasi Agent)는 무료 AI 모델 여럿에게 같은 질문을 풀게 하고 투표로 답을 정하는 macOS·Windows 데스크톱 앱입니다. 유료 총괄 모델이 일을 나누는 팀 모드와 무료 제공자 자동 라우터도 있습니다.",
    "heading": "무료 AI 여럿이 함께 풀고, 투표로 답을 정합니다.",
    "intro": "품앗이 에이전트(Pumasi Agent)는 무료 AI 모델 여럿에게 같은 질문을 풀게 하고, 측정한 실력만큼 무게를 준 투표로 답을 고르는 데스크톱 앱입니다. 결과가 정해지면 남은 모델을 기다리지 않고 바로 확정합니다. NVIDIA·OpenRouter·Groq·Google 무료 키를 넣으면 한도에 걸린 곳을 건너뛰며 자동으로 이어 씁니다. 팀 모드에서는 유료 총괄 모델이 일을 나누고 판정만 하고, 작업은 무료 모델이 합니다. 이 페이지의 웹 데모는 외부 AI 호출 없이 로컬 미리보기로 동작합니다.",
    "demo": "데모로 돌아가기",
    "overview": "제품 소개",
    "download": "데스크톱 다운로드",
    "language": "English",
    "other": "/en/",
    "features": [
      [
        "묶음 투표",
        "무료 모델 2~5개가 같은 질문을 풀고, 측정한 실력만큼 무게를 준 투표로 답을 고릅니다. 남은 모델이 모두 반대해도 결과가 바뀌지 않으면 그 자리에서 확정합니다. 같은 시험에서 무료 묶음이 ChatGPT 무료보다 높은 점수를 받았고, 문항과 채점기는 저장소에 공개했습니다."
      ],
      [
        "무료 제공자 자동 라우터",
        "같은 무료 모델을 여러 제공자가 주면 한도에 걸린 곳은 잠시 쉬게 하고 다른 곳으로 넘깁니다. 자동 (무료) 모델은 지금 쓸 수 있는 무료 모델 중 측정 성적이 높은 것부터 씁니다."
      ],
      [
        "비싼 모델에는 비싼 일만",
        "팀 모드에서 유료 총괄 모델은 일을 작업 1~6개로 나누고 승인 여부만 정합니다. 답을 쓰고 합치는 일은 무료 모델이 하므로 비싼 출력 토큰이 적게 나갑니다."
      ],
      [
        "키는 기기 안에서 잠가 둡니다",
        "API 키는 OS 키체인으로 암호화해 저장하고, 화면·모델·기록 어디에도 다시 나오지 않습니다. 실행 전에 예상 토큰과 예산 대비 비율을, 끝나면 실제 사용량을 보여 줍니다."
      ]
    ],
    "questions": [
      [
        "웹 데모에서 실제 AI를 호출하나요?",
        "아니요. 웹은 화면과 흐름을 체험하는 로컬 미리보기입니다. 실제 AI 연결은 설치 앱의 설정에서 키를 넣어 씁니다."
      ],
      [
        "정말 무료 모델로 충분한가요?",
        "질문에 따라 다릅니다. 직접 만든 추론 시험과 AIME 2026에서 무료 묶음이 ChatGPT 무료보다 높았지만, 여러 모델을 묶어 가장 잘하는 단일 모델을 크게 넘어서는 것은 아직 실험 중입니다. 측정 방법과 원자료는 저장소의 측정 기록에 있습니다."
      ],
      [
        "키는 어디에 저장되나요?",
        "현재 기기의 OS 키체인으로 암호화해 저장합니다. 저장한 키는 다시 화면에 보여 주지 않고, 모델에게 보내는 글과 결과에서도 가립니다."
      ],
      [
        "대화는 어디에 저장되나요?",
        "대화 저장은 기본 꺼짐입니다. 켜면 현재 기기에만 기록합니다. 웹 미리보기는 AI 제공자에게 대화를 보내지 않습니다."
      ],
      [
        "설치 앱 업데이트와 보안 경고는 어떻게 되나요?",
        "macOS 설치 파일은 Developer ID 서명과 Apple 공증을 거쳤고 자동 업데이트를 지원합니다. Windows 설치 파일은 개발자 인증서로 서명하지 않아 처음 실행할 때 보안 확인이 나타날 수 있습니다. 0.1.8까지 Aurora라는 이름으로 쓰던 대화와 설정은 그대로 이어집니다."
      ]
    ],
    "featureTitle": "품앗이 에이전트에서 할 수 있는 일",
    "faq": "자주 묻는 질문",
    "limitations": "개발 프리뷰의 범위",
    "limitation": "공개 0.1.10 프리뷰는 텍스트 답변만 지원하며 파일 수정·셸 실행은 하지 않습니다. 개인이 만드는 개발 프리뷰이며, 측정 결과는 공개한 시험에 대한 것입니다.",
    "browser": "브라우저 데모 · 외부 AI 호출 없음",
    "open": "웹 데모 열기",
    "source": "소스와 문서",
    "guide": "영어 README",
    "links": "설치 파일 · 변경 기록 · MIT 라이선스",
    "nojs": "JavaScript를 켜면 상단에서 대화형 데모를 사용할 수 있습니다. 아래 제품 소개와 다운로드 링크는 JavaScript 없이도 읽을 수 있습니다."
  },
  "en": {
    "title": "Pumasi Agent — Free AI Models That Solve Together and Vote",
    "description": "Pumasi Agent is a macOS and Windows desktop app that asks several free AI models the same question and picks the answer by vote. It also has a team mode where a paid lead model splits the work, and an automatic router across free providers.",
    "heading": "Several free AI models solve together and vote on the answer.",
    "intro": "Pumasi Agent asks several free AI models the same question and picks the answer by a vote weighted by each model's measured skill. Once the result can no longer change, it stops waiting for the rest. Add free keys from NVIDIA, OpenRouter, Groq or Google and it moves past rate-limited providers on its own. In team mode a paid lead model only splits and approves the work while free models do it. The browser demo on this page is a local preview with no external AI calls.",
    "demo": "Open demo",
    "overview": "Overview",
    "download": "Download desktop app",
    "language": "한국어",
    "other": "/",
    "features": [
      [
        "Bundle vote",
        "Two to five free models answer the same question, and a vote weighted by measured skill picks the answer. When the remaining models could not change the outcome, it settles right away. On the same exams the free bundle scored higher than ChatGPT free; questions and graders are public in the repository."
      ],
      [
        "Automatic router for free providers",
        "When several providers serve the same free model, a rate-limited one rests for a while and the request moves to another. The Auto (free) model starts with the best-scoring free model available right now."
      ],
      [
        "Expensive models do only the expensive part",
        "In team mode the paid lead model splits the work into one to six tasks and approves the results. Free models write and merge the answers, so few expensive output tokens are spent."
      ],
      [
        "Keys stay locked on your device",
        "API keys are encrypted with the OS keychain and never shown again, to you, to a model or in a log. You see the estimated tokens and budget share before a run and the actual usage after."
      ]
    ],
    "questions": [
      [
        "Does the browser demo call an AI provider?",
        "No. The web page is a local preview of the interface. Real AI connections use keys you add in the installed app's settings."
      ],
      [
        "Are free models really enough?",
        "It depends on the question. On a fresh reasoning exam and AIME 2026 the free bundle scored higher than ChatGPT free, but beating the best single model by a wide margin is still being tested. Methods and raw data are in the repository's benchmark notes."
      ],
      [
        "Where are my keys stored?",
        "On this device, encrypted with the OS keychain. Saved keys are never displayed again and are masked in anything sent to or returned from a model."
      ],
      [
        "Where is conversation data stored?",
        "Saving conversations is off by default. When on, it stays on this device. The web preview does not send conversations to AI providers."
      ],
      [
        "How do updates and installation warnings work?",
        "The macOS installers are Developer ID signed, notarized by Apple and update automatically. The Windows installer is not signed with a developer certificate, so a security prompt may appear the first time. Conversations and settings from the Aurora versions (up to 0.1.8) carry over."
      ]
    ],
    "featureTitle": "What Pumasi Agent does",
    "faq": "Frequently asked questions",
    "limitations": "Developer preview limitations",
    "limitation": "The public 0.1.10 preview gives text answers only; it does not edit files or run shell commands. It is built by one person, and the measurements cover the published exams only.",
    "browser": "Local browser demo · No external AI calls",
    "open": "Open demo",
    "source": "Source and documentation",
    "guide": "English README",
    "links": "Installers · Changelog · MIT license",
    "nojs": "Enable JavaScript to use the interactive demo. Product information and downloads remain accessible without it."
  }
};
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function landingHero(lang) {
  const en = lang === "en";
  return `<section class="landing-hero" aria-label="${en ? "Meet Pumasi Agent" : "품앗이 에이전트 소개"}"><div class="hero-orbit" aria-hidden="true"><i></i><i></i><i></i></div><div class="hero-copy"><p class="hero-kicker"><span></span> PUMASI AGENT · DEVELOPER PREVIEW</p><p class="hero-title">${en ? "Free AI models,<br>solving together." : "무료 AI 여럿이<br>함께 풉니다."}</p><p class="hero-description">${en ? "They answer the same question<br>and vote on the result." : "같은 질문을 각자 풀고<br>투표로 답을 정합니다."}</p><div class="hero-actions"><a class="hero-primary" href="${release}"><span aria-hidden="true">↓</span> ${en ? "Download Pumasi Agent" : "품앗이 에이전트 다운로드"}</a><a class="hero-secondary" href="${en ? "/#root" : "#root"}">${en ? "Try the demo" : "웹 데모 체험하기"} <span aria-hidden="true">↗</span></a></div><p class="hero-platforms">macOS · Windows <span> / </span> ${en ? "Local web preview · no AI API calls" : "웹은 외부 AI 호출 없는 로컬 미리보기"}</p></div><div class="hero-workflow" aria-label="${en ? "Workflow" : "작업 흐름"}"><span><b>01</b> ${en ? "Ask a question" : "질문하면"}</span><i aria-hidden="true">→</i><span><b>02</b> ${en ? "Free models solve it" : "무료 모델들이 각자 풀고"}</span><i aria-hidden="true">→</i><span><b>03</b> ${en ? "A vote picks the answer" : "투표로 답을 정합니다"}</span></div><a class="hero-scroll" href="${en ? "#overview" : "#root"}">${en ? "Explore the workspace" : "작업 공간 살펴보기"} <span aria-hidden="true">↓</span></a></section>`;
}
const styles = `@font-face{font-family:SUITE;src:url('/fonts/SUITE-Variable.woff2') format('woff2');font-weight:100 900;font-display:swap}html{scroll-behavior:smooth}body{margin:0;color:#34342f;background:#faf9f6;font-family:SUITE,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}button,input,select,textarea{font:inherit}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,SUITE,monospace}.site-nav{height:52px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 28px;border-bottom:1px solid #e8e6df;background:#faf9f6}.site-nav nav{display:flex;gap:20px}.site-nav a,.site-content a,.site-footer a{color:#48684c;text-underline-offset:4px}.site-brand{font-weight:750;text-decoration:none}.site-content{max-width:1000px;margin:auto;padding:76px 28px;line-height:1.85}.site-content h1,.site-content h2{line-height:1.3;letter-spacing:-.035em}.site-content h1,.site-content>.site-hero h2{font-size:clamp(30px,4vw,48px);max-width:840px;margin:20px 0}.site-content h2{margin:54px 0 24px;font-size:28px}.site-content h3{font-size:20px;margin:0 0 12px}.site-lead{max-width:800px;color:#65665c;font-size:18px}.site-eyebrow{color:#607b64;font-size:13px;letter-spacing:.08em}.site-actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}.site-actions a{padding:10px 18px;border:1px solid #cdd7c7;border-radius:9px;text-decoration:none}.site-actions a:first-child{background:#607b64;color:#fff}.site-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.site-card,.site-limit{border:1px solid #e8e6df;border-radius:16px;padding:26px;background:#fffefa}.site-card p{margin:0;color:#65665c}.site-content details{border-bottom:1px solid #e8e6df;padding:18px 0}.site-content summary{cursor:pointer;font-weight:650}.site-content details p{color:#65665c}.site-footer{padding:24px 28px;border-top:1px solid #e8e6df;text-align:center;font-size:14px}.site-skip{position:absolute;left:20px;top:-100px;background:#fff;padding:12px;z-index:20}.site-skip:focus{top:5px}.site-notice{padding:16px 28px;color:#65665c}.site-web-demo .app{height:calc(100dvh - 52px)}.site-web-demo .site-content{border-top:1px solid #e8e6df}@media(max-width:680px){.site-nav{padding:0 16px;font-size:13px}.site-nav nav{gap:12px}.site-nav .site-source{display:none}.site-content{padding:48px 20px}.site-grid{grid-template-columns:1fr}.site-content h2{font-size:25px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
function body(lang) {
  const t = translations[lang];
  const tag = lang === "ko" ? "h2" : "h1";
  return `<article class="site-content" id="overview" aria-label="${t.overview}"><header class="site-hero"><p class="site-eyebrow">PUMASI AGENT · DEVELOPER PREVIEW</p><${tag}>${t.heading}</${tag}><p class="site-lead">${t.intro}</p><div class="site-actions"><a href="${lang === "ko" ? "#root" : "/"}">${t.open}</a><a href="${release}">${t.download}</a><a href="${repo}/blob/main/README.en.md">${t.guide}</a></div></header><section><h2>${t.featureTitle}</h2><div class="site-grid">${t.features.map(([h, p]) => `<section class="site-card"><h3>${h}</h3><p>${p}</p></section>`).join("")}</div></section><section><h2>${t.faq}</h2>${t.questions.map(([q, a]) => `<details open><summary>${q}</summary><p>${a}</p></details>`).join("")}</section><section class="site-limit"><h2>${t.limitations}</h2><p>${t.limitation}</p><a href="${release}">${t.links}</a></section></article>`;
}
function head(lang, production) {
  const t = translations[lang];
  const canonical = origin + (lang === "en" ? "/en/" : "/");
  // Only claims visible in the product overview are included. No fabricated ratings or offers.
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t.title,
    alternateName: "품앗이 에이전트",
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
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${t.title}</title><meta name="description" content="${escape(t.description)}"><meta name="robots" content="${production ? "index,follow,max-image-preview:large" : "noindex,nofollow"}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="ko" href="${origin}/"><link rel="alternate" hreflang="en" href="${origin}/en/"><link rel="alternate" hreflang="x-default" href="${origin}/"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="theme-color" content="#607b64"><meta property="og:type" content="website"><meta property="og:site_name" content="Pumasi Agent"><meta property="og:title" content="${t.title}"><meta property="og:description" content="${escape(t.description)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang === "ko" ? "ko_KR" : "en_US"}"><meta property="og:locale:alternate" content="${lang === "ko" ? "en_US" : "ko_KR"}"><meta property="og:image" content="${origin}/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Pumasi Agent desktop workspace preview"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t.title}"><meta name="twitter:description" content="${escape(t.description)}"><meta name="twitter:image" content="${origin}/social-preview.png">${verification}<script type="application/ld+json">${schema}</script><style>${styles}</style>`;
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
    const nav = `<a class="site-skip" href="#overview">${t.overview}</a><header class="site-nav"><a class="site-brand" href="/"><img class="site-brand-icon" src="/favicon.svg" width="28" height="28" alt=""> ${lang === "ko" ? "품앗이 에이전트" : "Pumasi Agent"}</a><nav aria-label="${t.overview}"><a href="${lang === "ko" ? "#overview" : "/"}">${lang === "ko" ? t.overview : t.demo}</a><a class="site-source" href="${repo}">GitHub</a><a href="${t.other}" lang="${lang === "ko" ? "en" : "ko"}" hreflang="${lang === "ko" ? "en" : "ko"}">${t.language}</a></nav></header>`;
    const demo =
      lang === "ko"
        ? `<section class="demo-shell" aria-label="Pumasi Agent web preview"><div class="demo-chrome"><span><i></i><i></i><i></i></span><p>Pumasi Agent <span>/</span> Web preview</p><a href="#overview">제품 소개 ↗</a></div><div id="root"><section class="site-notice"><h1>${t.heading}</h1><p>${t.browser}</p></section></div><noscript><p class="site-notice">${t.nojs}</p></noscript></section>`
        : "";
    const html = `<!doctype html><html lang="${lang}"><head>${head(lang, production)}${lang === "ko" ? assets.join("") : ""}<link rel="stylesheet" href="/landing.css"></head><body class="${lang === "ko" ? "site-web-demo" : "site-english"}">${nav}${landingHero(lang)}${demo}${body(lang)}<footer class="site-footer">Pumasi Agent · <a href="${repo}/blob/main/LICENSE">MIT</a> · <a href="${release}">${t.download}</a></footer></body></html>`;
    const file = path.join(
      outputDir,
      lang === "ko" ? "index.html" : "en/index.html",
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  const alternate = `<xhtml:link rel="alternate" hreflang="ko" href="${origin}/"/><xhtml:link rel="alternate" hreflang="en" href="${origin}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>`;
  await writeFile(
    path.join(outputDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>${origin}/</loc>${alternate}</url><url><loc>${origin}/en/</loc>${alternate}</url></urlset>`,
  );
  await writeFile(
    path.join(outputDir, "robots.txt"),
    production
      ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
      : `User-agent: *\nDisallow: /\n`,
  );
  await writeFile(
    path.join(outputDir, "404.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page not found — Pumasi Agent</title><style>${styles}</style></head><body><main class="site-content"><h1>Page not found</h1><a href="/">Pumasi Agent demo</a> · <a href="/en/">English overview</a></main></body></html>`,
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
