"""End-to-end test of the deployed MCP server, acting like the Claude app.

Needs a THROWAWAY test user with no data (never your real account: the test
creates spaces and items). Delete the user afterwards; that removes its data.

  E2E_EMAIL=... E2E_PASSWORD=... python3 tests/e2e/e2e.py
"""
import json, os, time, urllib.request, urllib.error
B = os.environ.get("SUPABASE_URL", "https://motvckmpusxiuelpwqxy.supabase.co")
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fUOMLFoWl6Avh7NqvhKBNQ_swuHkZGd")
EMAIL = os.environ["E2E_EMAIL"]
PW = os.environ["E2E_PASSWORD"]

def http(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

st, out = http(f"{B}/auth/v1/token?grant_type=password", {"email": EMAIL, "password": PW},
               {"apikey": KEY, "content-type": "application/json"})
assert st == 200, (st, out)
token = json.loads(out)["access_token"]
print("sign-in: ok")

n = 0
def call(name, args):
    global n; n += 1
    t = time.time()
    st, out = http(f"{B}/functions/v1/mcp", {"jsonrpc": "2.0", "id": n, "method": "tools/call", "params": {"name": name, "arguments": args}},
                   {"authorization": f"Bearer {token}", "content-type": "application/json", "accept": "application/json, text/event-stream"})
    res = json.loads(out)
    if "error" in res: raise SystemExit(f"{name}: protocol error {res['error']}")
    text = res["result"]["content"][0]["text"]
    err = res["result"].get("isError", False)
    print(f"{name} ({time.time()-t:.1f}s){' ERROR' if err else ''}: {text[:400]}")
    return None if err else json.loads(text)

st, out = http(f"{B}/functions/v1/mcp", {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "0"}}},
               {"authorization": f"Bearer {token}", "content-type": "application/json", "accept": "application/json, text/event-stream"})
print("initialize:", st, json.loads(out)["result"]["serverInfo"])
call("create_space", {"name": "Recipes"})
call("create_space", {"name": "Work"})
call("create_space", {"name": "Gartner", "parent": "Work"})
call("create_space", {"name": "Private", "restricted": True})
pasta = call("save_item", {"space": "Recipes", "item_type": "recipe", "title": "Lemon pasta", "tags": ["weeknight"],
  "body": "Boil spaghetti. Toss with butter, lemon zest, lemon juice, parmesan and black pepper."})
design = call("save_item", {"space": "Work/Gartner", "item_type": "design", "title": "Teams to Service Cloud routing timeout",
  "body": "Calls timed out because the Omni-Channel queue capacity was 1. We raised it to 5 and added an overflow queue.",
  "tags": ["salesforce", "teams"]})
call("save_item", {"space": "Private", "item_type": "note", "title": "Dentist", "body": "My dentist is Dr. Haddad, Tuesday check-ups."})
long_body = "\n\n".join(f"Section {i}: the routing engine assigns work items to agents based on capacity, skills and presence status." * 7 for i in range(25))
long_body += "\n\nAppendix: the zebra escalation rule sends VIP callers straight to tier three."
call("save_item", {"space": "Work", "item_type": "note", "title": "Long routing notes", "body": long_body})
def pending():
    req = urllib.request.Request(f"{B}/rest/v1/item_chunk?embedding=is.null&select=id", headers={"apikey": KEY, "authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as r: return len(json.loads(r.read()))
for _ in range(30):
    p = pending(); print("pending chunks:", p)
    if p == 0: break
    time.sleep(3)
assert pending() == 0, "background embedding did not finish"
r = call("search_items", {"query": "which callers skip straight to the top support tier?"})
assert "Long routing notes" in [x["title"] for x in r["results"][:2]], "last chunk searchable by meaning"
r = call("search_items", {"query": "why did Teams calls time out?"})
assert r["results"][0]["title"].startswith("Teams to Service Cloud"), "semantic search top hit"
r = call("search_items", {"query": "something quick with citrus for dinner"})
assert r["results"][0]["title"] == "Lemon pasta", "semantic (no shared keywords) top hit"
r = call("search_items", {"tags": ["weeknight"]})
assert [x["title"] for x in r["results"]] == ["Lemon pasta"]
r = call("search_items", {"query": "dentist Haddad"})
assert all(x["title"] != "Dentist" for x in r["results"]), "restricted item leaked"
r = call("search_items", {"query": "dentist", "space": "Private"})
assert r["results"] == [], "restricted space searchable"
call("update_item", {"item_id": pasta["id"], "body": "Boil spaghetti. Toss with butter, lemon zest, lemon juice, parmesan, black pepper and chilli flakes.", "change_note": "spicier version"})
g = call("get_item", {"item_id": pasta["id"]})
assert g["revision_count"] == 1 and "chilli" in g["body_markdown"]
call("link_items", {"from_item_id": design["id"], "to_item_id": pasta["id"], "relation": "related"})
call("list_spaces", {})
call("get_item", {"item_id": "00000000-0000-4000-a000-000000000999"})
print("E2E: all assertions passed")
