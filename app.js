(function () {
  "use strict";
  var CFG = window.CHALLENGE || {};
  var REPO = CFG.repo;
  var PLAYERS = (CFG.players || []).map(function (p, i) { return { key: p.key, name: p.name, handle: String(p.github || ""), github: String(p.github || "").toLowerCase(), cls: i === 0 ? "p1" : "p2" }; });
  var WEEKS = [
    { start: "2026-12-01", end: "2026-12-06", min: 5, theme: "The Comeback" },
    { start: "2026-12-07", end: "2026-12-13", min: 5, theme: "World Tour" },
    { start: "2026-12-14", end: "2026-12-20", min: 5, theme: "Director Deep Dive" },
    { start: "2026-12-21", end: "2026-12-27", min: 5, theme: "Decades Run" },
    { start: "2026-12-28", end: "2026-12-31", min: 3, theme: "2026 Catch-up" }
  ];
  var QUESTS = [
    { id: "theatre", match: "theatre", label: "Watched a film in a theatre", pts: 2 },
    { id: "silent", match: "silent", label: "Watched a silent film", pts: 2 },
    { id: "long", match: "3-hour", label: "Watched a 3-hour+ film", pts: 2 },
    { id: "country", match: "brand-new country", label: "A brand-new country for both", pts: 2 },
    { id: "marathon", match: "3 films in one day", label: "3 films in one day", pts: 3 },
    { id: "together", match: "debated together", label: "Watched + debated together", pts: 2 },
    { id: "convert", match: "converted a friend", label: "Converted a friend", pts: 2 }
  ];
  var S = { films: [], bonuses: [], spots: [], ignored: 0, filter: "all", loaded: false, error: "", updated: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "text") n.textContent = v; else if (k === "cls") n.className = v; else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ""); else n.setAttribute(k, String(v)); }
    (kids || []).forEach(function (c) { if (c == null) return; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fmtDate(s) { if (!s) return ""; var p = String(s).split("-"); var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return parseInt(p[2], 10) + " " + (m[parseInt(p[1], 10) - 1] || ""); }
  function rupees(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function num(n) { return (Math.round(n * 10) / 10).toString(); }
  function pinfo(k) { return PLAYERS.filter(function (p) { return p.key === k; })[0]; }
  function playerOf(login) { login = String(login || "").toLowerCase(); var p = PLAYERS.filter(function (x) { return x.github === login; })[0]; return p ? p.key : null; }

  /* ---------- tabs ---------- */
  function showTab() {
    var h = (location.hash || "#tracker").slice(1);
    var t = h.indexOf("r-") === 0 ? "rules" : (h.indexOf("h-") === 0 ? "howto" : h);
    if (["tracker", "howto", "rules", "pamphlet"].indexOf(t) < 0) t = "tracker";
    document.querySelectorAll(".tabs a").forEach(function (a) { if (a.dataset.tab === t) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.querySelectorAll("section.view").forEach(function (s) { s.classList.toggle("on", s.id === "v-" + t); });
    if (h.indexOf("r-") === 0 || h.indexOf("h-") === 0) { var tg = $(h); if (tg) tg.scrollIntoView(); }
  }
  window.addEventListener("hashchange", showTab); showTab();

  /* ---------- links ---------- */
  var base = "https://github.com/" + REPO + "/issues/new?template=";
  $("lnkFilm").href = base + "log-film.yml";
  $("lnkBonus").href = base + "bonus.yml";
  $("lnkSpot").href = base + "spot-check.yml";
  var acct = $("acct");
  acct.appendChild(el("a", { href: "https://github.com/" + REPO + "/issues", target: "_blank", rel: "noopener", style: "color:#fff", text: "All entries on GitHub ↗" }));

  /* ---------- parsing issue forms ---------- */
  function sections(body) {
    var out = {}; var parts = String(body || "").split(/^###\s+/m);
    parts.slice(1).forEach(function (p) {
      var i = p.indexOf("\n"); var head = (i < 0 ? p : p.slice(0, i)).trim(); var val = (i < 0 ? "" : p.slice(i + 1)).trim();
      if (val === "_No response_") val = "";
      out[head.toLowerCase()] = val;
    });
    return out;
  }
  function proofText(sec) {
    for (var k in sec) if (k.indexOf("extra proof") === 0 || k.indexOf("proof photos") === 0 || k.indexOf("proof link") === 0) return sec[k] || "";
    return "";
  }
  function proofParts(note) {
    var urls = [], txt = String(note || "");
    txt = txt.replace(/<img[^>]*src="(https:\/\/[^"]+)"[^>]*>/gi, function (_, u) { urls.push(u); return " "; });
    txt = txt.replace(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g, function (_, u) { urls.push(u); return " "; });
    txt = txt.replace(/\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g, function (_, u) { urls.push(u); return " "; });
    txt = txt.replace(/https:\/\/[^\s)<>"]+/g, function (u) { urls.push(u); return " "; });
    return { urls: urls, text: txt.replace(/\s+/g, " ").trim() };
  }
  function checked(text, word) {
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) { var l = lines[i].toLowerCase(); if (l.indexOf("[x]") >= 0 && l.indexOf(word) >= 0) return true; }
    return false;
  }
  function classify(issues) {
    var films = [], bonuses = [], spots = [], ignored = 0;
    issues.forEach(function (is) {
      if (is.pull_request) return;
      var player = playerOf(is.user && is.user.login);
      var sec = sections(is.body);
      var base = { num: is.number, url: is.html_url, player: player, at: is.created_at || "" };
      var isFilm = "movie" in sec, isBonus = "what are you claiming?" in sec, isSpot = "film issue number" in sec;
      if (!isFilm && !isBonus && !isSpot) return;
      if (!player) { ignored++; return; }
      if (isFilm) {
        var flags = sec["extras"] || "";
        var y = parseInt(sec["year of release"], 10);
        films.push(Object.assign(base, {
          title: sec["movie"] || "Untitled", year: isNaN(y) ? null : y,
          date: String(sec["watched on"] || "").slice(0, 10),
          insta: String(sec["instagram post link"] || "").trim(),
          proof: sec["post type"] ? (/^reel/i.test(sec["post type"]) ? "Instagram reel" : "Instagram carousel") : (sec["proof"] || ""),
          note: proofText(sec),
          rewatch: checked(flags, "rewatch"), short: checked(flags, "short under"), assigned: checked(flags, "assigned"),
          review: /^reel/i.test(sec["post type"] || "") || checked(flags, "review posted"), theme: checked(flags, "theme")
        }));
      } else if (isBonus) {
        var wk = String(sec["which week? (needed for sick day pass)"] || "").match(/Week\s*(\d)/i);
        bonuses.push(Object.assign(base, { kind: String(sec["what are you claiming?"] || ""), week: wk ? parseInt(wk[1], 10) - 1 : -1 }));
      } else {
        var fn = parseInt(String(sec["film issue number"] || "").replace(/[^0-9]/g, ""), 10);
        spots.push(Object.assign(base, { film: fn, failed: /^failed/i.test(sec["result"] || "") }));
      }
    });
    // spot-checks: only the first 3 per player count, and only on the opponent's films
    spots.sort(function (a, b) { return a.at.localeCompare(b.at); });
    var used = {}; var failedNums = {};
    var filmByNum = {}; films.forEach(function (f) { filmByNum[f.num] = f; });
    spots.forEach(function (s) {
      var f = filmByNum[s.film];
      s.valid = !!(f && f.player !== s.player) && (used[s.player] || 0) < 3;
      if (s.valid) { used[s.player] = (used[s.player] || 0) + 1; if (s.failed) failedNums[s.film] = true; }
    });
    films.forEach(function (f) { f.failed = !!failedNums[f.num]; });
    S.films = films; S.bonuses = bonuses; S.spots = spots; S.ignored = ignored; S.spotUsed = used;
  }

  /* ---------- scoring ---------- */
  function filmValue(f) { return f.failed ? 0 : ((f.rewatch || f.short) ? 0.5 : 1); }
  function filmPoints(f) { if (f.failed) return -2; var y = f.year; return filmValue(f) + ((y && y < 1980) ? 1 : 0) + (f.assigned ? 1 : 0) + (f.review ? 2 : 0); }
  function weekIndex(d) { for (var i = 0; i < WEEKS.length; i++) if (d >= WEEKS[i].start && d <= WEEKS[i].end) return i; return -1; }
  function calc(key) {
    var today = todayStr();
    var fs = S.films.filter(function (f) { return f.player === key; });
    var bs = S.bonuses.filter(function (b) { return b.player === key; }).sort(function (a, b) { return a.at.localeCompare(b.at); });
    var quests = {}, qpts = 0, sick = -1, don = null;
    bs.forEach(function (b) {
      var k = b.kind.toLowerCase();
      if (k.indexOf("side quest") === 0) { QUESTS.forEach(function (q) { if (k.indexOf(q.match) >= 0 && !quests[q.id]) { quests[q.id] = true; qpts += q.pts; } }); }
      else if (k.indexOf("sick day") >= 0) { if (sick < 0 && b.week >= 0) sick = b.week; }
      else if (k.indexOf("double or nothing") >= 0) { if (don === null) don = k.indexOf("won") >= 0 ? 3 : -3; }
    });
    var films = 0, pts = 0;
    var weeks = WEEKS.map(function () { return { count: 0, theme: 0 }; });
    fs.forEach(function (f) { films += filmValue(f); pts += filmPoints(f); var wi = weekIndex(f.date); if (wi >= 0) { weeks[wi].count += filmValue(f); if (f.theme && !f.failed) weeks[wi].theme++; } });
    var missed = 0, owes = 0, themeBonus = 0;
    weeks.forEach(function (w, i) {
      var W = WEEKS[i]; w.done = w.theme >= 2; if (w.done) themeBonus += 2;
      if (today < W.start) w.status = "soon";
      else if (today <= W.end) w.status = "wip";
      else if (w.count >= W.min) w.status = "ok";
      else if (sick === i) w.status = "sick";
      else { w.status = "bad"; missed++; w.fine = (W.min - w.count) * 200; owes += w.fine; }
    });
    var extra = don || 0;
    return { films: films, pts: pts, themeBonus: themeBonus, qpts: qpts, extra: extra, don: don, missed: missed, owes: owes, total: pts + themeBonus + qpts + extra - 3 * missed, weeks: weeks, count: fs.length, sick: sick, quests: quests, spot: (S.spotUsed && S.spotUsed[key]) || 0 };
  }

  /* ---------- render ---------- */
  function render() { renderStatus(); renderScore(); renderWeeks(); renderExtras(); renderLog(); }
  function renderStatus() {
    var s = $("status"); clear(s);
    var setup = PLAYERS.some(function (p) { return !p.github || p.github.indexOf("_username") >= 0 || p.github.indexOf("github_username") >= 0; });
    if (setup) s.appendChild(el("div", { cls: "note", text: "Setup: put both GitHub usernames in config.js, or a player's entries won't count." }));
    if (S.error) s.appendChild(el("div", { cls: "note err", text: S.error }));
    if (S.ignored) s.appendChild(el("div", { cls: "note", text: S.ignored + " entr" + (S.ignored === 1 ? "y" : "ies") + " from other GitHub accounts ignored." }));
    $("updated").textContent = S.updated ? ("Updated " + S.updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ". New entries show up when you refresh.") : (S.loaded ? "" : "Loading…");
  }
  function renderScore() {
    var box = $("score"); clear(box);
    var c = {}; PLAYERS.forEach(function (p) { c[p.key] = calc(p.key); });
    var a = PLAYERS[0], b = PLAYERS[1], leader = null;
    if (a && b) { if (c[a.key].total !== c[b.key].total) leader = c[a.key].total > c[b.key].total ? a.key : b.key; else if (c[a.key].films !== c[b.key].films) leader = c[a.key].films > c[b.key].films ? a.key : b.key; }
    var anyFilms = S.films.length > 0;
    PLAYERS.forEach(function (p) {
      var r = c[p.key], pct = Math.min(100, Math.round(r.films / 25 * 100));
      box.appendChild(el("article", { cls: "pcard " + p.cls, "aria-label": p.name + " scorecard" }, [
        el("header", null, [el("div", null, [el("div", { cls: "pname", text: p.name.toUpperCase() }), el("div", { cls: "muted", style: "font-size:12px", text: "@" + p.handle })]), leader === p.key && anyFilms ? el("span", { cls: "lead", text: "LEADING" }) : null]),
        el("div", null, [el("div", { style: "display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px" }, [el("span", { text: num(r.films) + " of 25 films" }), el("span", { text: pct + "%" })]),
          el("div", { cls: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "25", "aria-valuenow": String(r.films), "aria-label": p.name + " progress to 25 films" }, [el("i", { style: "width:" + pct + "%" })])]),
        el("div", { cls: "stats" }, [
          el("div", { cls: "stat" }, [el("b", { text: num(r.total) }), el("span", { text: "final score" })]),
          el("div", { cls: "stat" }, [el("b", { text: num(r.pts) }), el("span", { text: "film points" })]),
          el("div", { cls: "stat" }, [el("b", { text: (r.themeBonus + r.qpts + r.extra >= 0 ? "+" : "") + num(r.themeBonus + r.qpts + r.extra) }), el("span", { text: "bonuses" })]),
          el("div", { cls: "stat owes" }, [el("b", { text: rupees(r.owes) }), el("span", { text: r.missed ? ("owes · " + r.missed + " missed wk") : "owes the pot" })])
        ])
      ]));
    });
    var pot = PLAYERS.reduce(function (s, p) { return s + c[p.key].owes; }, 0);
    box.appendChild(el("p", { cls: "muted", style: "grid-column:1/-1;margin:0;font-size:14px", text: "Pot so far: " + rupees(pot) + ". Fines are ₹200 per film short of each week's minimum, counted when the week ends." }));
  }
  function renderWeeks() {
    var t = $("weekTbl"); clear(t);
    var c = {}; PLAYERS.forEach(function (p) { c[p.key] = calc(p.key); });
    t.appendChild(el("tr", null, [el("th", { text: "Week" }), el("th", { text: "Theme" }), el("th", { text: "Min" })].concat(PLAYERS.map(function (p) { return el("th", { text: p.name }); }))));
    var L = { soon: ["Upcoming", "soon"], wip: ["In progress", "wip"], ok: ["Done", "ok"], sick: ["Sick Day Pass", "wip"], bad: ["Missed", "bad"] };
    WEEKS.forEach(function (W, i) {
      var cells = PLAYERS.map(function (p) {
        var w = c[p.key].weeks[i], l = L[w.status];
        var kids = [el("div", { text: num(w.count) + " film" + (w.count === 1 ? "" : "s") }), el("span", { cls: "pill " + l[1], text: l[0] + (w.status === "bad" ? " · " + rupees(w.fine) : "") })];
        if (w.done) kids.push(el("div", { style: "font-size:12px;color:var(--ok);margin-top:3px", text: "Theme done +2" }));
        return el("td", null, kids);
      });
      t.appendChild(el("tr", null, [el("td", null, [el("strong", { text: "Week " + (i + 1) }), el("div", { cls: "muted", style: "font-size:12px", text: fmtDate(W.start) + " – " + fmtDate(W.end) })]), el("td", { text: W.theme }), el("td", { text: String(W.min) })].concat(cells)));
    });
  }
  function renderExtras() {
    var box = $("extras"); clear(box);
    PLAYERS.forEach(function (p) {
      var r = calc(p.key);
      var ql = el("div", { cls: "qlist" });
      QUESTS.forEach(function (q) {
        ql.appendChild(el("label", null, [el("span", { "aria-hidden": "true", style: "width:18px;text-align:center;font-weight:700;color:" + (r.quests[q.id] ? "var(--ok)" : "#bbb"), text: r.quests[q.id] ? "✓" : "○" }), q.label, el("span", { cls: "pt", text: "+" + q.pts })]));
      });
      box.appendChild(el("div", { cls: "pcard " + p.cls }, [
        el("div", { cls: "pname", style: "font-size:22px", text: p.name.toUpperCase() }),
        el("div", null, [el("strong", { text: "Side quests" }), ql]),
        el("div", { style: "font-size:14px" }, [el("strong", { text: "Sick Day Pass: " }), r.sick >= 0 ? "used on week " + (r.sick + 1) : "not used"]),
        el("div", { style: "font-size:14px" }, [el("strong", { text: "Double or Nothing: " }), r.don === null ? "not used" : (r.don > 0 ? "won (+3)" : "lost (−3)")]),
        el("div", { style: "font-size:14px" }, [el("strong", { text: "Spot-checks used: " }), r.spot + " / 3"])
      ]));
    });
  }
  function renderLog() {
    var t = $("logTbl"); clear(t);
    var rows = S.films.filter(function (f) { return S.filter === "all" || f.player === S.filter; }).slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || b.num - a.num; });
    t.appendChild(el("tr", null, [el("th", { text: "Date" }), el("th", { text: "Who" }), el("th", { text: "Movie" }), el("th", { text: "Proof" }), el("th", { text: "Pts" }), el("th", { text: "Issue" })]));
    if (!rows.length) { t.appendChild(el("tr", null, [el("td", { colspan: "6", cls: "muted", text: S.loaded ? "No films logged yet. The first one sets the tone." : "Loading…" })])); return; }
    rows.forEach(function (f) {
      var p = pinfo(f.player) || { name: "?", cls: "" };
      var tags = el("div", { cls: "tags" });
      [["rewatch", "Rewatch"], ["short", "Short"], ["assigned", "Assigned"], ["review", "Reel +2"], ["theme", "Theme"]].forEach(function (x) { if (f[x[0]]) tags.appendChild(el("span", { cls: "tag", text: x[1] })); });
      if (f.year && f.year < 1980) tags.appendChild(el("span", { cls: "tag", text: "Pre-1980" }));
      if (f.failed) tags.appendChild(el("span", { cls: "pill bad", text: "Failed spot-check" }));
      var pp = proofParts(f.note), noteTxt = pp.text;
      var ig = /^https:\/\/(www\.)?instagram\.com\//i.test(f.insta) ? f.insta : (/^(www\.)?instagram\.com\//i.test(f.insta) ? "https://" + f.insta : "");
      var linkKids = [];
      if (ig) linkKids.push(el("a", { href: ig, target: "_blank", rel: "noopener noreferrer", text: "Instagram post" }));
      pp.urls.slice(0, 3).forEach(function (u, i) { linkKids.push(el("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: "Extra " + (i + 1) })); });
      var links = linkKids.length ? el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, linkKids) : el("span", { cls: "pill bad", text: "No post" });
      t.appendChild(el("tr", null, [
        el("td", { text: f.date ? fmtDate(f.date) : "?" }),
        el("td", null, [el("span", { cls: "pill " + p.cls, text: p.name })]),
        el("td", null, [el("strong", { text: f.title }), f.year ? el("span", { cls: "muted", text: " (" + f.year + ")" }) : null, tags]),
        el("td", null, [el("div", { style: "font-size:13px", text: f.proof }), links, noteTxt ? el("div", { cls: "muted", style: "font-size:13px;max-width:280px", text: noteTxt.length > 140 ? noteTxt.slice(0, 140) + "…" : noteTxt }) : null]),
        el("td", { style: "font-weight:700;white-space:nowrap", text: (filmPoints(f) > 0 ? "+" : "") + num(filmPoints(f)) }),
        el("td", null, [el("a", { href: f.url, target: "_blank", rel: "noopener", text: "#" + f.num })])
      ]));
    });
  }
  $("filters").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; S.filter = b.dataset.f; this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); renderLog(); });

  /* ---------- loading ---------- */
  var CACHE = "movie-challenge-cache-v1";
  function load() {
    S.error = ""; $("refresh").disabled = true;
    var all = [];
    function page(n) {
      return fetch("https://api.github.com/repos/" + REPO + "/issues?state=open&per_page=100&page=" + n, { headers: { Accept: "application/vnd.github+json" } })
        .then(function (r) {
          if (r.status === 403 || r.status === 429) throw new Error("rate");
          if (r.status === 404) throw new Error("notfound");
          if (!r.ok) throw new Error("http");
          return r.json();
        })
        .then(function (list) { all = all.concat(list); if (list.length === 100 && n < 5) return page(n + 1); });
    }
    page(1).then(function () {
      classify(all); S.loaded = true; S.updated = new Date();
      try { localStorage.setItem(CACHE, JSON.stringify(all)); } catch (e) {}
    }).catch(function (e) {
      S.loaded = true;
      S.error = e.message === "rate" ? "GitHub is limiting requests from this network for a bit. Showing the last saved scores; try Refresh in a few minutes."
        : e.message === "notfound" ? "Can't find the repo " + REPO + ". It must be public, and the name in config.js must match."
        : "Couldn't reach GitHub. Showing the last saved scores.";
      try { var c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c) classify(c); } catch (x) {}
    }).then(function () { $("refresh").disabled = false; render(); });
  }
  $("refresh").addEventListener("click", load);
  render(); load();
  setInterval(function () { if (!document.hidden) load(); }, 3 * 60 * 1000);
})();
