#!/bin/zsh
# Run a model-written solution against hidden tests with no network and no writes outside a temp dir.
# Usage: run_code.sh <task_id> <solution.py>
set -u
dir=$(mktemp -d /Volumes/DevBuild/tmp/bench-run.XXXXXX)
cp "$2" "$dir/solution.py"
cp "${0:A:h}/code_tests.py" "$dir/code_tests.py"
profile="(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath \"$dir\") (literal \"/dev/null\"))"
cd "$dir"
out=$(/usr/bin/perl -e 'alarm 20; exec @ARGV' /usr/bin/sandbox-exec -p "$profile" /opt/homebrew/bin/python3.14 -I code_tests.py "$1" solution.py 2>/dev/null)
rm -rf "$dir"
[[ -n "$out" ]] && print -r -- "$out" || print '{"passed":0,"total":1,"fails":["timeout or crash"]}'
