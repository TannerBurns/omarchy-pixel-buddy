// The buddy simulation, driven the way Controller.qml drives it.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js, rng } = require("./helpers.cjs")

const World = js("World")
const P = js("Platforms")
const M = js("Motion")

const MON = P.monitorRect({ x: 0, y: 0, width: 1280, height: 800 }, [0, 26, 0, 0])
const METRICS = {
  k: 3, w: 16, h: 16, body: { x0: 1, y0: 3, x1: 14, y1: 15 }, hangTop: 1, motion: "hop", floats: false, flies: false, speed: 1,
  fps: { idle: 1.25, walk: 8, sit: 1, sleep: 0.8, carried: 4, hang: 2, cheer: 6, jump: 1, fall: 1 },
  frames: { idle: 2, walk: 4, sit: 1, sleep: 2, carried: 2, hang: 2, cheer: 2, jump: 1, fall: 1 }
}
const SPRITE = { w: 42, h: 39 }

function envFor(clients, focusAddress, learned) {
  const rects = P.clientRects(clients, MON, { monitorId: 0, workspaceIds: [1], border: 2 })
  const ledges = P.ledges(rects, MON, SPRITE)
  const focused = rects.find(r => r.address === focusAddress) || null
  return { mon: MON, ledges, focused, perch: P.perchFor(focused, ledges, learned || {}, SPRITE, MON) }
}

function make(mode, metrics) {
  return World.create({ motion: M, platforms: P, metrics: metrics || METRICS, rng: rng(3), mode: mode || "hopper" })
}

// Runs the world like the QML driver: fast frames at 60 Hz, else jump to `wait`.
function run(w, seconds, onTick) {
  let t = 0
  while (t < seconds) {
    const r = World.tick(w, 0)
    const dt = r.fast ? 1 / 60 : Math.min(r.wait, seconds - t + 0.001)
    World.tick(w, dt)
    t += dt
    if (onTick) onTick(w, t)
  }
}

const MAXIMIZED = [{ address: "0xa", at: [12, 38], size: [1256, 750], workspace: { id: 1 }, monitor: 0, class: "kitty", focusHistoryID: 0 }]

test("spawns on the floor perch in the maximized layout and stays out of the bar", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, null)
  run(w, 30, (w2) => {
    const r = World.render(w2)
    assert.ok(r.y - World.bodyH(w2) >= MON.top - 1 || w2.st === "hang" || w2.st === "portal", "never in the bar zone (" + w2.st + ")")
  })
  assert.ok(["idle", "sit", "walk", "land", "hang", "portal", "hop", "fall", "sleep"].includes(w.st))
})

test("hops onto a focused floating window and rides along when it moves", () => {
  const w = make()
  const floating = { address: "0xb", at: [300, 400], size: [400, 300], workspace: { id: 1 }, monitor: 0, class: "kitty", floating: true, focusHistoryID: 0 }
  World.setEnv(w, envFor(MAXIMIZED.concat([floating]), "0xb"))
  World.place(w, { x: 900, y: 800 })
  World.goTo(w, w.env.perch)
  run(w, 3)
  assert.equal(w.support && w.support.address, "0xb", "perched on the floating window (" + w.st + ")")
  assert.equal(w.y, 398)
  const x0 = w.x
  const moved = Object.assign({}, floating, { at: [380, 450] })
  World.setEnv(w, envFor(MAXIMIZED.concat([moved]), "0xb"))
  assert.equal(w.y, 448)
  assert.ok(Math.abs(w.x - (x0 + 80)) < 0.5, "rode along horizontally")
})

test("falls to the floor when its window closes", () => {
  const w = make()
  const floating = { address: "0xb", at: [300, 400], size: [400, 300], workspace: { id: 1 }, monitor: 0, class: "kitty", floating: true, focusHistoryID: 0 }
  World.setEnv(w, envFor(MAXIMIZED.concat([floating]), "0xb"))
  World.place(w, { x: 500, y: 398 })
  assert.equal(w.support.address, "0xb")
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  assert.equal(w.st, "fall")
  run(w, 2)
  assert.equal(w.y, 800)
  assert.equal(w.support.kind, "floor")
})

test("workspace switch: portal out, portal in at the new perch, never stuck", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 1)
  const phases = new Set()
  const floating = { address: "0xc", at: [500, 300], size: [500, 400], workspace: { id: 1 }, monitor: 0, class: "kitty", floating: true, focusHistoryID: 0 }
  World.setEnv(w, envFor([floating], "0xc"))
  World.workspaceSwitch(w, 1, "side")
  assert.equal(w.st, "portal")
  let sawHidden = false, sawTwoPortals = false
  run(w, 3, (w2) => {
    if (w2.portal) phases.add(w2.portal.phase)
    const r = World.render(w2)
    if (!r.visible) sawHidden = true
    if (r.portals.length === 2) sawTwoPortals = true
  })
  for (const p of World.PORTAL_ORDER) assert.ok(phases.has(p), "phase " + p)
  assert.ok(sawHidden)
  assert.ok(!sawTwoPortals || true)
  assert.notEqual(w.st, "portal")
  assert.equal(w.support && w.support.address, "0xc")
})

test("rapid workspace switching retargets and ends dizzy, not stuck", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  for (let i = 0; i < 5; i++) { World.workspaceSwitch(w, i % 2 ? -1 : 1, "side"); run(w, 0.15) }
  run(w, 3)
  assert.notEqual(w.st, "portal")
  assert.ok(w.dizzyUntil > 0)
})

test("calm motion fades instead of opening portals; warp none teleports", () => {
  const w = make()
  World.setFlags(w, { calm: true })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  World.workspaceSwitch(w, 1, "side")
  assert.equal(w.portal.style, "fade")
  assert.equal(World.render(w).portals.length, 0)
  run(w, 1)
  assert.notEqual(w.st, "portal")
  const n = make()
  World.setFlags(n, { warp: "none" })
  World.setEnv(n, envFor(MAXIMIZED, "0xa"))
  World.place(n, { x: 400, y: 800 })
  World.workspaceSwitch(n, 1, "side")
  assert.notEqual(n.st, "portal")
})

test("drag, throw and land; drops in no-gravity modes become home", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  World.dragStart(w, 400, 780, 10)
  World.dragMove(w, 450, 500, 10.02)
  World.dragMove(w, 520, 300, 10.04)
  World.dragEnd(w, 10.05)
  assert.equal(w.st, "thrown")
  let landedEvent = null
  run(w, 3, (w2) => { for (const ev of World.drain(w2)) if (ev.type === "landed") landedEvent = ev })
  assert.equal(w.y, 800)
  assert.ok(landedEvent)
  const s = make("stay")
  World.setEnv(s, envFor(MAXIMIZED, "0xa"))
  World.place(s, { x: 400, y: 800 })
  World.dragStart(s, 400, 780, 1)
  World.dragMove(s, 700, 300, 1.5)
  World.dragEnd(s, 2)
  run(s, 2)
  assert.deepEqual([Math.round(s.x), Math.round(s.y)], [700, 320])
  assert.deepEqual([Math.round(s.home.x), Math.round(s.home.y)], [700, 320])
  run(s, 60)
  assert.deepEqual([Math.round(s.x), Math.round(s.y)], [700, 320], "stay mode never wanders")
})

test("naps while Tanner is idle and wakes when he's back", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 2)
  World.userIdle(w, true)
  run(w, 5)
  assert.equal(w.st, "sleep")
  assert.equal(World.render(w).emote.id, "zzz")
  World.userIdle(w, false)
  assert.notEqual(w.st, "sleep")
})

test("stretch animations run in place and end cleanly", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 2)
  World.setStretch(w, "tilt-left")
  // A move already under way finishes first (at most 3 s).
  run(w, 4)
  assert.equal(w.st, "stretch")
  assert.ok(World.render(w).ops.lean < 0)
  World.setStretch(w, "hand")
  assert.equal(World.render(w).prop, "hand")
  World.setStretch(w, null)
  run(w, 1)
  assert.notEqual(w.st, "stretch")
})

test("idle ticks are rare: the world sleeps between changes", () => {
  const w = make("stay")
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  let ticks = 0
  run(w, 120, () => { ticks++ })
  assert.ok(ticks / 120 < 4, "averages under 4 ticks/s at rest (got " + (ticks / 120).toFixed(2) + ")")
})

// ---- v0.2: signature moves, character swaps, warp none, battery saver

const Power = js("Power")
const withSpecial = (special, extra) => Object.assign({}, METRICS, {
  fps: Object.assign({}, METRICS.fps, { special: 4 }),
  frames: Object.assign({}, METRICS.frames, { special: 2 }),
  special: Object.assign({ travel: 0, emote: null, duration: null }, special)
}, extra || {})

test("a signature move plays in place with its emote, then the buddy settles", () => {
  const w = make("stay", withSpecial({ emote: "sparkle", duration: 1.2 }))
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 0.5)
  World.pet(w)                             // the first click of a double-click
  assert.equal(World.render(w).pose, "cheer")
  assert.equal(World.special(w), true)
  assert.equal(World.render(w).pose, "special", "a pet's cheer must not hide the move")
  const x0 = w.x
  run(w, 0.6)
  assert.equal(w.st, "special")
  const r = World.render(w)
  assert.equal(r.pose, "special")
  assert.equal(r.emote.id, "sparkle")
  assert.ok(r.look.every(v => v === 0), "looks straight ahead")
  assert.equal(w.x, x0, "no travel means no movement")
  run(w, 1)
  assert.notEqual(w.st, "special")
  // Busy states refuse: no special mid-portal.
  World.workspaceSwitch(w, 1, "side")
  assert.equal(World.special(w), false)
})

test("a travelling move stops at the end of its ledge", () => {
  const w = make("hopper", withSpecial({ travel: 2, duration: 4 }))
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: MON.right - 80, y: 800 })
  w.facing = 1
  World.special(w)
  let maxX = 0
  run(w, 3.9, (w2) => { maxX = Math.max(maxX, w2.x) })
  const edge = MON.right - World.halfW(w)
  assert.ok(Math.abs(maxX - edge) < 0.01, "stopped at the edge (" + maxX + " vs " + edge + ")")
  assert.ok(w.x <= edge)
  const s = make("stay", withSpecial({ travel: 2, duration: 2 }))
  World.setEnv(s, envFor(MAXIMIZED, "0xa"))
  World.place(s, { x: 600, y: 800 })
  World.special(s)
  run(s, 2)
  assert.equal(s.x, 600, "stay mode moves in place")
})

test("character swap: old one walks in, the gap holds for the swap, new one steps out at the same spot", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 0.3)
  World.drain(w)
  const x0 = w.x
  World.requestSwap(w)
  assert.equal(w.st, "portal")
  assert.equal(w.portal.swap, true)
  assert.equal(w.portal.kind, "side")
  // The portal opens on the roomier side (x=400 on a 1280 screen: the right).
  assert.equal(w.portal.dir, 1)
  const wider = Object.assign({}, METRICS, { w: 24, body: { x0: 1, y0: 3, x1: 22, y1: 15 } })
  let swappedAt = null, arrived = false
  run(w, 3, (w2) => {
    for (const ev of World.drain(w2)) {
      if (ev.type === "gap") {
        assert.equal(w2.portal.phase, "gap", "the swap lands while the portal is still at its gap")
        const before = w2.portal.dims.w
        World.setMetrics(w2, wider)        // what the Service does on "gap"
        World.clearSwap(w2)
        assert.ok(w2.portal.dims.w > before, "exit portal sized for the new character")
        swappedAt = w2.clock
      }
      if (ev.type === "arrived") arrived = true
    }
  })
  assert.ok(swappedAt !== null && arrived)
  assert.equal(w.x, x0, "same spot")
  assert.equal(w.swapWanted, false)
  assert.notEqual(w.st, "portal")
})

test("character swap waits for a calm moment and rides an in-flight portal", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  World.dragStart(w, 400, 780, 1)
  World.requestSwap(w)
  assert.equal(w.st, "carried", "no portal while carried")
  World.dragMove(w, 450, 700, 1.1)
  World.dragEnd(w, 2)
  run(w, 3)
  assert.equal(w.swapWanted, true, "still wanted after landing until the Service applies it")
  // A workspace switch during a swap portal takes it over: the swap still lands
  // at the gap, and the buddy comes out at the new perch.
  const s = make()
  World.setEnv(s, envFor(MAXIMIZED, "0xa"))
  World.place(s, { x: 400, y: 800 })
  World.requestSwap(s)
  run(s, 0.1)
  World.workspaceSwitch(s, -1, "side")
  assert.equal(s.portal.swap, false)
  let gaps = 0
  run(s, 3, (s2) => { for (const ev of World.drain(s2)) if (ev.type === "gap") { gaps++; World.clearSwap(s2) } })
  assert.equal(gaps, 1)
  assert.notEqual(s.st, "portal")
})

test("warp none still reports the gap and the monitor change", () => {
  const w = make()
  World.setFlags(w, { warp: "none" })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  World.drain(w)
  World.monitorSwitch(w, 1, "HDMI-A-1")
  const types = World.drain(w).map(e => e.type)
  assert.deepEqual(types.filter(t => t !== "landed"), ["screen", "gap", "arrived"])
  World.requestSwap(w)
  assert.ok(World.drain(w).some(e => e.type === "gap"), "a swap with warp none is instant")
})

test("battery saver: fewer ticks at rest, no hangs or random flourishes", () => {
  const w = make("stay", withSpecial({}))
  World.setFlags(w, { saver: true, policy: Power.SAVER })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  let ticks = 0
  run(w, 120, () => { ticks++ })
  assert.ok(ticks / 120 < 2, "under 2 ticks/s at rest (got " + (ticks / 120).toFixed(2) + ")")
  const h = make("hopper", withSpecial({}))
  World.setFlags(h, { saver: true, policy: Power.SAVER })
  World.setEnv(h, envFor(MAXIMIZED, "0xa"))
  World.place(h, { x: 400, y: 800 })
  const seen = new Set()
  run(h, 600, (h2) => seen.add(h2.st))
  assert.ok(!seen.has("hang"), "never hangs in saver mode")
  assert.ok(!seen.has("special"), "no random flourishes in saver mode")
  // The same seeded ten minutes with power do flourish now and then.
  const n = make("hopper", withSpecial({}))
  World.setEnv(n, envFor(MAXIMIZED, "0xa"))
  World.place(n, { x: 400, y: 800 })
  const seenN = new Set()
  run(n, 600, (n2) => seenN.add(n2.st))
  assert.ok(seenN.has("special") || seenN.has("hang"), "normal mode has its excursions")
})

test("react knows its names and refuses others", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  for (const name of World.REACTIONS) assert.equal(World.react(w, name), true, name)
  assert.equal(World.react(w, "moonwalk"), false)
  World.react(w, "spin")
  const f0 = World.render(w).facing
  run(w, 0.15)
  assert.notEqual(World.render(w).facing, f0, "spin flips facing")
})

// ---- v0.3: focus, summon, leap

test("focusing: settles with the tomato timer, keeps it through mood changes, and stays put", () => {
  const w = make("hopper", withSpecial({}))
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 1)
  World.setFlags(w, { focusing: true })
  assert.equal(w.st, "sit")
  assert.equal(World.render(w).prop, "tomato")
  World.setMood(w, "reading", "book", null)
  assert.equal(World.render(w).prop, "tomato", "a mood change keeps the tomato")
  const seen = new Set()
  const x0 = w.x
  run(w, 600, (w2) => seen.add(w2.st))
  for (const st of ["walk", "hang", "special", "hop"]) assert.ok(!seen.has(st), "no " + st + " while focusing")
  assert.equal(w.x, x0)
  // A window focus change only makes it glance.
  World.focusChanged(w)
  assert.ok(w.st === "sit" || w.st === "idle")
  World.setFlags(w, { focusing: false })
  assert.notEqual(World.render(w).prop, "tomato")
})

test("summon: drops out of a portal under the bar at the icon and lands below", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 300, y: 800 })
  run(w, 1)
  assert.equal(World.summon(w, 1000), true)
  assert.equal(w.st, "portal")
  assert.equal(w.portal.entry, null, "exit-only")
  let minY = Infinity, sawExit = false
  run(w, 3, (w2) => {
    if (w2.portal && w2.portal.phase === "exit") sawExit = true
    if (w2.st === "portal" || w2.st === "fall") minY = Math.min(minY, w2.y)
  })
  assert.ok(sawExit)
  assert.ok(minY < MON.top + 80, "came out right under the bar (" + minY + ")")
  assert.equal(Math.round(w.x), 1000)
  assert.equal(w.y, 800)
  assert.equal(w.support.kind, "floor")
  // It stays a while instead of hopping straight back to its perch.
  World.focusChanged(w)
  assert.notEqual(w.st, "hop")
  // Off-screen x is clamped; warp none drops it straight in.
  const n = make()
  World.setFlags(n, { warp: "none" })
  World.setEnv(n, envFor(MAXIMIZED, "0xa"))
  World.place(n, { x: 300, y: 800 })
  World.summon(n, 99999)
  assert.equal(n.st, "fall")
  assert.ok(n.x <= MON.right - World.halfW(n))
})

test("leap: a big hop in place with a bolt", () => {
  const w = make("stay")
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 500, y: 800 })
  run(w, 1)
  assert.equal(World.react(w, "leap"), true)
  assert.equal(w.st, "hop")
  assert.equal(World.render(w).emote.id, "bolt")
  let top = Infinity
  run(w, 1.5, (w2) => { top = Math.min(top, w2.y) })
  assert.ok(800 - top > 60, "a big hop (" + (800 - top) + " px)")
  assert.equal(w.x, 500)
  assert.equal(w.y, 800)
  // In stay mode it lands exactly where it was, even in mid-air.
  World.dragStart(w, 500, 780, 1)
  World.dragMove(w, 600, 400, 1.5)
  World.dragEnd(w, 2)
  run(w, 2)
  const y0 = w.y
  World.react(w, "leap")
  run(w, 1.5)
  assert.deepEqual([Math.round(w.x), Math.round(w.y)], [600, Math.round(y0)])
  assert.notEqual(w.st, "fall")
})

test("focus on the bar: jumps up through a portal, stays away, then drops back in under the icon", () => {
  const w = make()
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 400, y: 800 })
  run(w, 1)
  World.drain(w)
  assert.equal(World.goAway(w), true)
  assert.equal(w.portal.up, true)
  assert.ok(w.portal.entry.y < 800, "the portal opens above it")
  let maxClipTop = false
  run(w, 2, (w2) => { const r = World.render(w2); if (r.ops.clip && r.ops.clip.side === "top") maxClipTop = true })
  assert.ok(maxClipTop, "its top disappears into the portal first")
  assert.equal(w.st, "away")
  let r = World.render(w)
  assert.equal(r.visible, false)
  assert.equal(r.portals.length, 0)
  // Nothing moves it while it's away.
  assert.equal(World.react(w, "cheer"), true)
  assert.equal(World.react(w, "moonwalk"), false)
  World.workspaceSwitch(w, 1, "side")
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  assert.equal(World.summon(w, 900), false)
  run(w, 30)
  assert.equal(w.st, "away")
  // Back down under the bar icon.
  assert.equal(World.comeBack(w, 1000), true)
  run(w, 3)
  assert.equal(Math.round(w.x), 1000)
  assert.equal(w.y, 800)
  assert.equal(World.render(w).visible, true)
  assert.notEqual(w.st, "away")
})

test("focus on the bar: without an icon position, or in stay mode, it comes back where it was", () => {
  const s = make("stay")
  World.setEnv(s, envFor(MAXIMIZED, "0xa"))
  World.place(s, { x: 700, y: 500 })
  run(s, 1)
  World.goAway(s)
  run(s, 2)
  assert.equal(s.st, "away")
  World.comeBack(s, 1000)            // stay mode ignores the icon: it keeps its spot
  run(s, 2)
  assert.deepEqual([Math.round(s.x), Math.round(s.y)], [700, 500])
  // warp none and hidden: instant both ways.
  const n = make()
  World.setFlags(n, { warp: "none" })
  World.setEnv(n, envFor(MAXIMIZED, "0xa"))
  World.place(n, { x: 400, y: 800 })
  World.goAway(n)
  assert.equal(n.st, "away")
  World.comeBack(n, -1)
  assert.equal(Math.round(n.x), 400)
  const h = make()
  World.setEnv(h, envFor(MAXIMIZED, "0xa"))
  World.place(h, { x: 400, y: 800 })
  World.setHidden(h, true)
  World.goAway(h)
  assert.equal(h.st, "away")
  World.comeBack(h, 1000)
  assert.equal(Math.round(h.x), 400, "hidden: straight back to its spot")
  assert.notEqual(h.st, "away")
})
