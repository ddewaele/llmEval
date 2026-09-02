#!/usr/bin/env bash
# Fails when the tree contains things that must never reach a PR.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
check() { # $1 = description, rest = grep args
  local desc="$1"; shift
  if out=$(grep -rnE "$@" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist packages apps 2>/dev/null); then
    echo "✖ $desc"; echo "$out" | head -20; status=1
  fi
}
check "focused or skipped tests" '\b(it|test|describe)\.(only|skip)\('
check "TODO/FIXME/XXX markers" '\b(TODO|FIXME|XXX)\b'
check "console.log in library/server source" 'console\.log\(' --exclude='*.test.ts' --exclude-dir=bin --exclude-dir=web
if git ls-files --others --exclude-standard | grep -E '(^|/)(repro|debug|e2e|smoke)[-.]' >/dev/null; then
  echo "✖ scratch files present:"; git ls-files --others --exclude-standard | grep -E '(^|/)(repro|debug|e2e|smoke)[-.]'; status=1
fi
[ $status -eq 0 ] && echo "✓ hygiene ok"
exit $status
