(function () {
  "use strict";
  var CFG = window.CHALLENGE || {};
  var REPO = CFG.repo;
  var PLAYERS = (CFG.players || []).map(function (p, i) { return { key: p.key, name: p.name, handle: String(p.github || ""), github: String(p.github || "").toLowerCase(), lb: String(p.letterboxd || "").toLowerCase(), cls: i === 0 ? "p1" : "p2" }; });
  var WEEKS = [
    { start: "2026-12-01", end: "2026-12-07", min: 7, theme: "The Comeback" },
    { start: "2026-12-08", end: "2026-12-14", min: 6, theme: "World Tour" },
    { start: "2026-12-15", end: "2026-12-21", min: 6, theme: "Director Deep Dive" },
    { start: "2026-12-22", end: "2026-12-28", min: 6, theme: "Decades Run" }
  ];
  var END = "2026-12-28", FREE_END = "2026-12-31", PICKS_PER_WEEK = 3, PICKS_SPARE = 3;
  var QUESTS = [
    { id: "theatre", match: "theatre", label: "Watched a film in a theatre", pts: 2 },
    { id: "silent", match: "silent", label: "Watched a silent film", pts: 2 },
    { id: "long", match: "3-hour", label: "Watched a 3-hour+ film", pts: 2 },
    { id: "country", match: "brand-new country", label: "A brand-new country for both", pts: 2 },
    { id: "marathon", match: "3 films in one day", label: "3 films in one day", pts: 3 },
    { id: "together", match: "debated together", label: "Watched + debated together", pts: 2 },
    { id: "convert", match: "converted a friend", label: "Converted a friend", pts: 2 }
  ];
  function lockAt(i) { return new Date(WEEKS[i].start + "T00:00:00+05:30"); }
  function isLocked(i) { return new Date() >= lockAt(i); }
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
  function playerOfLb(u) { u = String(u || "").toLowerCase(); var p = PLAYERS.filter(function (x) { return x.lb && x.lb === u; })[0]; return p ? p.key : null; }
  function playerOf(login) { login = String(login || "").toLowerCase(); var p = PLAYERS.filter(function (x) { return x.github === login; })[0]; return p ? p.key : null; }

  /* ---------- tabs ---------- */
  function showTab() {
    var h = (location.hash || "#tracker").slice(1);
    var t = h.indexOf("r-") === 0 ? "rules" : (h.indexOf("h-") === 0 ? "howto" : h);
    if (["tracker", "watch", "howto", "rules", "pamphlet"].indexOf(t) < 0) t = "tracker";
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
  $("lnkPay").href = base + "payment.yml";
  $("lnkViol").href = base + "violation.yml";
  $("lnkList").href = base + "watchlist.yml";
  $("lnkPicks").href = base + "assign.yml";
  $("lnkVeto").href = base + "veto.yml";
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
  function refNum(t) { var n = parseInt(String(t || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? NaN : n; }
  function lbFilms() {
    var out = [], es = (S.lb && S.lb.entries) || {};
    Object.keys(es).forEach(function (g) {
      var e = es[g], player = playerOfLb(e.user); if (!player) return;
      var num = refNum(g); if (isNaN(num)) return;
      var rev = String(e.review || "");
      var ig = (rev.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s<>"')]+/i) || [""])[0];
      var reel = /instagram\.com\/(?:[^\/]+\/)?reels?\//i.test(ig);
      var y = parseInt(e.year, 10);
      var endOfDay = new Date(e.watchedDate + "T23:59:59+05:30");
      var late = e.loggedAt ? (new Date(e.loggedAt) - endOfDay) > 24 * 3600 * 1000 : false;
      out.push({ num: num, lb: true, url: e.link, player: player, at: e.loggedAt || e.firstSeen || "",
        title: e.title || "Untitled", year: isNaN(y) ? null : y, date: e.watchedDate, insta: ig,
        proof: ig ? (reel ? "Instagram reel" : "Instagram carousel") : "Letterboxd",
        note: rev.replace(ig, "").replace(/#short\b/ig, "").trim(),
        rewatch: !!e.rewatch, short: /#short\b/i.test(rev), review: reel,
        late: late, removed: !!e.removed,
        edited: (e.changes || []).some(function (c) { return c.field !== "removed"; }) });
    });
    return out;
  }
  function parseList(text) {
    return String(text || "").split("\n").map(function (l) {
      l = l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, "").trim();
      if (!l) return null;
      var m = l.split(/\s+[-–—]\s+/);
      return { title: m[0].slice(0, 120), note: m.slice(1).join(" - ").slice(0, 120) };
    }).filter(Boolean).slice(0, 80);
  }
  function weekOfSec(v) { var m = String(v || "").match(/Week\s*(\d)/i); return m ? parseInt(m[1], 10) - 1 : -1; }
  function parseListSec(sec) {
    return { week: weekOfSec(sec["week"]), director: String(sec["week 3 director (week 3 only)"] || "").slice(0, 80),
      items: parseList(sec["theme films"]).map(function (x) { x.theme = true; return x; }).concat(parseList(sec["other films"]).map(function (x) { x.theme = false; return x; })) };
  }
  function parsePicksSec(sec) {
    var flags = sec["which picks fit this week's theme?"] || "";
    var films = [1, 2, 3].map(function (n) { return { title: String(sec["pick " + n] || "").trim().slice(0, 120), theme: checked(flags, "pick " + n + " fits") }; }).filter(function (x) { return x.title; });
    return { week: weekOfSec(sec["week"]), films: films, director: String(sec["week 3 only - the director your opponent must deep-dive"] || "").slice(0, 80), note: String(sec["note for your opponent"] || "").slice(0, 300) };
  }
  function latestFor(arr, key, i, beforeLock) {
    return (arr || []).filter(function (x) { return x.player === key && x.week === i && (!beforeLock || new Date(x.at) < lockAt(i)); }).sort(function (a, b) { return b.at.localeCompare(a.at); })[0] || null;
  }
  // The list (or picks) that counts for week i: the locked copy once the week has started, the latest draft before that.
  function effective(kind, key, i) {
    var p = pinfo(key); if (!p || i < 0) return null;
    var arr = kind === "lists" ? S.lists : S.picks, parse = kind === "lists" ? parseListSec : parsePicksSec;
    if (!isLocked(i)) { var d = latestFor(arr, key, i, false); return d ? Object.assign({ state: "draft" }, d) : null; }
    var snap = S.locks && S.locks.weeks && S.locks.weeks[String(i + 1)];
    if (snap) {
      var e = snap[kind] && snap[kind][p.github];
      if (!e) return { state: "locked", none: true, items: [], films: [], week: i };
      return Object.assign({ state: "locked", url: "https://github.com/" + REPO + "/blob/main/locked/locks.json", num: e.number }, parse(sections(e.body)));
    }
    var b = latestFor(arr, key, i, true);
    return b ? Object.assign({ state: "locking" }, b) : { state: "locking", none: true, items: [], films: [], week: i };
  }
  function oppOf(key) { return PLAYERS.filter(function (p) { return p.key !== key; })[0] || null; }
  // The one veto per month: the first one (by time) that names a pick made for this player, filed before that week locked.
  function vetoFor(key) {
    var opp = oppOf(key); if (!opp) return null;
    var vs = (S.vetoes || []).filter(function (v) { return v.player === key; }).sort(function (a, b) { return a.at.localeCompare(b.at); });
    for (var k = 0; k < vs.length; k++) {
      for (var i = 0; i < WEEKS.length; i++) {
        var hit = (S.picks || []).some(function (pk) { return pk.player === opp.key && pk.week === i && pk.films.some(function (f) { return norm(f.title) === norm(vs[k].film); }); });
        if (hit && new Date(vs[k].at) < lockAt(i)) return Object.assign({ week: i }, vs[k]);
      }
    }
    return null;
  }
  // Every pick made for this player, week by week.
  function picksFor(key) {
    var opp = oppOf(key), veto = vetoFor(key), out = [];
    if (!opp) return out;
    WEEKS.forEach(function (W, i) {
      var pk = effective("picks", opp.key, i);
      (pk && pk.films || []).forEach(function (f) { out.push({ title: f.title, theme: f.theme, week: i, vetoed: !!(veto && veto.week === i && norm(veto.film) === norm(f.title)) }); });
    });
    return out;
  }
  function themeFit(f) {
    if (f.failed || f.copied || f.removed) return false;
    var wi = weekIndex(f.date); if (wi < 0) return false;
    var n = norm(f.title), wl = effective("lists", f.player, wi);
    if (wl && wl.items.some(function (it) { return it.theme && norm(it.title) === n; })) return true;
    return picksFor(f.player).some(function (pk) { return pk.week === wi && pk.theme && !pk.vetoed && norm(pk.title) === n; });
  }
  function norm(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(\s*\d{4}\s*\)/g, "").replace(/[^a-z0-9]+/g, " ").replace(/^\s*the\s+/, "").trim(); }
  function watchedBy(key, title) { var n = norm(title); return !!n && S.films.some(function (f) { return f.player === key && !f.copied && norm(f.title) === n; }); }
  function checked(text, word) {
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) { var l = lines[i].toLowerCase(); if (l.indexOf("[x]") >= 0 && l.indexOf(word) >= 0) return true; }
    return false;
  }
  function classify(issues) {
    var films = [], bonuses = [], spots = [], payments = [], violations = [], lists = [], picks = [], vetoes = [], ignored = 0;
    issues.forEach(function (is) {
      if (is.pull_request) return;
      var player = playerOf(is.user && is.user.login);
      var sec = sections(is.body);
      var base = { num: is.number, url: is.html_url, player: player, at: is.created_at || "" };
      var isFilm = "movie" in sec, isBonus = "what are you claiming?" in sec, isPay = "amount paid (₹)" in sec, isViol = "what's the violation?" in sec;
      var isSpot = !isViol && ("film issue number" in sec || "film id" in sec);
      var isList = "theme films" in sec, isPicks = "pick 1" in sec, isVeto = "film you're vetoing" in sec;
      if (!isFilm && !isBonus && !isSpot && !isPay && !isViol && !isList && !isPicks && !isVeto) return;
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
      } else if (isList) {
        lists.push(Object.assign(base, parseListSec(sec)));
      } else if (isPicks) {
        picks.push(Object.assign(base, parsePicksSec(sec)));
      } else if (isVeto) {
        vetoes.push(Object.assign(base, { film: String(sec["film you're vetoing"] || "").trim().slice(0, 120), reason: String(sec["reason (optional)"] || "").slice(0, 300) }));
      } else if (isPay) {
        var pw = String(sec["week you're paying for"] || "").match(/Week\s*(\d)/i);
        var amt = parseFloat(String(sec["amount paid (₹)"] || "").replace(/[^0-9.]/g, ""));
        payments.push(Object.assign(base, { week: pw ? parseInt(pw[1], 10) - 1 : -1, amount: isNaN(amt) ? 0 : amt, shots: proofParts(sec["payment screenshot"] || "").urls, txn: String(sec["transaction id"] || "").slice(0, 60) }));
      } else if (isViol) {
        var vk = String(sec["what's the violation?"] || "").toLowerCase();
        var vw = String(sec["week (for unpaid fines)"] || "").match(/Week\s*(\d)/i);
        var vref = String(sec["film id (for copied posts)"] || sec["film issue number (for copied posts)"] || "");
        var vf = refNum(vref);
        violations.push(Object.assign(base, { kind: vk.indexOf("unpaid") === 0 ? "unpaid" : (vk.indexOf("copied") === 0 ? "copied" : "other"), week: vw ? parseInt(vw[1], 10) - 1 : -1, film: isNaN(vf) ? null : vf, ref: vref, evidence: String(sec["evidence"] || "") }));
      } else {
        var fref = String(sec["film id"] || sec["film issue number"] || "");
        spots.push(Object.assign(base, { film: refNum(fref), ref: fref, failed: /^failed/i.test(sec["result"] || "") }));
      }
    });
    // spot-checks: only the first 3 per player count, and only on the opponent's films
    // Films logged on Letterboxd (synced hourly into data/letterboxd.json)
    var lbf = lbFilms();
    films = films.filter(function (f) { return !lbf.some(function (l) { return l.player === f.player && l.date === f.date && norm(l.title) === norm(f.title); }); }).concat(lbf);
    spots.sort(function (a, b) { return a.at.localeCompare(b.at); });
    var used = {}; var failedNums = {};
    var filmByNum = {}; films.forEach(function (f) { filmByNum[f.num] = f; });
    function findFilm(num, ref) {
      if (filmByNum[num]) return filmByNum[num];
      var r = String(ref || "").toLowerCase().replace(/\/+$/, "");
      return r.indexOf("letterboxd.com/") >= 0 ? films.filter(function (f) { return f.lb && String(f.url).toLowerCase().replace(/\/+$/, "") === r; })[0] : null;
    }
    spots.forEach(function (s) {
      var f = findFilm(s.film, s.ref); if (f) s.film = f.num;
      s.valid = !!(f && f.player !== s.player) && (used[s.player] || 0) < 3;
      if (s.valid) { used[s.player] = (used[s.player] || 0) + 1; if (s.failed) failedNums[s.film] = true; }
    });
    films.forEach(function (f) { f.failed = !!failedNums[f.num]; });
    // violations: filed against the other player
    violations.forEach(function (v) {
      v.against = PLAYERS.filter(function (p) { return p.key !== v.player; }).map(function (p) { return p.key; })[0] || null;
      if (v.kind === "copied") { var f = findFilm(v.film, v.ref); if (f) v.film = f.num; v.valid = !!(f && f.player !== v.player); if (v.valid) f.copied = true; }
      else if (v.kind === "unpaid") v.valid = v.week >= 0;
      else v.valid = true;
    });
    S.lists = lists; S.picks = picks; S.vetoes = vetoes;
    // "Assigned" only counts if the film is one of the opponent's picks (not vetoed)
    var pickCache = {};
    films.forEach(function (f) {
      var pl = pickCache[f.player] || (pickCache[f.player] = picksFor(f.player));
      f.assigned = pl.some(function (pk) { return !pk.vetoed && norm(pk.title) === norm(f.title); });
    });
    S.films = films; S.bonuses = bonuses; S.spots = spots; S.payments = payments; S.violations = violations; S.ignored = ignored; S.spotUsed = used;
  }

  /* ---------- scoring ---------- */
  function filmValue(f) { return (f.failed || f.copied || f.removed) ? 0 : ((f.rewatch || f.short) ? 0.5 : 1); }
  function filmPoints(f) { if (f.copied) return -3; if (f.failed) return -2; if (f.removed) return 0; var y = f.year; return filmValue(f) + ((y && y < 1980) ? 1 : 0) + (f.assigned ? 1 : 0) + (f.review ? 2 : 0); }
  function dayDiff(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000); }
  function daysLeftText(i) { var n = dayDiff(todayStr(), WEEKS[i].end) + 1; return n <= 1 ? "last day" : n + " days left"; }
  function liveDot() { return el("span", { cls: "live-dot", "aria-hidden": "true" }); }
  function payWindow(i) { var t = todayStr(), W = WEEKS[i]; return t > W.end && t <= addDays(W.end, 2); }
  function addDays(d, n) { var x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
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
    fs.forEach(function (f) { var wi = weekIndex(f.date); if (wi < 0) return; films += filmValue(f); pts += filmPoints(f); weeks[wi].count += filmValue(f); if (themeFit(f)) weeks[wi].theme++; });
    // Picks: watch at least (picks given - 3), i.e. 9 of 12; -3 points per pick short, counted after the last week
    var pl = picksFor(key).filter(function (x) { return !x.vetoed; });
    var pw = pl.filter(function (x) { return fs.some(function (f) { return weekIndex(f.date) >= 0 && !f.failed && !f.copied && !f.removed && norm(f.title) === norm(x.title); }); }).length;
    var pneed = Math.max(0, pl.length - PICKS_SPARE), pshort = today > END ? Math.max(0, pneed - pw) : 0;
    var missed = 0, owes = 0, themeBonus = 0;
    weeks.forEach(function (w, i) {
      var W = WEEKS[i]; w.done = w.theme >= 2; if (w.done) themeBonus += 2;
      if (today < W.start) w.status = "soon";
      else if (today <= W.end) w.status = "wip";
      else if (w.count >= W.min) w.status = "ok";
      else if (sick === i) w.status = "sick";
      else { w.status = "bad"; missed++; w.fine = (W.min - w.count) * 200; }
      // money for this week
      w.fine = w.fine || 0;
      var deadline = new Date(addDays(W.end, 2) + "T23:59:59+05:30");
      w.deadline = addDays(W.end, 2);
      var pays = (S.payments || []).filter(function (x) { return x.player === key && x.week === i; });
      w.pays = pays;
      w.paid = pays.reduce(function (t, x) { return t + x.amount; }, 0);
      var onTime = pays.filter(function (x) { return new Date(x.at) <= deadline; }).reduce(function (t, x) { return t + x.amount; }, 0);
      var reported = (S.violations || []).some(function (v) { return v.valid && v.kind === "unpaid" && v.against === key && v.week === i; });
      var late = new Date() > deadline && onTime < w.fine;
      w.doubled = w.fine > 0 && late && reported;
      w.due = w.doubled ? w.fine * 2 : w.fine;
      w.pay = w.due <= 0 ? "none" : (w.paid >= w.due ? "paid" : (new Date() <= deadline ? "due" : (w.doubled ? "doubled" : "overdue")));
      owes += w.due;
    });
    var paidTotal = weeks.reduce(function (t, w) { return t + w.paid; }, 0);
    var outstanding = weeks.reduce(function (t, w) { return t + Math.max(0, w.due - w.paid); }, 0);
    var extra = don || 0;
    var picks = { total: pl.length, watched: pw, need: pneed, short: pshort };
    return { films: films, pts: pts, themeBonus: themeBonus, qpts: qpts, extra: extra, don: don, missed: missed, owes: owes, paid: paidTotal, outstanding: outstanding, total: pts + themeBonus + qpts + extra - 3 * missed - 3 * pshort, picks: picks, weeks: weeks, count: fs.length, sick: sick, quests: quests, spot: (S.spotUsed && S.spotUsed[key]) || 0 };
  }

  /* ---------- render ---------- */
  function render() { renderStatus(); renderScore(); renderWeeks(); renderPot(); renderExtras(); renderLog(); renderWatch(); }
  function yearOf(t) { var m = String(t || "").match(/\b(19\d{2}|20\d{2})\b/); return m ? parseInt(m[1], 10) : null; }
  // What's missing from a player's plan for week i (their list + the picks made for them).
  function readinessWeek(key, i) {
    var W = WEEKS[i], wl = effective("lists", key, i), issues = [];
    var picks = picksFor(key).filter(function (x) { return x.week === i && !x.vetoed; });
    var seen = {}, planned = 0, themed = [];
    (wl ? wl.items : []).map(function (it) { return { title: it.title, theme: it.theme }; }).concat(picks).forEach(function (it) {
      var n = norm(it.title); if (!n || seen[n]) return; seen[n] = true; planned++; if (it.theme) themed.push(it);
    });
    if (!wl) issues.push("No list shared yet.");
    if (planned < W.min) issues.push(planned + " of " + W.min + " films planned (your list + their picks). Add " + (W.min - planned) + " more.");
    if (themed.length < 2) issues.push(themed.length + " of 2 theme films.");
    if (picks.length < PICKS_PER_WEEK) issues.push("Waiting for " + (oppOf(key) ? oppOf(key).name : "your opponent") + "'s " + PICKS_PER_WEEK + " picks (" + picks.length + " so far).");
    if (i === 2 && !directorFor(key)) issues.push("Waiting for " + (oppOf(key) ? oppOf(key).name : "your opponent") + " to pick your Week 3 director.");
    if (i === 3) {
      var ys = themed.map(function (x) { return yearOf(x.title); }).filter(Boolean);
      var miss = [1960, 1970, 1980, 1990, 2000].filter(function (d) { return !ys.some(function (y) { return y >= d && y < d + 10; }); });
      if (miss.length) issues.push("Decades not covered by theme films (add years in brackets): " + miss.map(function (d) { return "'" + String(d).slice(2) + "s"; }).join(", ") + ".");
    }
    return { ok: !issues.length, issues: issues, planned: planned };
  }
  // Week 3: the director is chosen by the opponent, sent with their Week 3 picks.
  function directorFor(key) { var opp = oppOf(key); var pk = opp ? effective("picks", opp.key, 2) : null; return pk && pk.director ? pk.director : ""; }
  function lockLabel(i) { var d = addDays(WEEKS[i].start, -1); return "Mon " + fmtDate(d) + ", midnight"; }
  function renderWatch() {
    var box = $("watchBox"); clear(box);
    var t = todayStr(), cur = weekIndex(t);
    var nextOpen = -1; for (var k = 0; k < WEEKS.length; k++) if (!isLocked(k)) { nextOpen = k; break; }
    PLAYERS.forEach(function (p) {
      var opp = oppOf(p.key), r = calc(p.key), veto = vetoFor(p.key);
      var card = el("article", { cls: "pcard " + p.cls }, [el("div", { cls: "pname", style: "font-size:24px", text: p.name.toUpperCase() })]);
      card.appendChild(el("div", { style: "font-size:14px" }, [
        el("strong", { text: "Picks watched: " }), r.picks.watched + " of " + r.picks.total + (r.picks.total ? " (need " + r.picks.need + ")" : ""),
        el("br"), el("strong", { text: "Veto: " }), veto ? "used on " + veto.film + " (week " + (veto.week + 1) + ")" : "not used yet (one for the month)"
      ]));
      WEEKS.forEach(function (W, i) {
        var wl = effective("lists", p.key, i);
        var picks = picksFor(p.key).filter(function (x) { return x.week === i; });
        var state = isLocked(i) ? (wl && wl.state === "locked" ? "🔒 Locked" : "🔒 Locking…") : "Draft · locks " + lockLabel(i);
        var open = i === cur || i === nextOpen;
        var det = el("details", { cls: "ht", open: open ? true : null });
        det.appendChild(el("summary", null, [i === cur ? liveDot() : null, "Week " + (i + 1) + " · " + W.theme + " ", el("span", { cls: "pill " + (isLocked(i) ? "soon" : "wip"), style: "margin-left:6px", text: state })]));
        det.appendChild(el("div", { cls: "muted", style: "font-size:12px;margin-bottom:6px", text: fmtDate(W.start) + " – " + fmtDate(W.end) + " · " + W.min + " films" }));
        if (!isLocked(i) && i === nextOpen && S.loaded) {
          var rd = readinessWeek(p.key, i);
          var rb = el("div", { style: "border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:13px;background:" + (rd.ok ? "var(--okbg)" : "var(--warnbg)") + ";color:" + (rd.ok ? "var(--ok)" : "#4A3500") }, [el("strong", { text: rd.ok ? "✓ Ready for week " + (i + 1) : "Not ready yet" })]);
          if (rd.issues.length) rb.appendChild(el("ul", { style: "margin:4px 0 0;padding-left:18px" }, rd.issues.map(function (x) { return el("li", { text: x }); })));
          det.appendChild(rb);
        }
        if (i === 2) det.appendChild(el("div", { style: "font-size:14px;margin-bottom:6px" }, [el("strong", { text: "Director, picked by " + (opp ? opp.name : "?") + ": " }), directorFor(p.key) || "not picked yet"]));
        if (wl && !wl.none) {
          var ql = el("div", { cls: "qlist" });
          wl.items.forEach(function (it) {
            var w = watchedBy(p.key, it.title);
            ql.appendChild(el("label", null, [el("span", { "aria-hidden": "true", style: "width:18px;text-align:center;font-weight:700;color:" + (w ? "var(--ok)" : "#bbb"), text: w ? "✓" : "○" }), el("span", { style: w ? "color:var(--mute)" : null, text: it.title }), it.theme ? el("span", { cls: "tag", style: "margin-left:auto", text: "Theme" }) : null]));
          });
          det.appendChild(el("div", { style: "display:flex;justify-content:space-between;font-size:13px" }, [el("strong", { text: p.name + "'s list" }), wl.url ? el("a", { href: wl.url, target: "_blank", rel: "noopener", text: wl.state === "draft" ? "edit" : "locked copy" }) : null]));
          det.appendChild(ql);
        } else det.appendChild(el("p", { cls: "muted", style: "margin:0;font-size:13px", text: !S.loaded ? "Loading…" : (isLocked(i) ? "No list was shared before the lock: no theme films from a list this week." : "No list yet.") }));
        det.appendChild(el("strong", { style: "display:block;font-size:13px;margin-top:8px", text: "Picked by " + (opp ? opp.name : "?") }));
        if (!picks.length) det.appendChild(el("p", { cls: "muted", style: "margin:0;font-size:13px", text: "No picks yet." }));
        else {
          var pl = el("div", { cls: "qlist" });
          picks.forEach(function (x) {
            var w = watchedBy(p.key, x.title);
            pl.appendChild(el("label", null, [el("span", { style: x.vetoed ? "text-decoration:line-through;color:var(--mute)" : null, text: x.title }), x.theme && !x.vetoed ? el("span", { cls: "tag", text: "Theme" }) : null, el("span", { cls: "pill " + (x.vetoed ? "bad" : w ? "ok" : "soon"), style: "margin-left:auto", text: x.vetoed ? "Vetoed" : w ? "Watched" : "To watch" })]));
          });
          det.appendChild(pl);
          if (picks.some(function (x) { return x.vetoed; }) && !isLocked(i)) det.appendChild(el("p", { style: "margin:4px 0 0;font-size:12px;color:var(--red-d)", text: (opp ? opp.name : "Their opponent") + " needs to submit this week's picks again with a replacement before the lock." }));
        }
        card.appendChild(det);
      });
      box.appendChild(card);
    });
  }
  function renderPot() {
    var t = $("potTbl"); clear(t);
    var c = {}; PLAYERS.forEach(function (p) { c[p.key] = calc(p.key); });
    t.appendChild(el("tr", null, [el("th", { text: "Week" }), el("th", { text: "Pay by" })].concat(PLAYERS.map(function (p) { return el("th", { text: p.name }); }))));
    var L = { paid: ["Paid", "ok"], due: ["Due", "wip"], overdue: ["Overdue", "bad"], doubled: ["Late · doubled", "bad"] };
    WEEKS.forEach(function (W, i) {
      var cells = PLAYERS.map(function (p) {
        var w = c[p.key].weeks[i];
        if (w.pay === "none") return el("td", { cls: "muted", text: w.status === "soon" || w.status === "wip" ? "–" : "No fine" });
        var kids = [el("div", { text: "Fine " + rupees(w.due) + (w.doubled ? " (doubled)" : "") }), el("span", { cls: "pill " + L[w.pay][1], text: L[w.pay][0] })];
        w.pays.forEach(function (x) {
          var row = el("div", { style: "font-size:12px;margin-top:3px" }, ["Paid " + rupees(x.amount) + " · ", el("a", { href: x.url, target: "_blank", rel: "noopener", text: "#" + x.num })]);
          x.shots.slice(0, 2).forEach(function (u, k) { row.appendChild(document.createTextNode(" · ")); row.appendChild(el("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: "screenshot" + (x.shots.length > 1 ? " " + (k + 1) : "") })); });
          kids.push(row);
        });
        return el("td", null, kids);
      });
      var due = payWindow(i);
      t.appendChild(el("tr", { cls: due ? "wk-now" : null }, [el("td", null, [el("strong", null, [due ? liveDot() : null, "Week " + (i + 1)]), due ? el("div", { cls: "muted", style: "font-size:12px", text: "Payment due now" }) : null]), el("td", { text: fmtDate(addDays(W.end, 2)) + ", 11:59 pm" })].concat(cells)));
    });
    t.appendChild(el("tr", null, [el("td", null, [el("strong", { text: "Total" })]), el("td", { text: "" })].concat(PLAYERS.map(function (p) {
      var r = c[p.key];
      return el("td", null, [el("div", { text: "Fines " + rupees(r.owes) }), el("div", { text: "Paid " + rupees(r.paid) }), el("strong", { style: "color:" + (r.outstanding ? "var(--red)" : "var(--ok)"), text: "Still to pay " + rupees(r.outstanding) })]);
    }))));
    var collected = PLAYERS.reduce(function (s2, p) { return s2 + c[p.key].paid; }, 0);
    $("potSum").textContent = "Pot collected so far: " + rupees(collected) + ".";
    var vl = $("violList"); clear(vl);
    var vs = (S.violations || []).slice().sort(function (a, b) { return b.at.localeCompare(a.at); });
    if (!vs.length) { vl.appendChild(el("p", { cls: "muted", style: "margin:0", text: "No violations raised." })); return; }
    vs.forEach(function (v) {
      var by = pinfo(v.player), ag = pinfo(v.against);
      var what = v.kind === "unpaid" ? ("Unpaid fine, week " + (v.week + 1)) : v.kind === "copied" ? ("Copied post on film #" + (v.film || "?")) : "Other rule break";
      var effect = !v.valid ? "Not counted (check the week or film number)" : v.kind === "copied" ? "Film scores 0, −3" : v.kind === "unpaid" ? "Fine doubles if not paid by the deadline" : "Settle it in the chat";
      vl.appendChild(el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px" }, [
        el("span", { cls: "pill bad", text: "Violation" }),
        el("strong", { text: what }),
        el("span", { cls: "muted", text: (by ? by.name : "?") + " against " + (ag ? ag.name : "?") + " · " + effect }),
        el("a", { href: v.url, target: "_blank", rel: "noopener", text: "#" + v.num })
      ]));
    });
  }
  function renderStatus() {
    var s = $("status"); clear(s);
    var setup = PLAYERS.some(function (p) { return !p.github || p.github.indexOf("_username") >= 0 || p.github.indexOf("github_username") >= 0; });
    if (setup) s.appendChild(el("div", { cls: "note", text: "Setup: put both GitHub usernames in config.js, or a player's entries won't count." }));
    if (S.error) s.appendChild(el("div", { cls: "note err", text: S.error }));
    if (S.ignored) s.appendChild(el("div", { cls: "note", text: S.ignored + " entr" + (S.ignored === 1 ? "y" : "ies") + " from other GitHub accounts ignored." }));
    var t = todayStr(), now = "", ci = weekIndex(t);
    if (t < WEEKS[0].start) { var d = dayDiff(t, WEEKS[0].start); now = "Starts Tue 1 Dec, " + (d === 1 ? "tomorrow" : "in " + d + " days") + " · Week 1: " + WEEKS[0].theme; }
    else if (ci >= 0) now = "Week " + (ci + 1) + " of " + WEEKS.length + " · " + WEEKS[ci].theme + " · " + daysLeftText(ci);
    else if (t <= FREE_END) now = "Challenge over · free days until 31 Dec, just for fun";
    else now = "Challenge over · final scores";
    var upd = S.updated ? "Updated " + S.updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (S.loaded ? "" : "Loading…");
    var u = $("updated"); clear(u);
    u.appendChild(el("strong", { style: "color:var(--ink)" }, [ci >= 0 ? liveDot() : null, now]));
    if (upd) u.appendChild(document.createTextNode(" · " + upd));
    if (S.lb && S.lb.syncedAt) u.appendChild(document.createTextNode(" · Letterboxd synced " + new Date(S.lb.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
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
          el("div", { cls: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "25", "aria-valuenow": String(r.films), "aria-label": p.name + " progress to 25 films" }, [el("i", { style: "width:" + pct + "%" })]),
          el("div", { style: "font-size:13px;margin-top:6px;color:" + (r.picks.short ? "var(--red-d)" : "var(--mute)"), text: "Picks watched " + r.picks.watched + " of " + r.picks.total + (r.picks.total ? " · need " + r.picks.need : "") + (r.picks.short ? " · −" + (3 * r.picks.short) + " points" : "") })]),
        el("div", { cls: "stats" }, [
          el("div", { cls: "stat" }, [el("b", { text: num(r.total) }), el("span", { text: "final score" })]),
          el("div", { cls: "stat" }, [el("b", { text: num(r.pts) }), el("span", { text: "film points" })]),
          el("div", { cls: "stat" }, [el("b", { text: (r.themeBonus + r.qpts + r.extra >= 0 ? "+" : "") + num(r.themeBonus + r.qpts + r.extra) }), el("span", { text: "bonuses" })]),
          el("div", { cls: "stat owes" }, [el("b", { text: rupees(r.outstanding) }), el("span", { text: "still to pay" + (r.missed ? " · " + r.missed + " missed wk" : "") })])
        ])
      ]));
    });
    var collected = PLAYERS.reduce(function (s, p) { return s + c[p.key].paid; }, 0);
    box.appendChild(el("p", { cls: "muted", style: "grid-column:1/-1;margin:0;font-size:14px", text: "Pot collected: " + rupees(collected) + ". Fines are ₹200 per film short of each week's minimum, payable by the Wednesday after the week ends." }));
  }
  function renderWeeks() {
    var t = $("weekTbl"); clear(t);
    var c = {}; PLAYERS.forEach(function (p) { c[p.key] = calc(p.key); });
    t.appendChild(el("tr", null, [el("th", { text: "Week" }), el("th", { text: "Theme" }), el("th", { text: "Min" })].concat(PLAYERS.map(function (p) { return el("th", { text: p.name }); }))));
    var L = { soon: ["Upcoming", "soon"], wip: ["In progress", "wip"], ok: ["Done", "ok"], sick: ["Sick Day Pass", "wip"], bad: ["Missed", "bad"] };
    WEEKS.forEach(function (W, i) {
      var cells = PLAYERS.map(function (p) {
        var w = c[p.key].weeks[i], l = L[w.status];
        var kids;
        if (w.status === "wip") {
          var togo = Math.max(0, W.min - w.count);
          kids = [el("div", { text: num(w.count) + " of " + W.min }), el("span", { cls: "pill " + (togo ? "wip" : "ok"), text: togo ? num(togo) + " to go · " + daysLeftText(i) : "Minimum met" })];
        } else kids = [el("div", { text: num(w.count) + " film" + (w.count === 1 ? "" : "s") }), el("span", { cls: "pill " + l[1], text: l[0] + (w.status === "bad" ? " · " + rupees(w.fine) : "") })];
        if (w.done) kids.push(el("div", { style: "font-size:12px;color:var(--ok);margin-top:3px", text: "Theme done +2" }));
        return el("td", null, kids);
      });
      var td = todayStr(), isNow = td >= W.start && td <= W.end, isPast = td > W.end;
      t.appendChild(el("tr", { cls: isNow ? "wk-now" : (isPast ? "wk-past" : null) }, [el("td", null, [el("strong", null, [isNow ? liveDot() : null, "Week " + (i + 1)]), el("div", { cls: "muted", style: "font-size:12px", text: isNow ? "This week · " + fmtDate(W.start) + " – " + fmtDate(W.end) : fmtDate(W.start) + " – " + fmtDate(W.end) })]), el("td", { text: W.theme }), el("td", { text: String(W.min) })].concat(cells)));
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
    t.appendChild(el("tr", null, [el("th", { text: "Date" }), el("th", { text: "Who" }), el("th", { text: "Movie" }), el("th", { text: "Proof" }), el("th", { text: "Pts" }), el("th", { text: "Entry" })]));
    if (!rows.length) { t.appendChild(el("tr", null, [el("td", { colspan: "6", cls: "muted", text: S.loaded ? "No films logged yet. The first one sets the tone." : "Loading…" })])); return; }
    rows.forEach(function (f) {
      var p = pinfo(f.player) || { name: "?", cls: "" };
      var tags = el("div", { cls: "tags" });
      [["rewatch", "Rewatch"], ["short", "Short"], ["assigned", "Assigned"], ["review", "Reel +2"]].forEach(function (x) { if (f[x[0]]) tags.appendChild(el("span", { cls: "tag", text: x[1] })); });
      if (themeFit(f)) tags.appendChild(el("span", { cls: "tag", style: "color:var(--ok);border-color:var(--ok)", text: "Theme ✓" }));
      if (f.year && f.year < 1980) tags.appendChild(el("span", { cls: "tag", text: "Pre-1980" }));
      if (f.removed) tags.appendChild(el("span", { cls: "pill soon", text: "Deleted on Letterboxd" }));
      if (f.late) tags.appendChild(el("span", { cls: "pill bad", text: "Logged late" }));
      if (f.edited) tags.appendChild(el("span", { cls: "pill bad", text: "Edited after logging" }));
      if (f.copied) tags.appendChild(el("span", { cls: "pill bad", text: "Copied post" }));
      else if (f.failed) tags.appendChild(el("span", { cls: "pill bad", text: "Failed spot-check" }));
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
        el("td", null, [el("a", { href: f.url, target: "_blank", rel: "noopener", text: f.lb ? "LB-" + f.num : "#" + f.num }), f.lb ? el("div", { cls: "muted", style: "font-size:11px", text: "Letterboxd" }) : null])
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
    var lockedP = fetch("locked/locks.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var lbP = fetch("data/letterboxd.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([page(1), lockedP, lbP]).then(function (res) {
      S.locks = res[1]; S.lb = res[2];
      classify(all); S.loaded = true; S.updated = new Date();
      try { localStorage.setItem(CACHE, JSON.stringify(all)); } catch (e) {}
    }).catch(function (e) {
      S.loaded = true;
      S.error = e.message === "rate" ? "GitHub is limiting requests from this network for a bit. Showing the last saved scores; try Refresh in a few minutes."
        : e.message === "notfound" ? "Can't find the repo " + REPO + ". It must be public, and the name in config.js must match."
        : "Couldn't reach GitHub. Showing the last saved scores.";
      return Promise.all([lockedP, lbP]).then(function (r2) {
        S.locks = r2[0]; S.lb = r2[1];
        try { var c = JSON.parse(localStorage.getItem(CACHE) || "null"); classify(c || []); } catch (x) {}
      });
    }).then(function () { $("refresh").disabled = false; render(); });
  }
  $("refresh").addEventListener("click", load);
  render(); load();
  setInterval(function () { if (!document.hidden) load(); }, 3 * 60 * 1000);
})();
