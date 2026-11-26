#!/usr/bin/env python3
"""Calibrate model weights based on exam results.

Usage:
    python3 -I calibrate.py <out_weights.json> <exam_dir> [<exam_dir> ...]

Reads questions.json, answers.json, and free-answers.json from each exam directory.
Computes per-kind and overall accuracy-based weights using log-odds.
"""
import json
import math
import os
import re
import sys


def norm(s):
    """Normalize answer string for comparison."""
    s = re.sub(r"[\s*`'\"<>]", "", str(s))
    s = re.sub(r",(?=\d{3}\b)", "", s)
    return re.sub(r"(명|시간|원)$", "", s)


def same(kind, got, want):
    """Check if answer matches, with kind-specific rules."""
    g, w = norm(got), norm(want)
    if kind == "knights":
        return sorted(filter(None, g.split(","))) == sorted(w.split(","))
    return g == w


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 -I calibrate.py <out_weights.json> <exam_dir> [<exam_dir> ...]")
        sys.exit(1)

    out_path = sys.argv[1]
    exam_dirs = sys.argv[2:]

    # counts[model_id][kind] = [correct, total]
    counts = {}

    for exam_dir in exam_dirs:
        try:
            questions = json.load(open(os.path.join(exam_dir, "questions.json"), encoding="utf-8"))
            answers = json.load(open(os.path.join(exam_dir, "answers.json"), encoding="utf-8"))
            free_answers = json.load(open(os.path.join(exam_dir, "free-answers.json"), encoding="utf-8"))
        except FileNotFoundError as e:
            print(f"Warning: Skipping {exam_dir}: {e}", file=sys.stderr)
            continue

        # Build id -> kind mapping
        id_to_kind = {q["id"]: q["kind"] for q in questions}

        # Get all models from free-answers
        for qid, entry in free_answers.items():
            if qid not in answers:
                continue

            kind = id_to_kind.get(qid)
            if not kind:
                continue

            correct = answers[qid]

            for model_id, model_data in entry.get("models", {}).items():
                if model_id not in counts:
                    counts[model_id] = {}

                if kind not in counts[model_id]:
                    counts[model_id][kind] = [0, 0]

                answer = model_data.get("answer", "")
                error = model_data.get("error", "")

                if error or not answer:
                    # Error or no answer counts as wrong
                    counts[model_id][kind][1] += 1
                else:
                    counts[model_id][kind][1] += 1
                    if same(kind, answer, correct):
                        counts[model_id][kind][0] += 1

    # Compute weights
    models_weights = {}
    for model_id, kinds in counts.items():
        models_weights[model_id] = {}

        # Compute per-kind weights
        total_c = 0
        total_n = 0
        for kind, [c, n] in kinds.items():
            total_c += c
            total_n += n
            p = (c + 1) / (n + 2)
            if p >= 1:
                w = float('inf')
            else:
                w = max(0, math.log(p / (1 - p)))
            models_weights[model_id][kind] = round(w, 3)

        # Compute _all weight
        if total_n > 0:
            p_all = (total_c + 1) / (total_n + 2)
            if p_all >= 1:
                w_all = float('inf')
            else:
                w_all = max(0, math.log(p_all / (1 - p_all)))
            models_weights[model_id]["_all"] = round(w_all, 3)

    # Build output
    sources = [os.path.basename(d) for d in exam_dirs]
    output = {
        "method": "per-kind log-odds, p=(c+1)/(n+2), w=max(0, ln(p/(1-p)))",
        "sources": sources,
        "models": models_weights,
        "counts": counts
    }

    # Write output
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=None, ensure_ascii=False)

    # Print table
    all_kinds = set()
    for kinds in counts.values():
        all_kinds.update(kinds.keys())
    all_kinds.discard("_all")
    sorted_kinds = sorted(all_kinds)

    # Get column headers
    headers = ["_all"] + sorted_kinds

    # Print header row
    print(f"{'모델':30} " + "  ".join(f"{h:>8}" for h in headers))

    # Print weight row for each model
    for model_id in sorted(models_weights.keys()):
        w_data = models_weights[model_id]
        row = [str(w_data.get("_all", 0))] + [str(w_data.get(k, "?")) for k in sorted_kinds]
        print(f"{model_id[:30]:30} " + "  ".join(f"{r:>8}" for r in row))

    # Print counts row for each model (in parentheses)
    print()
    print(f"{' counts':30} " + "  ".join(f"{'c/n':>8}" for _ in headers))
    for model_id in sorted(counts.keys()):
        kinds = counts[model_id]
        total_c = sum(v[0] for k, v in kinds.items() if k != "_all")
        total_n = sum(v[1] for k, v in kinds.items() if k != "_all")
        c_all = total_c
        n_all = total_n
        row = [f"{c_all}/{n_all}"] + [f"{kinds[k][0]}/{kinds[k][1]}" if k in kinds else "0/0" for k in sorted_kinds]
        print(f"{model_id[:30]:30} " + "  ".join(f"{r:>8}" for r in row))


if __name__ == "__main__":
    main()