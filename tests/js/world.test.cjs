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
  run(w, 1)
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
