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
  function parseList(text) {
    return String(text || "").split("\n").map(function (l) {
      l = l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, "").trim();
      if (!l) return null;
      var m = l.split(/\s+[-–—]\s+/);
      return { title: m[0].slice(0, 120), note: m.slice(1).join(" - ").slice(0, 120) };
    }).filter(Boolean).slice(0, 80);
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
      var isSpot = !isViol && "film issue number" in sec;
      var isList = "my watchlist" in sec, isPicks = "pick 1" in sec, isVeto = "film you're vetoing" in sec;
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
        lists.push(Object.assign(base, { director: String(sec["week 3 director"] || "").slice(0, 80), items: parseList(sec["my watchlist"]) }));
      } else if (isPicks) {
        picks.push(Object.assign(base, { films: [sec["pick 1"], sec["pick 2"], sec["pick 3"]].map(function (x) { return String(x || "").trim().slice(0, 120); }).filter(Boolean), note: String(sec["note for your opponent"] || "").slice(0, 300) }));
      } else if (isVeto) {
        vetoes.push(Object.assign(base, { film: String(sec["film you're vetoing"] || "").trim().slice(0, 120), reason: String(sec["reason (optional)"] || "").slice(0, 300) }));
      } else if (isPay) {
        var pw = String(sec["week you're paying for"] || "").match(/Week\s*(\d)/i);
        var amt = parseFloat(String(sec["amount paid (₹)"] || "").replace(/[^0-9.]/g, ""));
        payments.push(Object.assign(base, { week: pw ? parseInt(pw[1], 10) - 1 : -1, amount: isNaN(amt) ? 0 : amt, shots: proofParts(sec["payment screenshot"] || "").urls, txn: String(sec["transaction id"] || "").slice(0, 60) }));
      } else if (isViol) {
        var vk = String(sec["what's the violation?"] || "").toLowerCase();
        var vw = String(sec["week (for unpaid fines)"] || "").match(/Week\s*(\d)/i);
        var vf = parseInt(String(sec["film issue number (for copied posts)"] || "").replace(/[^0-9]/g, ""), 10);
        violations.push(Object.assign(base, { kind: vk.indexOf("unpaid") === 0 ? "unpaid" : (vk.indexOf("copied") === 0 ? "copied" : "other"), week: vw ? parseInt(vw[1], 10) - 1 : -1, film: isNaN(vf) ? null : vf, evidence: String(sec["evidence"] || "") }));
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
    // violations: filed against the other player
    violations.forEach(function (v) {
      v.against = PLAYERS.filter(function (p) { return p.key !== v.player; }).map(function (p) { return p.key; })[0] || null;
      if (v.kind === "copied") { var f = filmByNum[v.film]; v.valid = !!(f && f.player !== v.player); if (v.valid) f.copied = true; }
      else if (v.kind === "unpaid") v.valid = v.week >= 0;
      else v.valid = true;
    });
    S.lists = lists; S.picks = picks; S.vetoes = vetoes;
    S.films = films; S.bonuses = bonuses; S.spots = spots; S.payments = payments; S.violations = violations; S.ignored = ignored; S.spotUsed = used;
  }

  /* ---------- scoring ---------- */
  function filmValue(f) { return (f.failed || f.copied) ? 0 : ((f.rewatch || f.short) ? 0.5 : 1); }
  function filmPoints(f) { if (f.copied) return -3; if (f.failed) return -2; var y = f.year; return filmValue(f) + ((y && y < 1980) ? 1 : 0) + (f.assigned ? 1 : 0) + (f.review ? 2 : 0); }
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
    fs.forEach(function (f) { films += filmValue(f); pts += filmPoints(f); var wi = weekIndex(f.date); if (wi >= 0) { weeks[wi].count += filmValue(f); if (f.theme && !f.failed) weeks[wi].theme++; } });
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
    return { films: films, pts: pts, themeBonus: themeBonus, qpts: qpts, extra: extra, don: don, missed: missed, owes: owes, paid: paidTotal, outstanding: outstanding, total: pts + themeBonus + qpts + extra - 3 * missed, weeks: weeks, count: fs.length, sick: sick, quests: quests, spot: (S.spotUsed && S.spotUsed[key]) || 0 };
  }

  /* ---------- render ---------- */
  function render() { renderStatus(); renderScore(); renderWeeks(); renderPot(); renderExtras(); renderLog(); renderWatch(); }
  function readiness(wl, picksFor) {
    var issues = [], good = [];
    var items = wl ? wl.items : [];
    var seen = {}; var all = [];
    items.concat((picksFor || []).map(function (t) { return { title: t, note: "", pick: true }; })).forEach(function (it) { var n = norm(it.title); if (n && !seen[n]) { seen[n] = true; all.push(it); } });
    var total = all.length;
    if (total < 25) issues.push("Only " + total + " films planned. Add " + (25 - total) + " more to reach 25.");
    else if (total < 30) issues.push(total + " films planned: enough for 25, but add " + (30 - total) + " spare" + (30 - total === 1 ? "" : "s") + " in case a film isn't available.");
    else good.push(total + " films planned, with spares");
    var weekOf = function (it) { var m = String(it.note || "").match(/week\s*(\d)/i); return m ? parseInt(m[1], 10) - 1 : -1; };
    var yearOf = function (it) { var m = (String(it.title) + " " + String(it.note || "")).match(/\b(19\d{2}|20\d{2})\b/); return m ? parseInt(m[1], 10) : null; };
    var NEED = [2, 2, 3, 5, 2];
    var byWeek = WEEKS.map(function (_, i) { return items.filter(function (it) { return weekOf(it) === i; }); });
    var untagged = items.filter(function (it) { return weekOf(it) < 0; }).length;
    byWeek.forEach(function (list, i) {
      if (list.length < NEED[i]) issues.push("Week " + (i + 1) + " (" + WEEKS[i].theme + "): " + list.length + " of " + NEED[i] + " tagged.");
    });
    if (!wl || !wl.director) issues.push("Week 3 director not declared.");
    var decades = [1960, 1970, 1980, 1990, 2000];
    var w4 = byWeek[3].map(yearOf).filter(Boolean);
    var missingDec = decades.filter(function (d) { return !w4.some(function (y) { return y >= d && y < d + 10; }); });
    if (byWeek[3].length && missingDec.length) issues.push("Week 4 decades missing (add years in brackets): " + missingDec.map(function (d) { return "'" + String(d).slice(2) + "s"; }).join(", ") + ".");
    var w5 = byWeek[4], not26 = w5.filter(function (it) { var y = yearOf(it); return y && y !== 2026; });
    if (not26.length) issues.push("Week 5 should be 2026 releases: " + not26.map(function (it) { return it.title; }).join(", ") + ".");
    if (!issues.length) { good.push("every theme covered"); if (untagged) good.push(untagged + " free pick" + (untagged === 1 ? "" : "s")); }
    return { ok: !issues.length, issues: issues, good: good, untagged: untagged };
  }
  function latest(arr, key) { return (arr || []).filter(function (x) { return x.player === key; }).sort(function (a, b) { return b.at.localeCompare(a.at); })[0] || null; }
  function renderWatch() {
    var box = $("watchBox"); clear(box);
    PLAYERS.forEach(function (p) {
      var opp = PLAYERS.filter(function (x) { return x.key !== p.key; })[0];
      var card = el("article", { cls: "pcard " + p.cls }, [el("div", { cls: "pname", style: "font-size:24px", text: p.name.toUpperCase() })]);
      // watchlist
      var wl = latest(S.lists, p.key);
      var head = el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:8px" }, [el("strong", { text: "Watchlist" })]);
      card.appendChild(head);
      if (!wl) card.appendChild(el("p", { cls: "muted", style: "margin:0;font-size:14px", text: S.loaded ? "Not added yet." : "Loading…" }));
      else {
        var done = wl.items.filter(function (it) { return watchedBy(p.key, it.title); }).length;
        head.appendChild(el("span", { cls: "muted", style: "font-size:13px" }, [done + " of " + wl.items.length + " watched · ", el("a", { href: wl.url, target: "_blank", rel: "noopener", text: "edit" })]));
        card.appendChild(el("div", { style: "font-size:14px" }, [el("strong", { text: "Week 3 director: " }), wl.director || "not declared yet"]));
        var ql = el("div", { cls: "qlist" });
        wl.items.forEach(function (it) {
          var w = watchedBy(p.key, it.title);
          ql.appendChild(el("label", null, [el("span", { "aria-hidden": "true", style: "width:18px;text-align:center;font-weight:700;color:" + (w ? "var(--ok)" : "#bbb"), text: w ? "✓" : "○" }), el("span", { style: w ? "color:var(--mute)" : null, text: it.title }), it.note ? el("span", { cls: "muted", style: "margin-left:auto;font-size:12px;text-align:right", text: it.note }) : null]));
        });
        card.appendChild(ql);
      }
      // picks for this player (made by opponent)
      var pk = opp ? latest(S.picks, opp.key) : null;
      var vetoAll = (S.vetoes || []).filter(function (v) { return v.player === p.key; }).sort(function (a, b) { return a.at.localeCompare(b.at); });
      var allOppPicks = (S.picks || []).filter(function (x) { return opp && x.player === opp.key; }).reduce(function (a, x) { return a.concat(x.films); }, []);
      var veto = vetoAll.filter(function (v) { return allOppPicks.some(function (t) { return norm(t) === norm(v.film); }); })[0] || null;
      if (wl) {
        var vetoT = veto ? norm(veto.film) : null;
        var rd = readiness(wl, pk ? pk.films.filter(function (t) { return norm(t) !== vetoT; }) : []);
        var rbox = el("div", { style: "border-radius:10px;padding:10px 12px;font-size:14px;background:" + (rd.ok ? "var(--okbg)" : "var(--warnbg)") + ";color:" + (rd.ok ? "var(--ok)" : "#4A3500") }, [
          el("strong", { text: rd.ok ? "✓ Ready for 1 December" : "Not ready yet" }),
          rd.good.length ? el("div", { style: "font-size:13px", text: rd.good.join(" · ") }) : null
        ]);
        if (rd.issues.length) rbox.appendChild(el("ul", { style: "margin:4px 0 0;padding-left:18px" }, rd.issues.map(function (x) { return el("li", { text: x }); })));
        if (rd.untagged && !rd.ok) rbox.appendChild(el("div", { style: "font-size:12px;margin-top:4px;opacity:.85", text: rd.untagged + " film" + (rd.untagged === 1 ? " has" : "s have") + " no week tag. Add “- Week N” after a title to count it towards a theme." }));
        card.insertBefore(rbox, card.children[1]);
      }
      card.appendChild(el("strong", { style: "margin-top:4px", text: "Picked for " + p.name + " by " + (opp ? opp.name : "?") }));
      if (!pk) card.appendChild(el("p", { cls: "muted", style: "margin:0;font-size:14px", text: "No picks yet." }));
      else {
        var pl = el("div", { cls: "qlist" });
        pk.films.forEach(function (t) {
          var vetoed = veto && norm(veto.film) === norm(t), w = watchedBy(p.key, t);
          pl.appendChild(el("label", null, [el("span", { style: vetoed ? "text-decoration:line-through;color:var(--mute)" : null, text: t }), el("span", { cls: "pill " + (vetoed ? "bad" : w ? "ok" : "soon"), style: "margin-left:auto", text: vetoed ? "Vetoed" : w ? "Watched" : "To watch" })]));
        });
        if (veto && !pk.films.some(function (t) { return norm(t) === norm(veto.film); })) {
          pl.appendChild(el("label", null, [el("span", { style: "text-decoration:line-through;color:var(--mute)", text: veto.film }), el("span", { cls: "pill bad", style: "margin-left:auto", text: "Vetoed · replaced" })]));
        }
        card.appendChild(pl);
        if (veto && pk.films.some(function (t) { return norm(t) === norm(veto.film); })) card.appendChild(el("p", { style: "margin:0;font-size:13px;color:var(--red-d)", text: (opp ? opp.name : "Their opponent") + " needs to send a replacement pick." }));
        if (pk.note) card.appendChild(el("p", { cls: "muted", style: "margin:0;font-size:13px", text: "“" + pk.note + "”" }));
      }
      card.appendChild(el("div", { style: "font-size:14px" }, [el("strong", { text: "Veto: " }), veto ? "used on " + veto.film : "not used yet"]));
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
    else now = "Challenge over · final scores";
    var upd = S.updated ? "Updated " + S.updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (S.loaded ? "" : "Loading…");
    var u = $("updated"); clear(u);
    u.appendChild(el("strong", { style: "color:var(--ink)" }, [ci >= 0 ? liveDot() : null, now]));
    if (upd) u.appendChild(document.createTextNode(" · " + upd));
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
          el("div", { cls: "stat owes" }, [el("b", { text: rupees(r.outstanding) }), el("span", { text: "still to pay" + (r.missed ? " · " + r.missed + " missed wk" : "") })])
        ])
      ]));
    });
    var collected = PLAYERS.reduce(function (s, p) { return s + c[p.key].paid; }, 0);
    box.appendChild(el("p", { cls: "muted", style: "grid-column:1/-1;margin:0;font-size:14px", text: "Pot collected: " + rupees(collected) + ". Fines are ₹200 per film short of each week's minimum, payable by the Tuesday after." }));
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
    t.appendChild(el("tr", null, [el("th", { text: "Date" }), el("th", { text: "Who" }), el("th", { text: "Movie" }), el("th", { text: "Proof" }), el("th", { text: "Pts" }), el("th", { text: "Issue" })]));
    if (!rows.length) { t.appendChild(el("tr", null, [el("td", { colspan: "6", cls: "muted", text: S.loaded ? "No films logged yet. The first one sets the tone." : "Loading…" })])); return; }
    rows.forEach(function (f) {
      var p = pinfo(f.player) || { name: "?", cls: "" };
      var tags = el("div", { cls: "tags" });
      [["rewatch", "Rewatch"], ["short", "Short"], ["assigned", "Assigned"], ["review", "Reel +2"], ["theme", "Theme"]].forEach(function (x) { if (f[x[0]]) tags.appendChild(el("span", { cls: "tag", text: x[1] })); });
      if (f.year && f.year < 1980) tags.appendChild(el("span", { cls: "tag", text: "Pre-1980" }));
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
