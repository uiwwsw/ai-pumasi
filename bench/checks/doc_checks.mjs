// Automatic checks for document tasks. Each returns { score: 0..1, notes: [] }.
export function extractJSON(text) {
  const s = String(text ?? "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const cand of [fence?.[1], s]) {
    if (!cand) continue;
    try {
      return JSON.parse(cand);
    } catch {}
    const a = cand.search(/[[{]/);
    const b = Math.max(cand.lastIndexOf("}"), cand.lastIndexOf("]"));
    if (a >= 0 && b > a)
      try {
        return JSON.parse(cand.slice(a, b + 1));
      } catch {}
  }
  return null;
}

const digits = (v) => String(v ?? "").replace(/[^0-9]/g, "");

export function checkD1(text) {
  const j = extractJSON(text);
  if (!j || Array.isArray(j)) return { score: 0, notes: ["JSON 아님"] };
  const want = {
    대상인원: "340",
    시작일: "20261207",
    종료일: "20261218",
    하루최대예약: "40",
    예약시작: "202612011000",
    내시경본인부담: "40000",
    내선: "2417",
    환급한도: "150000",
    환급마감: "20270115",
  };
  const notes = [];
  let ok = 0;
  for (const [k, v] of Object.entries(want)) {
    if (digits(j[k]) === v) ok++;
    else notes.push(`${k}: ${JSON.stringify(j[k])}`);
  }
  if (String(j["담당자"] ?? "").includes("김서연")) ok++;
  else notes.push(`담당자: ${JSON.stringify(j["담당자"])}`);
  return { score: ok / 10, notes };
}

export function checkD2(text) {
  const j = extractJSON(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : null;
  if (!arr) return { score: 0, notes: ["JSON 배열 아님"] };
  const want = [
    ["이수민", "20261126", /재시도|배포/],
    ["최영호", "20261127", /QA|테스트|검수/i],
    ["최영호", "20261130", /통계|문의/],
    ["정다은", "20261125", /배너|시안|초안/],
    ["박지훈", "20261126", /검토|배너/],
    ["이수민", "20261130", /서버|비용|보고서/],
  ];
  const used = new Set();
  let hit = 0;
  const notes = [];
  for (const [who, when, what] of want) {
    const idx = arr.findIndex(
      (x, i) =>
        !used.has(i) &&
        String(x?.담당자 ?? "").includes(who) &&
        digits(x?.기한) === when &&
        what.test(String(x?.할일 ?? "")),
    );
    if (idx >= 0) {
      used.add(idx);
      hit++;
    } else notes.push(`누락: ${who} ${when}`);
  }
  const extra = arr.length - used.size;
  if (extra > 0) notes.push(`불필요 항목 ${extra}개`);
  return { score: Math.max(0, (hit - extra * 0.5) / want.length), notes };
}

export function checkD4(text) {
  const t = String(text ?? "").replace(/,/g, "");
  const need = [
    ["340", /340/],
    ["Dec 7", /(December|Dec\.?)\s*7\b|12[/.-]0?7\b|7(th)?\s+(of\s+)?December/i],
    ["Dec 18", /\b18(th)?\b/],
    ["Dec 1 10am", /10(:00)?\s*(a\.?m\.?|AM)|10:00/i],
    ["40 per day", /\b40\b/],
    ["80000", /80000|80\s*thousand|₩?80k/i],
    ["50%", /50\s*%|half/i],
    ["9 pm", /9(:00)?\s*(p\.?m\.?|PM)|21:00/i],
    ["2417", /2417/],
    ["150000", /150000|150\s*thousand/i],
    ["2027-01-15", /January\s*15|Jan\.?\s*15|15\s*January|2027[/.-]0?1[/.-]15/i],
    ["Kim Seo-yeon", /Kim\s*Seo[- ]?yeon|Seoyeon\s*Kim|Seo-?yeon Kim/i],
  ];
  const miss = need.filter(([, re]) => !re.test(t)).map(([k]) => k);
  return { score: (need.length - miss.length) / need.length, notes: miss.map((m) => "누락 " + m) };
}
