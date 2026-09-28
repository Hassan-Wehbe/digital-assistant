#!/usr/bin/env bash
# Build (and optionally run) the SQL tests. Each test runs inside one
# transaction that is always rolled back, so nothing persists.
#
#   tests/sql/run.sh --print 01   # print the full script for test 01 (paste into
#                                 # the Supabase SQL editor, or run via the connector)
#   DATABASE_URL=... tests/sql/run.sh   # run every test with psql
#
# Each script ends by listing every check with passed = true/false.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"

build() {
  echo "begin;"
  cat "$dir/_setup.sql" "$1"
  echo "select test, passed, detail from _results order by n;"
  echo "rollback;"
}

if [[ "${1:-}" == "--print" ]]; then
  build "$(ls "$dir"/"${2:?test number}"_*.sql)"
  exit 0
fi

: "${DATABASE_URL:?set DATABASE_URL (Supabase: Project Settings > Database > Connection string)}"
failed=0
for f in "$dir"/[0-9][0-9]_*.sql; do
  echo "== $(basename "$f")"
  out="$(build "$f" | psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -A -F ' | ' -t)" || { failed=1; continue; }
  echo "$out"
  grep -q ' | f | \| | f$' <<<"$out" && failed=1
done
exit $failed
