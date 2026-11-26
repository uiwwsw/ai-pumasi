"""Grade the reasoning exam.

Usage:
  python3 -I grade.py <exam_dir>                 # grade free bundle (free-answers.json)
  python3 -I grade.py <exam_dir> fable.txt       # also grade pasted Fable answers

fable.txt: paste Fable's replies as-is. Each answer must appear as `문제 N` ... `정답: X`
(a line like `문제 12 정답: 1116` also works).
"""
import json
import re
import sys

d = sys.argv[1]
key = json.load(open(f"{d}/answers.json", encoding="utf-8"))
qs = {q["no"]: q for q in json.load(open(f"{d}/questions.json", encoding="utf-8"))}


def norm(s):
    s = re.sub(r"[\s*`'\"<>]", "", str(s))
    s = re.sub(r",(?=\d{3}\b)", "", s)
    return re.sub(r"(명|시간|원)$", "", s)


def same(kind, got, want):
    g, w = norm(got), norm(want)
    if kind == "knights":
        return sorted(filter(None, g.split(","))) == sorted(w.split(","))
    return g == w


def score(answers):
    by_kind = {}
    for no, q in qs.items():
        ok = same(q["kind"], answers.get(q["id"], ""), key[q["id"]])
        k = by_kind.setdefault(q["kind"], [0, 0])
        k[0] += ok
        k[1] += 1
    total = sum(v[0] for v in by_kind.values())
    return total, by_kind


free = json.load(open(f"{d}/free-answers.json", encoding="utf-8"))
rows = [("오로라(다수결)", {k: v["vote"] for k, v in free.items()})]

# Add weighted vote if wvote exists
has_wvote = any("wvote" in v for v in free.values())
if has_wvote:
    rows.append(("오로라(가중 투표)", {k: v.get("wvote", "") for k, v in free.items()}))

models = list(next(iter(free.values()))["models"])
for m in models:
    rows.append((m.split("/")[-1], {k: v["models"][m]["answer"] for k, v in free.items()}))

# Oracle row: correct if any model got it right
oracle_ans = {}
for qid, entry in free.items():
    qkind = None
    for q in qs.values():
        if q["id"] == qid:
            qkind = q["kind"]
            break
    if qkind is None:
        continue
    correct = key.get(qid, "")
    got_correct = False
    for m, md in entry.get("models", {}).items():
        if md.get("answer") and same(qkind, md.get("answer", ""), correct):
            got_correct = True
            break
    oracle_ans[qid] = correct if got_correct else ""

if len(sys.argv) > 2:
    text = open(sys.argv[2], encoding="utf-8").read()
    fable = {}
    for m in re.finditer(r"문제\s*(\d+)(.*?)(?=문제\s*\d+|\Z)", text, re.S):
        no = int(m.group(1))
        ans = re.findall(r"정답\s*[:：]\s*`?([^`\n]+)", m.group(2))
        if no in qs and ans:
            fable[qs[no]["id"]] = ans[-1].strip()
    rows.insert(0, ("Fable", fable))

rows.append(("오라클(한 모델이라도 정답)", oracle_ans))

# Get all kinds from questions.json, in order
all_kinds = []
for q in qs.values():
    k = q["kind"]
    if k not in all_kinds:
        all_kinds.append(k)

# Calculate total and per-kind counts
total_count = len(qs)
per_kind_counts = {}
for k in all_kinds:
    per_kind_counts[k] = sum(1 for q in qs.values() if q["kind"] == k)

print(f"{'':28}{'합계':>6}  " + "  ".join(f"{k:>8}" for k in all_kinds))
for name, ans in rows:
    total, bk = score(ans)
    print(f"{name:28}{total:>3}/{total_count}  " + "  ".join(f"{bk[k][0]:>6}/{per_kind_counts[k]}" for k in all_kinds))