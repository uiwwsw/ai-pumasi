"""Generate a fresh, hard, auto-gradable reasoning test (contamination-free: new instances each seed).

Six task families, each answer is a single exact value checked by the program:
  knights  - knights & knaves with 7 people, unique solution verified by brute force
  zebra    - 4 houses x 5 attributes logic grid, unique solution verified by brute force
  path     - weighted shortest path on a 12-node graph (Dijkstra)
  schedule - earliest finish of 10 dependent tasks with 2 workers (exhaustive list scheduling search)
  grid     - monotone lattice paths on a 9x9 grid with blocked cells (DP)
  bigmul   - exact value of a*b - c with 9-digit numbers

Usage: python3 -I generate.py <seed> <out_dir>
Writes questions.json (no answers), answers.json (key) and questions.md (paste-ready).
"""
import heapq
import itertools
import json
import random
import sys

seed, out = int(sys.argv[1]), sys.argv[2]
R = random.Random(seed)
FORMAT = "\n\n마지막 줄에 반드시 `정답: <답>` 형식으로만 답을 적으세요."
items = []


def has_batchim(word):
    ch = word[-1]
    return "가" <= ch <= "힣" and (ord(ch) - 0xAC00) % 28 != 0


def jo(word, pair):
    """Attach the right particle: pair like '은는', '이가', '와과', '을를', '이다' (copula)."""
    if pair == "이다":
        return word + ("이다" if has_batchim(word) else "다")
    a, b = pair[0], pair[1]
    return word + (a if has_batchim(word) else b)


def add(kind, text, answer, hint):
    items.append({"id": f"{kind}-{sum(1 for i in items if i['kind'] == kind) + 1}", "kind": kind, "prompt": text + "\n답 형식: " + hint + FORMAT, "answer": answer})


# ---------- knights & knaves ----------
NAMES = ["민수", "지아", "서준", "하린", "도윤", "유나", "건우"]


def kk_statement(i, n):
    t = R.choice(["is", "count", "or", "same", "iff"])
    p, q = R.sample([x for x in range(n) if x != i], 2)
    P, Q = NAMES[p], NAMES[q]
    if t == "is":
        v = R.choice([True, False])
        return (f"{jo(P, '은는')} {jo('기사' if v else '악당', '이다')}.", lambda a, p=p, v=v: a[p] == v)
    if t == "count":
        c = R.randint(1, n - 2)
        return (f"우리 {n}명 중 기사는 정확히 {c}명이다.", lambda a, c=c: sum(a) == c)
    if t == "or":
        return (f"{jo(P, '과와')} {Q} 중 적어도 한 명은 악당이다.", lambda a, p=p, q=q: (not a[p]) or (not a[q]))
    if t == "same":
        return (f"{jo(P, '과와')} {jo(Q, '은는')} 같은 부류다.", lambda a, p=p, q=q: a[p] == a[q])
    return (f"{jo(P, '이가')} 기사라면 {jo(Q, '은는')} 악당이다.", lambda a, p=p, q=q: (not a[p]) or (not a[q]))


def knights():
    n = 7
    while True:
        stmts = [kk_statement(i, n) for i in range(n)]
        sols = [a for a in itertools.product([True, False], repeat=n) if all(a[i] == stmts[i][1](a) for i in range(n))]
        if len(sols) == 1 and 2 <= sum(sols[0]) <= 5:
            a = sols[0]
            lines = "\n".join(f"- {NAMES[i]}: \"{stmts[i][0]}\"" for i in range(n))
            text = f"한 섬에는 항상 참만 말하는 기사와 항상 거짓만 말하는 악당이 산다. {n}명이 각각 한 문장씩 말했다.\n{lines}\n누가 기사인가?"
            ans = ",".join(sorted(NAMES[i] for i in range(n) if a[i]))
            add("knights", text, ans, "기사인 사람 이름을 가나다순으로 쉼표로 이어서 (예: 건우,민수)")
            return


# ---------- zebra ----------
ATTRS = {
    "색": ["빨강", "초록", "파랑", "노랑"],
    "국적": ["한국", "일본", "프랑스", "브라질"],
    "음료": ["커피", "차", "우유", "주스"],
    "반려동물": ["개", "고양이", "새", "물고기"],
    "취미": ["독서", "등산", "요리", "게임"],
}
KEYS = list(ATTRS)


def zebra():
    n = 4
    perms = list(itertools.permutations(range(n)))
    while True:
        sol = {k: list(R.choice(perms)) for k in KEYS}  # sol[k][value_index] = house

        def pos(s, k, v):
            return s[k][ATTRS[k].index(v)]

        def rand_clue():
            t = R.choice(["same", "same", "left", "next", "at", "not"])
            k1, k2 = R.sample(KEYS, 2)
            v1, v2 = R.choice(ATTRS[k1]), R.choice(ATTRS[k2])
            p1, p2 = pos(sol, k1, v1), pos(sol, k2, v2)
            if t == "same" and p1 == p2:
                return (f"{v1}({k1}) 집에는 {v2}({k2})도 있다.", lambda s, a=(k1, v1, k2, v2): pos(s, a[0], a[1]) == pos(s, a[2], a[3]))
            if t == "left" and p1 + 1 == p2:
                return (f"{v1}({k1}) 집은 {v2}({k2}) 집 바로 왼쪽이다.", lambda s, a=(k1, v1, k2, v2): pos(s, a[0], a[1]) + 1 == pos(s, a[2], a[3]))
            if t == "next" and abs(p1 - p2) == 1:
                return (f"{v1}({k1}) 집과 {v2}({k2}) 집은 이웃이다.", lambda s, a=(k1, v1, k2, v2): abs(pos(s, a[0], a[1]) - pos(s, a[2], a[3])) == 1)
            if t == "at":
                return (f"{v1}({k1}) 집은 {p1 + 1}번째 집이다.", lambda s, a=(k1, v1, p1): pos(s, a[0], a[1]) == a[2])
            if t == "not" and p1 != p2:
                return (f"{v1}({k1}) 집에는 {v2}({k2}){'이' if has_batchim(v2) else '가'} 없다.", lambda s, a=(k1, v1, k2, v2): pos(s, a[0], a[1]) != pos(s, a[2], a[3]))
            return None

        clues = []
        for _ in range(400):
            c = rand_clue()
            if c and c[0] not in [x[0] for x in clues]:
                clues.append(c)
            if len(clues) >= 10:
                break
        # count solutions by backtracking over attributes
        def count(limit=2):
            found = 0
            assign = {}

            def ok():
                for txt, f in clues:
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

        # add clues until unique (bounded), then drop redundant ones to keep it hard
        tries = 0
        while count() > 1 and tries < 40:
            c = rand_clue()
            if c and c[0] not in [x[0] for x in clues]:
                clues.append(c)
            tries += 1
        if count() != 1:
            continue
        for c in list(clues):
            clues.remove(c)
            if count() != 1:
                clues.append(c)
        if len(clues) < 9:
            continue
        at_txt = " ".join(c[0] for c in clues if "번째 집이다" in c[0])
        cands = [(qk, qv) for qk in ["반려동물", "취미"] for qv in ATTRS[qk] if f"{qv}({qk}) 집은" not in at_txt]
        cands = [(qk, qv) for qk, qv in cands if f"{ATTRS['국적'][sol['국적'].index(pos(sol, qk, qv))]}(국적) 집은" not in at_txt]
        # no single clue may link the asked item straight to a nationality
        cands = [(qk, qv) for qk, qv in cands if not any(f"{qv}({qk})" in c[0] and "(국적)" in c[0] for c in clues)]
        if not cands:
            continue
        qk, qv = R.choice(cands)
        house = pos(sol, qk, qv)
        nat = ATTRS["국적"][sol["국적"].index(house)]
        R.shuffle(clues)
        lines = "\n".join(f"{i + 1}. {c[0]}" for i, c in enumerate(clues))
        text = (
            "집 4채가 왼쪽부터 1~4번으로 한 줄로 서 있다. 각 집은 색, 국적, 음료, 반려동물, 취미가 모두 서로 다르다.\n"
            + "".join(f"- {k}: {', '.join(v)}\n" for k, v in ATTRS.items())
            + "단서:\n" + lines + f"\n{qv}({qk}) 집에 사는 사람의 국적은?"
        )
        add("zebra", text, nat, "국적 하나 (예: 한국)")
        return


# ---------- shortest path ----------
def path():
    n = 12
    labels = [chr(65 + i) for i in range(n)]
    edges = {}
    order = list(range(n))
    for i in range(1, n):  # connected
        a, b = order[i], R.choice(order[:i])
        edges[(min(a, b), max(a, b))] = R.randint(2, 30)
    while len(edges) < 26:
        a, b = R.sample(range(n), 2)
        edges.setdefault((min(a, b), max(a, b)), R.randint(2, 30))
    adj = {i: [] for i in range(n)}
    for (a, b), w in edges.items():
        adj[a].append((b, w))
        adj[b].append((a, w))
    s, t = 0, n - 1
    dist = {s: 0}
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e18):
            continue
        for v, w in adj[u]:
            if d + w < dist.get(v, 1e18):
                dist[v] = d + w
                heapq.heappush(pq, (d + w, v))
    el = sorted(edges.items())
    R.shuffle(el)
    lines = ", ".join(f"{labels[a]}-{labels[b]}:{w}" for (a, b), w in el)
    text = f"양방향 도로망이 있다(도시-도시:비용). {lines}\n{labels[s]}에서 {labels[t]}까지 가는 최소 비용은?"
    add("path", text, str(dist[t]), "정수 하나")


# ---------- scheduling with 2 workers ----------
def schedule():
    n = 10
    names = [f"T{i + 1}" for i in range(n)]
    dur = [R.randint(1, 9) for _ in range(n)]
    deps = {i: sorted(R.sample(range(i), R.randint(0, min(2, i)))) if i else [] for i in range(n)}

    best = [10**9]
    # exact: branch over which ready tasks to start whenever a worker frees (non-delay + idle option is not needed
    # for makespan optimality with identical machines? not guaranteed) -> brute force over all topological orders,
    # list-scheduled greedily onto the earliest free worker; take the minimum. 10 tasks keeps this tractable.
    def finish(order):
        free = [0, 0]
        end = {}
        for i in order:
            ready = max([end[d] for d in deps[i]], default=0)
            w = 0 if free[0] <= free[1] else 1
            start = max(free[w], ready)
            # also try the other worker if it lets the task start earlier
            o = 1 - w
            if max(free[o], ready) < start:
                w, start = o, max(free[o], ready)
            end[i] = start + dur[i]
            free[w] = end[i]
        return max(end.values())

    def rec(order, done):
        if len(order) == n:
            best[0] = min(best[0], finish(order))
            return
        for i in range(n):
            if i not in done and all(d in done for d in deps[i]):
                done.add(i)
                order.append(i)
                rec(order, done)
                order.pop()
                done.discard(i)

    rec([], set())
    lines = "\n".join(f"- {names[i]}: {dur[i]}시간" + (f", 선행 작업 {', '.join(names[d] for d in deps[i])}" if deps[i] else "") for i in range(n))
    text = (
        "작업자 2명이 아래 작업을 모두 끝내려 한다. 한 작업은 한 사람이 쉬지 않고 끝까지 하며, 선행 작업이 모두 끝나야 시작할 수 있다. "
        "두 사람은 동시에 다른 작업을 할 수 있다.\n" + lines + "\n모든 작업을 끝내는 가장 빠른 시간은 몇 시간인가?"
    )
    add("schedule", text, str(best[0]), "정수 하나")


# ---------- lattice paths ----------
def grid():
    size = 9
    blocked = set()
    while len(blocked) < 14:
        c = (R.randrange(size), R.randrange(size))
        if c not in [(0, 0), (size - 1, size - 1)]:
            blocked.add(c)
    dp = [[0] * size for _ in range(size)]
    for r in range(size):
        for c in range(size):
            if (r, c) in blocked:
                continue
            if r == 0 and c == 0:
                dp[r][c] = 1
                continue
            dp[r][c] = (dp[r - 1][c] if r else 0) + (dp[r][c - 1] if c else 0)
    if dp[-1][-1] == 0:
        return grid()
    cells = ", ".join(f"({r + 1},{c + 1})" for r, c in sorted(blocked))
    text = (
        f"{size}x{size} 격자의 왼쪽 위 칸 (1,1)에서 오른쪽 아래 칸 ({size},{size})까지 오른쪽이나 아래로만 한 칸씩 움직인다. "
        f"(행,열)로 표시한 다음 칸은 막혀 있어 지날 수 없다: {cells}\n가능한 경로의 수는?"
    )
    add("grid", text, str(dp[-1][-1]), "정수 하나")


# ---------- big arithmetic ----------
def bigmul():
    a, b, c = R.randint(10**8, 10**9 - 1), R.randint(10**8, 10**9 - 1), R.randint(10**8, 10**9 - 1)
    add("bigmul", f"{a} × {b} − {c} 의 정확한 값은?", str(a * b - c), "정수 하나 (쉼표 없이)")


for gen in [knights, zebra, path, schedule, grid, bigmul]:
    for _ in range(7):
        gen()

R.shuffle(items)
for i, it in enumerate(items):
    it["no"] = i + 1
json.dump([{k: it[k] for k in ("no", "id", "kind", "prompt")} for it in items], open(f"{out}/questions.json", "w"), ensure_ascii=False, indent=1)
json.dump({it["id"]: it["answer"] for it in items}, open(f"{out}/answers.json", "w"), ensure_ascii=False, indent=1)
with open(f"{out}/questions.md", "w") as f:
    f.write("# 추론 시험지 (42문항)\n\n도구(코드 실행, 웹 검색, 파일 분석)는 끄고 푸세요. 한 번에 다 넣어도 되고 나눠 넣어도 됩니다. 답할 때는 문제마다 `문제 N`으로 시작하고, 그 문제의 마지막 줄에 `정답: <답>`을 적게 하세요. 받은 답을 그대로 `fable.txt`에 붙여 넣으면 채점됩니다.\n\n")
    for it in items:
        f.write(f"## 문제 {it['no']}\n\n{it['prompt']}\n\n")
print(len(items), {k: sum(1 for i in items if i['kind'] == k) for k in ['knights', 'zebra', 'path', 'schedule', 'grid', 'bigmul']})
