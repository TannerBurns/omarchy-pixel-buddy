// Platforms, motion, activity, roster and wellbeing.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js, fixture, rng } = require("./helpers.cjs")

const P = js("Platforms")
const M = js("Motion")
const A = js("Activity")
const R = js("Roster")
const W = js("Wellbeing")

const SPRITE = { w: 42, h: 39 }
const laptop = () => P.monitorRect({ x: 0, y: 0, width: 1280, height: 800 }, [0, 26, 0, 0])

test("platforms: Tanner's maximized layout has the floor and a hang ledge, nothing to stand on", () => {
  const mon = laptop()
  const rects = P.clientRects(fixture("clients-maximized"), mon, { monitorId: 0, workspaceIds: [1], border: 2 })
  assert.equal(rects.length, 1)
  assert.deepEqual([rects[0].x, rects[0].y, rects[0].w], [10, 36, 1260])
  const list = P.ledges(rects, mon, SPRITE)
  assert.deepEqual(list.map(l => l.kind).sort(), ["floor", "hang"])
  const perch = P.perchFor(rects[0], list, {}, SPRITE, mon)
  assert.equal(perch.kind, "floor")
  assert.equal(perch.y, 800)
  assert.ok(perch.x > 1100 && perch.x <= 1280 - SPRITE.w / 2)
  assert.equal(perch.facing, -1)
})

test("platforms: floating windows are standable, occlude what's below, and learned perches win", () => {
  const mon = laptop()
  const clients = [
    { address: "0xa", at: [12, 38], size: [1256, 750], workspace: { id: 1 }, monitor: 0, class: "code", focusHistoryID: 1 },
    { address: "0xb", at: [300, 300], size: [500, 300], workspace: { id: 1 }, monitor: 0, class: "kitty", floating: true, focusHistoryID: 0 },
    { address: "0xc", at: [0, 0], size: [100, 100], workspace: { id: 2 }, monitor: 0, class: "other" },
    { address: "0xd", at: [0, 0], size: [100, 100], workspace: { id: 1 }, monitor: 0, class: "hidden", hidden: true }
  ]
  const rects = P.clientRects(clients, mon, { monitorId: 0, workspaceIds: [1], border: 2 })
  assert.deepEqual(rects.map(r => r.address), ["0xb", "0xa"], "floating first (on top)")
  const list = P.ledges(rects, mon, SPRITE)
  const stand = list.filter(l => l.kind === "stand")
  assert.equal(stand.length, 1)
  assert.equal(stand[0].address, "0xb")
  const perch = P.perchFor(rects[0], list, {}, SPRITE, mon)
  assert.equal(perch.kind, "stand")
  assert.ok(perch.x > 298 && perch.x < 802)
  const learned = P.perchFor(rects[1], list, { code: { kind: "floor", fx: 0.1 } }, SPRITE, mon)
  assert.equal(learned.kind, "floor")
  assert.ok(Math.abs(learned.x - (10 + 0.1 * 1260)) < 1)
  // A window on top splits the ledge of the window under it.
  const split = P.ledges(P.clientRects([
    { address: "0x1", at: [100, 400], size: [800, 200], workspace: { id: 1 }, monitor: 0, focusHistoryID: 1 },
    { address: "0x2", at: [400, 300], size: [200, 400], workspace: { id: 1 }, monitor: 0, floating: true, focusHistoryID: 0 }
  ], mon, { monitorId: 0, workspaceIds: [1], border: 0 }), mon, SPRITE)
  assert.equal(split.filter(l => l.address === "0x1").length, 2)
})

test("platforms: swept landing never tunnels and ignores hang ledges", () => {
  const list = [
    { id: "floor", kind: "floor", x1: 0, x2: 1280, y: 800 },
    { id: "a", kind: "stand", x1: 100, x2: 400, y: 300 },
    { id: "b", kind: "hang", x1: 0, x2: 1280, y: 36 }
  ]
  assert.equal(P.landingBelow(list, 200, 100, 790, 20).id, "a")
  assert.equal(P.landingBelow(list, 600, 100, 900, 20).id, "floor")
  assert.equal(P.landingBelow(list, 200, 20, 40, 20), null)
  assert.equal(P.landingBelow(list, 200, 301, 790, 20), null, "already below the ledge")
})

test("motion: hops end exactly at the target and peak above both ends", () => {
  const arc = M.hop(100, 800, 400, 500, 3)
  const end = M.hopAt(arc, 1)
  assert.deepEqual([Math.round(end.x), Math.round(end.y)], [400, 500])
  let top = Infinity
  for (let t = 0; t <= 1; t += 0.05) top = Math.min(top, M.hopAt(arc, t).y)
  assert.ok(top < 500)
  assert.ok(arc.dur >= 0.3 && arc.dur <= 0.9)
})

test("motion: a fast fall lands on the first ledge below, and the bar zone repels", () => {
  const mon = laptop()
  const ledges = [{ id: "floor", kind: "floor", x1: 0, x2: 1280, y: 800 }, { id: "a", kind: "stand", x1: 0, x2: 1280, y: 400 }]
  const body = { x: 600, y: 100, vx: 0, vy: 5000, k: 3, halfW: 20, bodyH: 40 }
  let landed = null
  for (let i = 0; i < 20 && !landed; i++) landed = M.step(body, 0.05, { mon, ledges, landingBelow: P.landingBelow }).landed
  assert.equal(landed.id, "a")
  assert.equal(body.y, 400)
  const up = { x: 600, y: 80, vx: 0, vy: -3000, k: 3, halfW: 20, bodyH: 40 }
  M.step(up, 0.05, { mon, ledges, landingBelow: P.landingBelow })
  assert.ok(up.y - up.bodyH >= mon.top)
})

test("activity: classes, terminal titles, web apps and spinners", () => {
  const cases = [
    ["org.omarchy.agent", "◐ Omarchy pixel buddy plugin", "ai"],
    ["com.mitchellh.ghostty", "⠋ nvim main.rs", "coding"],
    ["kitty", "btop", "system"],
    ["Alacritty", "~", "terminal"],
    ["google-chrome", "YouTube - Google Chrome", "video"],
    ["google-chrome", "Pull request #12 · GitHub", "coding"],
    ["chrome-claude.ai__-Default", "Claude", "ai"],
    ["chrome-app.slack.com__-Default", "Slack", "chat"],
    ["steam_app_1145360", "Hades", "gaming"],
    ["com.microsoft.VSCode", "x", "coding"],
    ["org.gnome.Nautilus", "Home", "files"],
    ["", "", "desktop"],
    ["mystery", "?", "other"]
  ]
  for (const [c, t, want] of cases) assert.equal(A.classify(c, t), want, `${c} / ${t}`)
  assert.equal(A.moodOf("coding"), "focused")
  assert.equal(A.MOOD_PROP.focused, "laptop")
})

test("roster: a new face every day, every face once per cycle", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"]
  let prev = null
  const counts = {}
  for (let day = 0; day < 1000; day++) {
    const id = R.pick(ids, day)
    assert.notEqual(id, prev, "day " + day)
    prev = id
    if (day < 7 * 100) counts[Math.floor(day / 7) + ":" + id] = (counts[Math.floor(day / 7) + ":" + id] || 0) + 1
  }
  assert.ok(Object.values(counts).every(n => n === 1))
  assert.equal(R.pick(["solo"], 5), "solo")
  assert.equal(R.pick([], 5), null)
})

test("roster: the day turns at 04:00 and a stored pick holds for the day", () => {
  const late = new Date(2026, 9, 18, 3, 30)
  const early = new Date(2026, 9, 17, 22, 0)
  const morning = new Date(2026, 9, 18, 4, 30)
  assert.equal(R.dayKey(late), R.dayKey(early))
  assert.notEqual(R.dayKey(morning), R.dayKey(late))
  const ids = ["a", "b", "c"]
  const t = R.today(ids, morning, { date: R.dayKey(morning), id: "c" })
  assert.deepEqual([t.id, t.changed], ["c", false])
  const n = R.today(ids.concat(["z"]), morning, { date: R.dayKey(late), id: "a" })
  assert.equal(n.changed, n.id !== "a")
  assert.notEqual(n.id, "a")
})

test("wellbeing: varied, activity-aware picks with no repeats per rotation", () => {
  const s = W.newSession(0)
  const r = rng(7)
  const seen = new Set()
  let lastCat = ""
  for (let i = 0; i < W.STRETCHES.length; i++) {
    const st = W.pick(s, W.CATEGORIES, { mood: "focused" }, r)
    assert.ok(!seen.has(st.id), "repeat before the rotation ended: " + st.id)
    assert.notEqual(st.category, lastCat)
    seen.add(st.id)
    lastCat = st.category
    W.finish(s, i * 1000, st, "done", "2026-10-18")
  }
  assert.equal(seen.size, W.STRETCHES.length)
  // Categories filter.
  const only = W.newSession(0)
  for (let i = 0; i < 6; i++) {
    const st = W.pick(only, ["wrists", "eyes"], {}, r)
    assert.ok(["wrists", "eyes"].includes(st.category))
    W.finish(only, i, st, "done", "d")
  }
  // Focused work leans toward wrists/eyes/neck.
  const counts = {}
  for (let i = 0; i < 2000; i++) {
    const st = W.pick(W.newSession(0), W.CATEGORIES, { mood: "focused" }, r)
    counts[st.category] = (counts[st.category] || 0) + 1
  }
  assert.ok(counts.wrists > counts.legs * 2)
})

test("wellbeing: session timing, snooze, deferrals and restarts", () => {
  const cfg = { enabled: true, breakMinutes: 45 }
  let s = W.newSession(0)
  for (let t = 60000; t <= 45 * 60000; t += 60000) W.tick(s, t, true)
  assert.equal(W.status(s, 45 * 60000, cfg, {}).due, true)
  assert.equal(W.status(s, 45 * 60000, cfg, { fullscreen: true }).reason, "fullscreen")
  assert.equal(W.status(s, 45 * 60000, cfg, { dnd: true }).reason, "dnd")
  assert.equal(W.status(s, 45 * 60000, cfg, { screencast: true }).reason, "screencast")
  assert.equal(W.status(s, 45 * 60000, { enabled: false, breakMinutes: 45 }, {}).reason, "off")
  W.finish(s, 45 * 60000, W.STRETCHES[0], "later", "d")
  assert.equal(W.status(s, 46 * 60000, cfg, {}).reason, "snoozed")
  assert.equal(W.status(s, 56 * 60000, cfg, {}).due, true)
  W.finish(s, 56 * 60000, W.STRETCHES[0], "done", "d")
  assert.equal(s.activeMs, 0)
  assert.equal(s.doneToday, 1)
  // A long gap (suspend) counts as a break; a quick restart keeps the time.
  s = W.newSession(0)
  for (let t = 60000; t <= 30 * 60000; t += 60000) W.tick(s, t, true)
  const kept = W.restore(JSON.parse(JSON.stringify(s)), 30 * 60000 + 20000)
  assert.ok(kept.activeMs >= 29 * 60000)
  const reset = W.restore(JSON.parse(JSON.stringify(s)), 30 * 60000 + 10 * 60000)
  assert.equal(reset.activeMs, 0)
  // Idle time doesn't count.
  const idle = W.newSession(0)
  for (let t = 60000; t <= 10 * 60000; t += 60000) W.tick(idle, t, false)
  assert.equal(idle.activeMs, 0)
})

test("wellbeing: bedtime nights and one nudge per night", () => {
  assert.equal(W.isNight(new Date(2026, 9, 18, 23, 30), "23:00"), true)
  assert.equal(W.isNight(new Date(2026, 9, 18, 2, 0), "23:00"), true)
  assert.equal(W.isNight(new Date(2026, 9, 18, 4, 30), "23:00"), false)
  assert.equal(W.isNight(new Date(2026, 9, 18, 22, 59), "23:00"), false)
  assert.equal(W.isNight(new Date(2026, 9, 18, 1, 30), "01:00"), true)
  assert.equal(W.isNight(new Date(2026, 9, 18, 23, 30), "01:00"), false)
  assert.equal(W.isNight(new Date(2026, 9, 18, 23, 30), ""), false)
  const s = W.newSession(0)
  const night = new Date(2026, 9, 18, 23, 30)
  assert.equal(W.bedtimeNudgeDue(s, night, "23:00", "2026-10-18"), true)
  s.lastBedtimeNudge = "2026-10-18"
  assert.equal(W.bedtimeNudgeDue(s, new Date(2026, 9, 19, 1, 0), "23:00", "2026-10-18"), false)
})

test("power: battery saver follows the setting and the battery", () => {
  const Power = js("Power")
  assert.equal(Power.isSaver("auto", true), true)
  assert.equal(Power.isSaver("auto", false), false)
  assert.equal(Power.isSaver("on", false), true)
  assert.equal(Power.isSaver("off", true), false)
  const s = Power.policy(true), n = Power.policy(false)
  assert.equal(s.saver, true)
  assert.equal(n.saver, false)
  assert.ok(s.walkFps <= 5 && s.idleFps < 1 && s.wanderScale < 1 && !s.hangs && !s.specials)
  assert.ok(s.cursorMs[0] > n.cursorMs[0] && s.geometryMs[1] > n.geometryMs[1])
  assert.ok(s.fastHz > 0 && n.fastHz === 0)
})

test("settings: the bar entry wins over plugins[] once the buddy has a bar widget", () => {
  const S = js("Settings")
  const id = "tannerburns.pixel-buddy"
  const plug = { id, character: "cat", size: "large" }
  const bar = { id, character: "frog" }
  assert.deepEqual(S.findEntry({ plugins: [plug] }, id), { entry: plug, home: "plugins", section: "" })
  assert.deepEqual(S.findEntry({ bar: { layout: { right: [{ id: "omarchy.clock" }, bar] } } }, id), { entry: bar, home: "bar", section: "right" })
  const both = S.findEntry({ plugins: [plug], bar: { layout: { left: [], center: [bar] } } }, id)
  assert.deepEqual(both, { entry: { id, character: "frog", size: "large" }, home: "bar", section: "center" })
  assert.deepEqual(S.findEntry({ bar: { layout: { left: ["omarchy.workspaces", id] } } }, id).section, "left", "a bare id string counts")
  assert.deepEqual(S.findEntry({}, id), { entry: {}, home: "", section: "" })
  assert.deepEqual(S.findEntry(null, id), { entry: {}, home: "", section: "" })
  assert.deepEqual(S.findEntry({ bar: { layout: "nonsense" }, plugins: "nope" }, id), { entry: {}, home: "", section: "" })
})

test("settings: batterySaver parses like every other enum", () => {
  const S = js("Settings")
  assert.equal(S.coerce({}).batterySaver, "auto")
  assert.equal(S.coerce({ batterySaver: "ON" }).batterySaver, "on")
  assert.equal(S.coerce({ batterySaver: "sometimes" }).batterySaver, "auto")
  assert.deepEqual(S.parseValue("batterySaver", "off"), { ok: true, value: "off" })
  assert.equal(S.parseValue("batterySaver", "maybe").ok, false)
})

test("wellbeing: a focus session holds a due break, ahead of the other reasons", () => {
  const s = W.newSession(0)
  s.activeMs = 50 * 60000
  const cfg = { enabled: true, breakMinutes: 45 }
  assert.equal(W.status(s, 1000, cfg, {}).due, true)
  assert.equal(W.status(s, 1000, cfg, { focus: true, dnd: true, hidden: true }).reason, "focus")
  assert.equal(W.status(s, 1000, cfg, { dnd: true }).reason, "dnd")
  // Not yet due: the countdown still shows during focus.
  s.activeMs = 10 * 60000
  assert.equal(W.status(s, 1000, cfg, { focus: true }).reason, "active")
})
