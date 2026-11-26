"""Prepare external benchmark questions and answers.

Usage:
  python3 -I ext_prepare.py <src_dir> <out_dir>

AIME 30문항: from aime_rows.json
LiveBench zebra puzzle: 25 problems from lb_r_0.json, lb_r_100.json, lb_r_200.json
"""
import json
import os
import re
import sys


def prepare_aime(src_dir):
    """Prepare AIME 30 problems."""
    aime_path = os.path.join(src_dir, "aime_rows.json")
    with open(aime_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = []
    answers = {}

    for row_data in data["rows"]:
        row = row_data["row"]
        problem_idx = row["problem_idx"]
        answer = row["answer"]
        problem = row["problem"]

        qid = f"aime-{problem_idx}"
        prompt = problem + "\n\nPlease reason step by step, and put your final answer within \\boxed{}."

        items.append({
            "id": qid,
            "kind": "aime",
            "format": "boxed",
            "prompt": prompt
        })
        answers[qid] = str(answer)

    return items, answers


def prepare_livebench(src_dir):
    """Prepare LiveBench zebra puzzle problems (first 25 with release date starting 2024-11-25)."""
    lb_files = ["lb_r_0.json", "lb_r_100.json", "lb_r_200.json"]

    all_rows = []
    for lb_file in lb_files:
        lb_path = os.path.join(src_dir, lb_file)
        if os.path.exists(lb_path):
            with open(lb_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            all_rows.extend(data["rows"])

    # Filter for zebra_puzzle task with release date starting 2024-11-25
    filtered = [
        row for row in all_rows
        if row["row"]["task"] == "zebra_puzzle"
        and row["row"]["livebench_release_date"].startswith("2024-11-25")
    ]

    # Sort by question_id
    filtered.sort(key=lambda x: x["row"]["question_id"])

    # Take first 25
    filtered = filtered[:25]

    items = []
    answers = {}

    for idx, row_data in enumerate(filtered, start=1):
        row = row_data["row"]
        question_id = row["question_id"]
        turns = row["turns"]
        ground_truth = row["ground_truth"]

        qid = f"lbz-{idx}"

        items.append({
            "id": qid,
            "kind": "lb_zebra",
            "format": "solution",
            "prompt": turns[0],
            "source_id": question_id
        })
        answers[qid] = ground_truth

    return items, answers


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 -I ext_prepare.py <src_dir> <out_dir>", file=sys.stderr)
        sys.exit(1)

    src_dir = sys.argv[1]
    out_dir = sys.argv[2]

    # Create output directory if needed
    os.makedirs(out_dir, exist_ok=True)

    # Prepare AIME problems
    aime_items, aime_answers = prepare_aime(src_dir)

    # Prepare LiveBench zebra puzzles
    lb_items, lb_answers = prepare_livebench(src_dir)

    # Combine all items
    all_items = aime_items + lb_items
    all_answers = {**aime_answers, **lb_answers}

    # Assign sequential 'no' field
    for i, item in enumerate(all_items, start=1):
        item["no"] = i

    # Sort by no (AIME first, then LiveBench)
    all_items.sort(key=lambda x: x["no"])

    # Create questions list (without answers)
    questions = []
    for item in all_items:
        q_entry = {
            "no": item["no"],
            "id": item["id"],
            "kind": item["kind"],
            "format": item["format"],
            "prompt": item["prompt"]
        }
        if "source_id" in item:
            q_entry["source_id"] = item["source_id"]
        questions.append(q_entry)

    # Write questions.json
    questions_path = os.path.join(out_dir, "questions.json")
    with open(questions_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=1)

    # Write answers.json
    answers_path = os.path.join(out_dir, "answers.json")
    with open(answers_path, "w", encoding="utf-8") as f:
        json.dump(all_answers, f, ensure_ascii=False, indent=1)

    # Print counts by kind
    counts = {}
    for item in all_items:
        k = item["kind"]
        counts[k] = counts.get(k, 0) + 1

    for kind, count in counts.items():
        print(f"{kind}: {count}")


if __name__ == "__main__":
    main()