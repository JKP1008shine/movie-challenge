"""Locks each week's watchlists and picks when that week starts.

Weeks start at 12:00 am IST on Tuesday (Monday midnight). For every week whose
start has passed and that isn't locked yet, this saves each player's latest
watchlist and picks for that week (submitted before the lock) into
locked/locks.json. A week, once locked, is never rewritten.

Run by the "Lock watchlists" and "Sync Letterboxd" GitHub Actions.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

LOCKS = {  # week -> lock time (12:00 am IST on the week's first day)
    "1": datetime(2026, 11, 30, 18, 30, tzinfo=timezone.utc),
    "2": datetime(2026, 12, 7, 18, 30, tzinfo=timezone.utc),
    "3": datetime(2026, 12, 14, 18, 30, tzinfo=timezone.utc),
    "4": datetime(2026, 12, 21, 18, 30, tzinfo=timezone.utc),
}
OUT = "locked/locks.json"
REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ.get("GITHUB_TOKEN", "")

data = {"weeks": {}}
if os.path.exists(OUT):
    data = json.load(open(OUT, encoding="utf-8"))
weeks = data.setdefault("weeks", {})

now = datetime.now(timezone.utc)
force = os.environ.get("FORCE") == "yes"
due = [w for w, t in LOCKS.items() if w not in weeks and (now >= t or force)]
if not due:
    print("Nothing to lock right now."); sys.exit(0)

players = [p.lower() for p in re.findall(r'github:\s*"([^"]+)"', open("config.js", encoding="utf-8").read())]

def get(url):
    headers = {"Accept": "application/vnd.github+json"}
    if TOKEN: headers["Authorization"] = f"Bearer {TOKEN}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
        return json.load(r)

issues, page = [], 1
while True:
    batch = get(f"https://api.github.com/repos/{REPO}/issues?state=open&per_page=100&page={page}")
    issues += batch
    if len(batch) < 100: break
    page += 1

def week_of(body):
    m = re.search(r"###\s*Week\s*\n+\s*Week\s*(\d)", body or "")
    return m.group(1) if m else None

for w in due:
    lock = LOCKS[w]
    snap = {"lockedAt": now.isoformat(timespec="seconds"), "lists": {}, "picks": {}}
    for i in issues:
        if i.get("pull_request"): continue
        body = i.get("body") or ""
        login = (i.get("user") or {}).get("login", "")
        if login.lower() not in players or week_of(body) != w: continue
        if datetime.fromisoformat(i["created_at"].replace("Z", "+00:00")) >= lock: continue
        kind = "lists" if "### Theme films" in body else ("picks" if "### Pick 1" in body else None)
        if not kind: continue
        cur = snap[kind].get(login.lower())
        if not cur or i["created_at"] > cur["created_at"]:
            snap[kind][login.lower()] = {"login": login, "number": i["number"], "created_at": i["created_at"], "body": body}
    weeks[w] = snap
    print(f"Locked week {w}: {len(snap['lists'])} watchlists, {len(snap['picks'])} sets of picks")

os.makedirs("locked", exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
