# Hidden tests for code tasks. Usage: python3 -I code_tests.py <task_id> <solution.py>
# Prints JSON {"passed": n, "total": m, "fails": [...]}.
import json
import sys

task, path = sys.argv[1], sys.argv[2]
ns = {}
src = open(path, encoding="utf-8").read()
cases = []


def case(name, fn):
    cases.append((name, fn))


def raises(exc, fn):
    try:
        fn()
    except exc:
        return True
    except Exception:
        return False
    return False


if task == "c1":
    def t(inp, out):
        case(repr(inp), lambda: ns["normalize_phone"](inp) == out)
    for s in ["01012345678", "010 1234 5678", "010-1234-5678", "+82 10-1234-5678", "+821012345678", "(010)1234-5678", " 010.1234.5678 ".replace(".", "-")]:
        t(s, "010-1234-5678")
    for s in ["011-123-4567", "010-123-456", "", "010-12a4-5678", "0101234567890", "+82 11-1234-5678"]:
        t(s, None)
elif task == "c2":
    def t(inp, out):
        case(repr(inp), lambda: ns["parse_duration"](inp) == out)
    for s, v in [("1시간 30분", 5400), ("45분 10초", 2710), ("2시간", 7200), ("1시간30분", 5400), ("90초", 90), ("1시간 0분 5초", 3605), ("10 분", 600), ("3시간5초", 10805)]:
        t(s, v)
    for s in ["", "30", "30분 1시간", "3일", "분", "1시간 1시간"]:
        case("err " + repr(s), lambda s=s: raises(ValueError, lambda: ns["parse_duration"](s)))
elif task == "c3":
    def t(inp, out):
        case(repr(inp), lambda: ns["format_krw"](inp) == out)
    for n, v in [(0, "0원"), (4567, "4,567원"), (10000, "1만원"), (1234567, "123만 4,567원"), (100000000, "1억원"), (120005000, "1억 2,000만 5,000원"), (1234567890123, "12,345억 6,789만 123원"), (-4567, "-4,567원"), (5, "5원"), (100010000, "1억 1만원"), (99999999, "9,999만 9,999원")]:
        t(n, v)
    for bad in [1.5, "100", True, None]:
        case("type " + repr(bad), lambda b=bad: raises(TypeError, lambda: ns["format_krw"](b)))
elif task == "c4":
    def inv():
        return ns["Inventory"]()

    def scenario():
        i = inv()
        i.add("사과", 5); i.add("배", 2); i.add("apple", 1); i.add("사과", 3)
        ok = i.count("사과") == 8 and i.count("없음") == 0
        i.remove("사과", 8)
        ok = ok and i.count("사과") == 0 and "사과" not in i.items()
        ok = ok and i.low_stock(3) == sorted(["배", "apple"])
        d = i.items(); d["배"] = 100
        ok = ok and i.count("배") == 2
        return ok
    case("scenario", scenario)
    case("remove unknown", lambda: raises(ValueError, lambda: inv().remove("x", 1)))
    def over():
        i = inv(); i.add("a", 1)
        return raises(ValueError, lambda: i.remove("a", 2)) and i.count("a") == 1
    case("remove too many keeps stock", over)
    for bad in [0, -1, 1.5, True, "3"]:
        case("bad qty " + repr(bad), lambda b=bad: raises(ValueError, lambda: inv().add("a", b)))
    for bad in ["", None, 3]:
        case("bad name " + repr(bad), lambda b=bad: raises(ValueError, lambda: inv().add(b, 1)))
    case("low_stock order", lambda: (lambda i: (i.add("b", 1), i.add("a", 1), i.add("c", 9), i.low_stock(5))[-1] == ["a", "b"])(inv()))
elif task == "c5":
    def t(inp, out):
        case(repr(inp)[:40], lambda: ns["parse_csv"](inp) == out)
    t("", [])
    t("a,b\n", [["a", "b"]])
    t("a,b", [["a", "b"]])
    t('a,b\n"c,d","e""f"\n', [["a", "b"], ["c,d", 'e"f']])
    t("a,,b", [["a", "", "b"]])
    t("a,", [["a", ""]])
    t('"x\ny",z\r\nq,r\r\n', [["x\ny", "z"], ["q", "r"]])
    t('"",""', [["", ""]])
    t("1,2\n3,4\n5,6", [["1", "2"], ["3", "4"], ["5", "6"]])
    t('"a""""b"', [['a""b']])
    case("unclosed", lambda: raises(ValueError, lambda: ns["parse_csv"]('"abc')))
elif task == "c6":
    def t(inp, out):
        case(inp, lambda: abs(ns["evaluate"](inp) - out) < 1e-9 and isinstance(ns["evaluate"](inp), float))
    for e, v in [("1+2*3", 7), ("(1+2)*3", 9), ("8-3-2", 3), ("8/4/2", 1), ("-3+5", 2), ("-(2+1)", -3), ("2*-3", -6), ("1.5*2", 3), (".5+.5", 1), (" 2 * ( 3 + 4 ) ", 14), ("--2", 2), ("10/4", 2.5), ("2*(3+(4-1))*2", 24)]:
        t(e, v)
    case("div0", lambda: raises(ZeroDivisionError, lambda: ns["evaluate"]("1/0")))
    for bad in ["", "(1+2", "2+", "2 3", "2$3", "1+2)"]:
        case("bad " + repr(bad), lambda b=bad: raises(ValueError, lambda: ns["evaluate"](b)))
else:
    raise SystemExit("unknown task")

result = {"passed": 0, "total": len(cases), "fails": []}
try:
    exec(compile(src, "solution", "exec"), ns)
except Exception as e:  # solution does not even load
    result["fails"].append("load: " + type(e).__name__)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0)
for name, fn in cases:
    try:
        ok = bool(fn())
    except Exception as e:
        ok = False
        name += " (" + type(e).__name__ + ")"
    if ok:
        result["passed"] += 1
    else:
        result["fails"].append(name)
print(json.dumps(result, ensure_ascii=False))
