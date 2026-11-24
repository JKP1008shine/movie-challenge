"""Saves each player's watchlist into locked/watchlists.json when the challenge starts.

Run by the "Lock watchlists" GitHub Action. It only ever writes the file once.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

LOCK = datetime(2026, 11, 30, 18, 30, tzinfo=timezone.utc)  # Tue 1 Dec 2026, 12:00 am IST
OUT = "locked/watchlists.json"
REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]

if os.path.exists(OUT):
    print("Already locked, nothing to do."); sys.exit(0)
now = datetime.now(timezone.utc)
if now < LOCK and os.environ.get("FORCE") != "yes":
    print("Too early: watchlists lock at", LOCK.isoformat()); sys.exit(0)

players = [p.lower() for p in re.findall(r'github:\s*"([^"]+)"', open("config.js", encoding="utf-8").read())]

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

issues, page = [], 1
while True:
    batch = get(f"https://api.github.com/repos/{REPO}/issues?state=open&per_page=100&page={page}")
    issues += batch
    if len(batch) < 100: break
    page += 1

lists = {}
for i in issues:
    if i.get("pull_request"): continue
    body = i.get("body") or ""
    login = (i.get("user") or {}).get("login", "")
    if "### My watchlist" not in body or login.lower() not in players: continue
    created = datetime.fromisoformat(i["created_at"].replace("Z", "+00:00"))
    if created >= LOCK: continue
    cur = lists.get(login.lower())
    if not cur or i["created_at"] > cur["created_at"]:
        lists[login.lower()] = {"login": login, "number": i["number"], "created_at": i["created_at"], "body": body}

os.makedirs("locked", exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"lockedAt": now.isoformat(), "lists": lists}, f, ensure_ascii=False, indent=2)
print("Locked", len(lists), "watchlists:", ", ".join(lists))
