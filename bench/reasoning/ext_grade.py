"""Grade external benchmark answers.

Usage:
  python3 -I ext_grade.py <exam_dir> [chatgpt.json]

- aime: remove spaces, $, commas, \text{} wrappers, leading zeros, then compare as int.
- lb_zebra: LiveBench official rules. Split by comma. Normalize each slot by
  strip().lower().replace('-', ' '). In answer slot, also remove 'position'.
  A ground truth slot matches if it equals answer slot or is a substring of it.
  Score = ((all_correct == num_slots) + correct_slots / num_slots) / 2  (0..1 real).

Columns: sum(score)/count (1 decimal), then per-kind sum.
Rows order: ChatGPT 무료 (if present), 오로라(다수결) <- vote, 오로라(가중 투표) <- wvote,
            each model (model id after last '/'), 오라클(한 모델이라도 최고점) <- per-question max model score.
Answers (answers.json) are NOT printed.
"""
import json
import os
import re
import sys


def extract_boxed_answer(text):
    """Extract the last \\boxed{...} content, handling nested braces."""
    if not text:
        return ""
    # Find all \boxed{...} occurrences
    pattern = r'\\boxed\{'
    matches = list(re.finditer(pattern, text))
    if not matches:
        return ""

    # Get the last one
    last_match = matches[-1]
    start = last_match.end()  # Position after \boxed{

    # Count braces to find the matching closing brace
    brace_count = 1
    for i in range(start, len(text)):
        if text[i] == '{':
            brace_count += 1
        elif text[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                return text[start:i].strip()
    return ""


def extract_solution_answer(text):
    """Extract the last <solution>...</solution> content."""
    if not text:
        return ""
    matches = list(re.finditer(r'<solution>', text))
    if not matches:
        return ""

    last_match = matches[-1]
    start = last_match.end()
    end_match = re.search(r'</solution>', text[start:])
    if not end_match:
        return ""
    return text[start:start + end_match.start()].strip()


def normalize_aime(answer):
    """Normalize AIME answer for comparison."""
    if not answer:
        return ""
    s = str(answer)
    # Remove spaces, $, commas
    s = re.sub(r'[\s$,]', '', s)
    # Remove \text{} wrapper
    s = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", s)
    # Remove leading zeros
    s = s.lstrip('0')
    if s == '':
        s = '0'
    return s


def normalize_lb_slot(slot):
    """Normalize a LiveBench zebra slot."""
    if not slot:
        return ""
    s = slot.strip().lower().replace('-', ' ')
    # In answer slot, also remove 'position'
    s = s.replace('position', '').strip()
    return s


def score_lb_zebra(ground_truth, answer):
    """Score LiveBench zebra puzzle per official rules.

    Returns float 0..1
    """
    gt_slots = [normalize_lb_slot(s) for s in ground_truth.split(',')]
    ans_slots = [normalize_lb_slot(s) for s in answer.split(',')]

    if not gt_slots or gt_slots == ['']:
        return 0.0

    num_slots = len(gt_slots)
    if num_slots == 0:
        return 0.0

    correct = 0
    for gt_slot in gt_slots:
        # Check if gt_slot equals any answer slot or is substring of any answer slot
        matched = False
        for ans_slot in ans_slots:
            if gt_slot == ans_slot or (gt_slot and gt_slot in ans_slot):
                matched = True
                break
        if matched:
            correct += 1

    all_correct = 1 if correct == num_slots else 0
    score = (all_correct + correct / num_slots) / 2.0
    return score


def score_aime(ground_truth, answer):
    """Score AIME: exact match after normalization."""
    gt_norm = normalize_aime(ground_truth)
    ans_norm = normalize_aime(answer)
    return 1.0 if gt_norm == ans_norm else 0.0


def score_answer(qkind, ground_truth, answer):
    """Score based on kind."""
    if qkind == "aime":
        return score_aime(ground_truth, answer)
    elif qkind == "lb_zebra":
        return score_lb_zebra(ground_truth, answer)
    else:
        return 0.0


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 -I ext_grade.py <exam_dir> [chatgpt.json]", file=sys.stderr)
        sys.exit(1)

    exam_dir = sys.argv[1]
    chatgpt_path = sys.argv[2] if len(sys.argv) > 2 else None

    # Load questions, answers, free-answers
    with open(os.path.join(exam_dir, "questions.json"), "r", encoding="utf-8") as f:
        questions = json.load(f)

    with open(os.path.join(exam_dir, "answers.json"), "r", encoding="utf-8") as f:
        answer_key = json.load(f)

    with open(os.path.join(exam_dir, "free-answers.json"), "r", encoding="utf-8") as f:
        free_answers = json.load(f)

    # Build question kind map
    qkind_map = {q["id"]: q["kind"] for q in questions}

    # Process ChatGPT answers if provided
    chatgpt_answers = {}
    if chatgpt_path and os.path.exists(chatgpt_path):
        with open(chatgpt_path, "r", encoding="utf-8") as f:
            chatgpt_data = json.load(f)

        for qid, text in chatgpt_data.items():
            qkind = qkind_map.get(qid)
            if qkind == "aime":
                chatgpt_answers[qid] = extract_boxed_answer(text)
            elif qkind == "lb_zebra":
                chatgpt_answers[qid] = extract_solution_answer(text)
            else:
                chatgpt_answers[qid] = ""

    # Build rows for grading
    rows = []  # list of (name, answers_dict)

    # ChatGPT 무료
    if chatgpt_answers:
        rows.append(("ChatGPT 무료", chatgpt_answers))

    # 오로라(다수결) - vote
    aurora_vote = {qid: entry.get("vote", "") for qid, entry in free_answers.items()}
    rows.append(("오로라(다수결)", aurora_vote))

    # 오로라(가중 투표) - wvote
    has_wvote = any("wvote" in entry for entry in free_answers.values())
    if has_wvote:
        aurora_wvote = {qid: entry.get("wvote", "") for qid, entry in free_answers.items()}
        rows.append(("오로라(가중 투표)", aurora_wvote))

    # Individual models
    if free_answers:
        first_entry = next(iter(free_answers.values()))
        if "models" in first_entry:
            models = list(first_entry["models"].keys())
            for model_id in models:
                model_name = model_id.split("/")[-1]
                model_answers = {qid: entry["models"][model_id].get("answer", "")
                                 for qid, entry in free_answers.items()}
                rows.append((model_name, model_answers))

    # Oracle row: per question, max score across models
    oracle_answers = {}
    if free_answers and "models" in next(iter(free_answers.values())):
        models = list(next(iter(free_answers.values()))["models"].keys())
        for qid, entry in free_answers.items():
            qkind = qkind_map.get(qid)
            if not qkind:
                continue
            ground_truth = answer_key.get(qid, "")
            best_score = 0.0
            best_answer = ""
            for model_id in models:
                model_answer = entry["models"][model_id].get("answer", "")
                if model_answer:
                    s = score_answer(qkind, ground_truth, model_answer)
                    if s > best_score:
                        best_score = s
                        best_answer = model_answer
            # Oracle gets the best answer (if any model got full score, oracle gets that answer)
            # Actually, oracle gets 1 if any model got 1, or the max fractional score
            oracle_answers[qid] = best_answer
    rows.append(("오라클(한 모델이라도 최고점)", oracle_answers))

    # Get all kinds from questions.json, in order
    all_kinds = []
    for q in questions:
        k = q["kind"]
        if k not in all_kinds:
            all_kinds.append(k)

    # Total count
    total_count = len(questions)

    # Per-kind counts
    per_kind_counts = {}
    for k in all_kinds:
        per_kind_counts[k] = sum(1 for q in questions if q["kind"] == k)

    # Header
    print(f"{'':28}{'합계':>6}  " + "  ".join(f"{k:>8}" for k in all_kinds))

    # Score each row
    for name, ans_dict in rows:
        # Total score
        total_score = 0.0
        by_kind = {k: [0.0, 0] for k in all_kinds}  # [sum_score, count]

        for q in questions:
            qid = q["id"]
            qkind = q["kind"]
            ground_truth = answer_key.get(qid, "")
            answer = ans_dict.get(qid, "")
            score = score_answer(qkind, ground_truth, answer)
            total_score += score
            by_kind[qkind][0] += score
            by_kind[qkind][1] += 1

        # Print total (1 decimal)
        print(f"{name:28}{total_score:.1f}/{total_count}  " +
              "  ".join(f"{by_kind[k][0]:.1f}/{per_kind_counts[k]}" for k in all_kinds))


if __name__ == "__main__":
    main()