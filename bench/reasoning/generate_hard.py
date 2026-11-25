"""Hard reasoning exam: fresh instances, single exact answers, verified by program.

  knights  - 10 people, richer statements (exactly-k-of-subset, xor), unique solution by brute force (2^10)
  zebra    - 5 houses x 5 attributes, unique solution by backtracking, no shortcut clue for the asked item
  path     - weighted shortest path, 20 nodes / 45 edges (Dijkstra)
  knapsack - 0/1 knapsack, 14 items (exact DP)
  grid     - monotone lattice paths on 12x12 with 30 blocked cells (DP)
  bigmul   - exact a*b - c with 12-digit numbers

Usage: python3 -I generate_hard.py <seed> <out_dir> [per_kind=5]
Writes questions.json (no answers), answers.json (key), questions.md (paste-ready, no answers).
"""
import heapq
import itertools
import json
import random
import sys

seed, out = int(sys.argv[1]), sys.argv[2]
PER = int(sys.argv[3]) if len(sys.argv) > 3 else 5
R = random.Random(seed)
FORMAT = "\n\n마지막 줄에 반드시 `정답: <답>` 형식으로만 답을 적으세요."
items = []


def has_batchim(word):
    ch = word[-1]
    return "가" <= ch <= "힣" and (ord(ch) - 0xAC00) % 28 != 0


def jo(word, pair):
    if pair == "이다":
        return word + ("이다" if has_batchim(word) else "다")
    return word + (pair[0] if has_batchim(word) else pair[1])


def add(kind, text, answer, hint):
    n = sum(1 for i in items if i["kind"] == kind) + 1
    items.append({"id": f"{kind}-{n}", "kind": kind, "prompt": text + "\n답 형식: " + hint + FORMAT, "answer": answer})


# ---------- knights & knaves (10 people) ----------
NAMES = ["민수", "지아", "서준", "하린", "도윤", "유나", "건우", "소율", "태민", "예린"]


def kk_statement(i, n):
    t = R.choice(["is", "count", "or", "same", "iff", "subset", "xor"])
    others = [x for x in range(n) if x != i]
    p, q, r = R.sample(others, 3)
    P, Q, S = NAMES[p], NAMES[q], NAMES[r]
    if t == "is":
        v = R.choice([True, False])
        return (f"{jo(P, '은는')} {jo('기사' if v else '악당', '이다')}.", lambda a, p=p, v=v: a[p] == v)
    if t == "count":
        c = R.randint(2, n - 3)
        return (f"우리 {n}명 중 기사는 정확히 {c}명이다.", lambda a, c=c: sum(a) == c)
    if t == "or":
        return (f"{jo(P, '과와')} {Q} 중 적어도 한 명은 악당이다.", lambda a, p=p, q=q: (not a[p]) or (not a[q]))
    if t == "same":
        return (f"{jo(P, '과와')} {jo(Q, '은는')} 같은 부류다.", lambda a, p=p, q=q: a[p] == a[q])
    if t == "iff":
        return (f"{jo(P, '이가')} 기사라면 {jo(Q, '은는')} 악당이다.", lambda a, p=p, q=q: (not a[p]) or (not a[q]))
    if t == "subset":
        c = R.randint(1, 2)
        return (f"{P}, {Q}, {S} 세 명 가운데 기사는 정확히 {c}명이다.", lambda a, p=p, q=q, r=r, c=c: a[p] + a[q] + a[r] == c)
    return (f"{jo(P, '과와')} {Q} 중 정확히 한 명만 기사다.", lambda a, p=p, q=q: a[p] != a[q])


def knights():
    n = 10
    while True:
        stmts = [kk_statement(i, n) for i in range(n)]
        sols = [a for a in itertools.product([True, False], repeat=n) if all(a[i] == stmts[i][1](a) for i in range(n))]
        if len(sols) == 1 and 3 <= sum(sols[0]) <= 7:
            a = sols[0]
            lines = "\n".join(f"- {NAMES[i]}: \"{stmts[i][0]}\"" for i in range(n))
            text = f"한 섬에는 항상 참만 말하는 기사와 항상 거짓만 말하는 악당이 산다. {n}명이 각각 한 문장씩 말했다.\n{lines}\n누가 기사인가?"
            add("knights", text, ",".join(sorted(NAMES[i] for i in range(n) if a[i])), "기사인 사람 이름을 가나다순으로 쉼표로 이어서 (예: 건우,민수)")
            return


# ---------- zebra (5 houses x 5 attributes) ----------
ATTRS = {
    "색": ["빨강", "초록", "파랑", "노랑", "하양"],
    "국적": ["한국", "일본", "프랑스", "브라질", "독일"],
    "음료": ["커피", "차", "우유", "주스", "물"],
    "반려동물": ["개", "고양이", "새", "물고기", "말"],
    "취미": ["독서", "등산", "요리", "게임", "그림"],
}
KEYS = list(ATTRS)


def zebra():
    n = 5
    perms = list(itertools.permutations(range(n)))
    while True:
        sol = {k: list(R.choice(perms)) for k in KEYS}

        def pos(s, k, v):
            return s[k][ATTRS[k].index(v)]

        def rand_clue():
            t = R.choice(["same", "same", "left", "next", "next", "at", "not", "between"])
            k1, k2 = R.sample(KEYS, 2)
            v1, v2 = R.choice(ATTRS[k1]), R.choice(ATTRS[k2])
            p1, p2 = pos(sol, k1, v1), pos(sol, k2, v2)
            a = (k1, v1, k2, v2)
            if t == "same" and p1 == p2:
                return (f"{v1}({k1}) 집에는 {v2}({k2})도 있다.", lambda s, a=a: pos(s, a[0], a[1]) == pos(s, a[2], a[3]))
            if t == "left" and p1 + 1 == p2:
                return (f"{v1}({k1}) 집은 {v2}({k2}) 집 바로 왼쪽이다.", lambda s, a=a: pos(s, a[0], a[1]) + 1 == pos(s, a[2], a[3]))
            if t == "next" and abs(p1 - p2) == 1:
                return (f"{v1}({k1}) 집과 {v2}({k2}) 집은 이웃이다.", lambda s, a=a: abs(pos(s, a[0], a[1]) - pos(s, a[2], a[3])) == 1)
            if t == "between" and p1 < p2:
                return (f"{v1}({k1}) 집은 {v2}({k2}) 집보다 왼쪽에 있다.", lambda s, a=a: pos(s, a[0], a[1]) < pos(s, a[2], a[3]))
            if t == "at" and R.random() < 0.5:
                return (f"{v1}({k1}) 집은 {p1 + 1}번째 집이다.", lambda s, b=(k1, v1, p1): pos(s, b[0], b[1]) == b[2])
            if t == "not" and p1 != p2:
                return (f"{v1}({k1}) 집에는 {v2}({k2}){'이' if has_batchim(v2) else '가'} 없다.", lambda s, a=a: pos(s, a[0], a[1]) != pos(s, a[2], a[3]))
            return None

        def count(clues, limit=2):
            found = 0
            assign = {}

            def ok():
                for _, f in clues:
                    try:
                        if not f(assign):
                            return False
                    except KeyError:
                        continue
                return True

            def rec(i):
                nonlocal found
                if found >= limit:
                    return
                if i == len(KEYS):
                    found += 1
                    return
                for p in perms:
                    assign[KEYS[i]] = list(p)
                    if ok():
                        rec(i + 1)
                    del assign[KEYS[i]]

            rec(0)
            return found

        clues = []
        while len(clues) < 14:
            c = rand_clue()
            if c and c[0] not in [x[0] for x in clues]:
                clues.append(c)
        tries = 0
        while count(clues) > 1 and tries < 60:
            c = rand_clue()
            if c and c[0] not in [x[0] for x in clues]:
                clues.append(c)
            tries += 1
        if count(clues) != 1:
            continue
        for c in list(clues):  # drop redundant clues so every remaining clue matters
            clues.remove(c)
            if count(clues) != 1:
                clues.append(c)
        at_txt = " ".join(c[0] for c in clues if "번째 집이다" in c[0])
        cands = []
        for qk in ["반려동물", "취미", "음료"]:
            for qv in ATTRS[qk]:
                nat = ATTRS["국적"][sol["국적"].index(pos(sol, qk, qv))]
                if f"{qv}({qk}) 집은" in at_txt or f"{nat}(국적) 집은" in at_txt:
                    continue
                if any(f"{qv}({qk})" in c[0] and "(국적)" in c[0] for c in clues):
                    continue
                cands.append((qk, qv, nat))
        if not cands:
            continue
        qk, qv, nat = R.choice(cands)
        R.shuffle(clues)
        lines = "\n".join(f"{i + 1}. {c[0]}" for i, c in enumerate(clues))
        text = (
            "집 5채가 왼쪽부터 1~5번으로 한 줄로 서 있다. 각 집은 색, 국적, 음료, 반려동물, 취미가 모두 서로 다르다.\n"
            + "".join(f"- {k}: {', '.join(v)}\n" for k, v in ATTRS.items())
            + "단서:\n" + lines + f"\n{qv}({qk}) 집에 사는 사람의 국적은?"
        )
        add("zebra", text, nat, "국적 하나 (예: 한국)")
        return


# ---------- shortest path (20 nodes) ----------
def path():
    n, m = 20, 45
    labels = [chr(65 + i) for i in range(n)]
    edges = {}
    for i in range(1, n):
        a, b = i, R.randrange(i)
        edges[(min(a, b), max(a, b))] = R.randint(5, 99)
    while len(edges) < m:
        a, b = R.sample(range(n), 2)
        edges.setdefault((min(a, b), max(a, b)), R.randint(5, 99))
    adj = {i: [] for i in range(n)}
    for (a, b), w in edges.items():
        adj[a].append((b, w))
        adj[b].append((a, w))
    s, t = 0, n - 1
    dist, pq = {s: 0}, [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1 << 60):
            continue
        for v, w in adj[u]:
            if d + w < dist.get(v, 1 << 60):
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    el = sorted(edges.items())
    R.shuffle(el)
    lines = ", ".join(f"{labels[a]}-{labels[b]}:{w}" for (a, b), w in el)
    add("path", f"양방향 도로망이 있다(도시-도시:비용). {lines}\n{labels[s]}에서 {labels[t]}까지 가는 최소 비용은?", str(dist[t]), "정수 하나")


# ---------- 0/1 knapsack (14 items) ----------
def knapsack():
    k = 14
    w = [R.randint(5, 40) for _ in range(k)]
    v = [R.randint(10, 99) for _ in range(k)]
    cap = int(sum(w) * R.uniform(0.35, 0.5))
    dp = [0] * (cap + 1)
    for i in range(k):
        for c in range(cap, w[i] - 1, -1):
            dp[c] = max(dp[c], dp[c - w[i]] + v[i])
    lines = "\n".join(f"- 물건 {i + 1}: 무게 {w[i]}kg, 가치 {v[i]}" for i in range(k))
    add("knapsack", f"가방에 최대 {cap}kg까지 담을 수 있다. 각 물건은 하나씩만 있고 쪼갤 수 없다.\n{lines}\n담을 수 있는 가치 합의 최댓값은?", str(dp[cap]), "정수 하나")


# ---------- lattice paths 12x12 ----------
def grid():
    size, nb = 12, 30
    blocked = set()
    while len(blocked) < nb:
        c = (R.randrange(size), R.randrange(size))
        if c not in [(0, 0), (size - 1, size - 1)]:
            blocked.add(c)
    dp = [[0] * size for _ in range(size)]
    for r in range(size):
        for c in range(size):
            if (r, c) in blocked:
                continue
            dp[r][c] = 1 if (r, c) == (0, 0) else (dp[r - 1][c] if r else 0) + (dp[r][c - 1] if c else 0)
    if dp[-1][-1] < 1000:
        return grid()
    cells = ", ".join(f"({r + 1},{c + 1})" for r, c in sorted(blocked))
    add(
        "grid",
        f"{size}x{size} 격자의 왼쪽 위 칸 (1,1)에서 오른쪽 아래 칸 ({size},{size})까지 오른쪽이나 아래로만 한 칸씩 움직인다. "
        f"(행,열)로 표시한 다음 칸은 막혀 있어 지날 수 없다: {cells}\n가능한 경로의 수는?",
        str(dp[-1][-1]),
        "정수 하나",
    )


# ---------- 12-digit arithmetic ----------
def bigmul():
    a, b, c = (R.randint(10**11, 10**12 - 1) for _ in range(3))
    add("bigmul", f"{a} × {b} − {c} 의 정확한 값은?", str(a * b - c), "정수 하나 (쉼표 없이)")


KINDS = [knights, zebra, path, knapsack, grid, bigmul]
for gen in KINDS:
    for _ in range(PER):
        gen()
        print(gen.__name__, len(items), file=sys.stderr, flush=True)

R.shuffle(items)
for i, it in enumerate(items):
    it["no"] = i + 1
json.dump([{k: it[k] for k in ("no", "id", "kind", "prompt")} for it in items], open(f"{out}/questions.json", "w"), ensure_ascii=False, indent=1)
json.dump({it["id"]: it["answer"] for it in items}, open(f"{out}/answers.json", "w"), ensure_ascii=False, indent=1)
with open(f"{out}/questions.md", "w") as f:
    f.write(
        f"# 추론 시험지 · 어려움 ({len(items)}문항)\n\n"
        "도구(코드 실행, 웹 검색, 파일 분석)는 끄고 푸세요. 한 번에 다 넣어도 되고 나눠 넣어도 됩니다. "
        "답할 때는 문제마다 `문제 N`으로 시작하고, 그 문제의 마지막 줄에 `정답: <답>`을 적게 하세요. "
        "받은 답을 그대로 `fable.txt`에 붙여 넣으면 채점됩니다.\n\n"
    )
    for it in items:
        f.write(f"## 문제 {it['no']}\n\n{it['prompt']}\n\n")
print(len(items), {g.__name__: sum(1 for i in items if i["kind"] == g.__name__) for g in KINDS})
