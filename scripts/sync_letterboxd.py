"""Copies each player's December Letterboxd diary entries into data/letterboxd.json.

Run every hour by the "Sync Letterboxd" GitHub Action. Reads each player's public
diary feed (https://letterboxd.com/USERNAME/rss/). Entries are only ever added or
annotated, never silently rewritten: the first version seen is kept, and later
changes to the watched date or film are recorded so the site can flag them.
"""
import html, json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

START, END = "2026-12-01", "2026-12-31"
OUT = "data/letterboxd.json"

cfg = open("config.js", encoding="utf-8").read()
users = re.findall(r'letterboxd:\s*"([^"]+)"', cfg)
if not users:
    print("No Letterboxd usernames in config.js"); sys.exit(0)

data = {"entries": {}}
if os.path.exists(OUT):
    data = json.load(open(OUT, encoding="utf-8"))
entries = data.setdefault("entries", {})
now = datetime.now(timezone.utc).isoformat(timespec="seconds")

def text(el, tag):
    """Child text by local tag name, whatever namespace address the feed uses."""
    name = tag.split(":")[-1]
    for child in el:
        if child.tag == name or child.tag.endswith("}" + name):
            return (child.text or "").strip()
    return ""

def review_text(desc):
    desc = re.sub(r"<img[^>]*>", " ", desc or "")
    desc = re.sub(r"<br\s*/?>|</p>", "\n", desc)
    desc = re.sub(r"<[^>]+>", " ", desc)
    desc = html.unescape(desc)
    return re.sub(r"[ \t]+", " ", desc).strip()[:2000]

ok = 0
for user in users:
    url = f"https://letterboxd.com/{user}/rss/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "movie-challenge-sync/1.0 (+github.com)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            root = ET.fromstring(r.read())
    except Exception as e:  # keep what we have if Letterboxd can't be reached
        print(f"Couldn't read {url}: {e}")
        continue
    ok += 1
    present, oldest = set(), None
    for item in root.iter("item"):
        g = text(item, "guid")
        if g: present.add(g)
        try:
            t = parsedate_to_datetime(text(item, "pubDate")).astimezone(timezone.utc).isoformat(timespec="seconds")
            oldest = t if oldest is None or t < oldest else oldest
        except Exception:
            pass
    for item in root.iter("item"):
        watched = text(item, "lb:watchedDate")
        if not watched or not (START <= watched <= END):
            continue
        guid = text(item, "guid")
        pub = text(item, "pubDate")
        try:
            logged = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat(timespec="seconds")
        except Exception:
            logged = ""
        rec = {
            "user": user,
            "title": text(item, "lb:filmTitle"),
            "year": text(item, "lb:filmYear"),
            "watchedDate": watched,
            "rewatch": text(item, "lb:rewatch").lower() == "yes",
            "tmdbId": text(item, "tmdb:movieId"),
            "link": text(item, "link"),
            "loggedAt": logged,
            "review": review_text(text(item, "description")),
        }
        old = entries.get(guid)
        if old is None:
            rec["firstSeen"] = now
            entries[guid] = rec
            continue
        # Keep the first version; record changes so the site can flag them.
        for key in ("watchedDate", "title", "rewatch"):
            if rec[key] != old.get(key):
                old.setdefault("changes", []).append({"at": now, "field": key, "from": old.get(key), "to": rec[key]})
                old[key] = rec[key]
        old["review"] = rec["review"]  # Instagram link may be added after logging
        old["lastSeen"] = now

    # An entry that's gone from the feed, while older entries are still in it, was deleted on Letterboxd.
    for guid, e in entries.items():
        if e.get("user") != user: continue
        gone = guid not in present and oldest is not None and (e.get("loggedAt") or "") >= oldest
        if gone != bool(e.get("removed")):
            e["removed"] = gone
            e.setdefault("changes", []).append({"at": now, "field": "removed", "from": not gone, "to": gone})

if ok:
    data["syncedAt"] = now
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
print(f"Read {ok} of {len(users)} feeds; {len(entries)} December entries stored.")
