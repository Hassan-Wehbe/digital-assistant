#!/usr/bin/env bash
# Lists every local file an Edge Function needs, as paths relative to supabase/functions
# (its entry point's import graph plus its deno.json). Used to deploy with the Supabase
# connector's deploy_edge_function, which takes a file list, and to check a deploy afterwards.
#   scripts/function-files.sh chat
set -euo pipefail
name="${1:?usage: scripts/function-files.sh <function name>}"
cd "$(dirname "$0")/../supabase/functions"
{
  echo "$name/deno.json"
  deno info --json --config "$name/deno.json" "$name/index.ts" | python3 -c '
import json, os, sys
for m in json.load(sys.stdin)["modules"]:
    s = m.get("specifier", "")
    if s.startswith("file://"):
        print(os.path.relpath(s[len("file://"):], os.getcwd()))'
} | sort -u
