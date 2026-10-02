#!/usr/bin/env bash
# Print a dry run of a migration together with one SQL test: the migration, the shared setup
# and the test in one transaction that ends with a deliberate error, so nothing persists even
# when the SQL runner commits on success. The error message carries the results.
#
#   tests/sql/dry_run.sh supabase/migrations/<file>.sql 09
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
echo "begin;"
cat "${1:?migration file}" "$dir/_setup.sql" "$(ls "$dir"/"${2:?test number}"_*.sql)"
echo "do \$\$ begin raise exception 'DRY RUN RESULTS (rolled back): %', (select json_agg(json_build_object('t', test, 'ok', passed, 'd', detail) order by n) from _results); end \$\$;"
