// Visiting friends: js/Visit.js and the world's side of a visit (a scripted
// friend that portals in and out, a host that keeps still).
const test = require("node:test")
const assert = require("node:assert/strict")
const { js, rng } = require("./helpers.cjs")

const Visit = js("Visit")
const World = js("World")
const P = js("Platforms")
const M = js("Motion")
const Personality = js("Personality")

const MON = P.monitorRect({ x: 0, y: 0, width: 1280, height: 800 }, [0, 26, 0, 0])
const SPRITE = { w: 42, h: 39 }
const METRICS = {
  k: 3, w: 16, h: 16, body: { x0: 1, y0: 3, x1: 14, y1: 15 }, hangTop: 1, motion: "walk", floats: false, flies: false, speed: 1,
  fps: { idle: 1.25, walk: 8, sit: 1, sleep: 0.8, carried: 4, hang: 2, cheer: 6, jump: 1, fall: 6, special: 6 },
  frames: { idle: 2, walk: 4, sit: 1, sleep: 2, carried: 2, hang: 2, cheer: 2, jump: 1, fall: 2, special: 2 },
  special: { travel: 2, emote: null, duration: null }, personality: null
}
const MAXIMIZED = [{ address: "0xa", at: [12, 38], size: [1256, 750], workspace: { id: 1 }, monitor: 0, class: "kitty", focusHistoryID: 0 }]
const MIN = 60000

function envFor(clients, focusAddress) {
  const rects = P.clientRects(clients, MON, { monitorId: 0, workspaceIds: [1], border: 2 })
  const ledges = P.ledges(rects, MON, SPRITE)
  const focused = rects.find(r => r.address === focusAddress) || null
  return { mon: MON, ledges, focused, perch: P.perchFor(focused, ledges, {}, SPRITE, MON) }
}

function make(opts = {}) {
  return World.create({ motion: M, platforms: P, personalities: Personality, metrics: METRICS, rng: rng(opts.seed || 5), mode: opts.mode || "hopper", scripted: !!opts.scripted })
}

// Ticks every world in lockstep the way the QML drivers do.
function run(worlds, seconds, onTick) {
  let t = 0
  while (t < seconds) {
    let dt = seconds - t + 0.001
    for (const w of worlds) { const r = World.tick(w, 0); dt = Math.min(dt, r.fast ? 1 / 60 : r.wait) }
    for (const w of worlds) World.tick(w, dt)
    t += dt
    if (onTick) onTick(t)
  }
}

const OK_CTX = { placed: true, hidden: false, covered: false, screencast: false, focusing: false, idle: false, bubble: false, busy: false, uptimeMs: 10 * MIN }

test("the first visit comes about ten minutes in; then every friendEvery minutes, give or take", () => {
  const now = 1e12
  const s = Visit.restore(undefined, now, 45)
  assert.equal(Visit.nextAt(s, 45) - now, 10 * MIN)
  assert.deepEqual(Visit.restore({ last: now + 5000, jitter: 7, recent: ["cat", "Bad Id", 3] }, now, 45).recent, ["cat"])
  assert.equal(Visit.restore({ last: now + 5000 }, now, 45).last, now - 35 * MIN, "a last visit in the future is ignored")
  assert.equal(Visit.restore({ jitter: 7 }, now, 45).jitter, 1)
  const after = Visit.visited(s, now, "frog", () => 0.75)
  assert.equal(after.last, now)
  assert.equal(after.jitter, 0.5)
  assert.ok(Math.abs(Visit.nextAt(after, 45) - now - 45 * MIN * 1.1) < 1)
  let r = after
  for (const id of ["cat", "duck", "frog", "robot"]) r = Visit.visited(r, now, id, () => 0)
  assert.deepEqual(r.recent, ["duck", "frog", "robot"])
})

test("due: off, waiting, starting up, every blocker, retry, then due", () => {
  const now = 1e12
  const s = { last: now - 50 * MIN, jitter: 0, recent: [] }
  const cfg = { enabled: true, everyMinutes: 45 }
  assert.equal(Visit.due(s, now, { enabled: false, everyMinutes: 45 }, OK_CTX).reason, "off")
  assert.equal(Visit.due({ last: now - 10 * MIN, jitter: 0 }, now, cfg, OK_CTX).reason, "waiting")
  assert.equal(Visit.due(s, now, cfg, Object.assign({}, OK_CTX, { uptimeMs: 30000 })).reason, "starting")
  for (const [key, reason] of [["placed", "not placed"], ["hidden", "hidden"], ["covered", "fullscreen"], ["screencast", "screencast"],
    ["focusing", "focus"], ["idle", "idle"], ["bubble", "bubble"], ["busy", "busy"]]) {
    const ctx = Object.assign({}, OK_CTX, { [key]: key !== "placed" })
    assert.equal(Visit.due(s, now, cfg, ctx).reason, reason)
    assert.equal(Visit.blocker(ctx), reason)
  }
  assert.equal(Visit.due(s, now, cfg, Object.assign({}, OK_CTX, { retryAt: now + 1000 })).reason, "waiting")
  assert.deepEqual(Visit.due(s, now, cfg, OK_CTX), { due: true, reason: "due", inMs: 0 })
  assert.equal(Visit.blocker(OK_CTX), "")
})

test("pickFriend: never the buddy itself, and someone who hasn't been round lately", () => {
  const ids = ["cat", "puppy", "frog", "duck"]
  for (let i = 0; i < 50; i++) {
    const id = Visit.pickFriend(ids, "cat", ["frog"], rng(i))
    assert.ok(id === "puppy" || id === "duck", id)
  }
  assert.equal(Visit.pickFriend(["cat", "frog"], "cat", ["frog"], () => 0.9), "frog", "everyone visited lately: anyone but itself")
  assert.equal(Visit.pickFriend(["cat"], "cat", [], Math.random), null)
  assert.equal(Visit.pickFriend([], "cat", [], Math.random), null)
})

test("spot: beside the buddy on its ledge, on the roomier side, facing it", () => {
  const mon = { left: 0, right: 1280 }
  const host = { x: 1100, y: 800, halfW: 21, ledge: { x1: 0, x2: 1280 } }
  const s = Visit.spot(host, 21, mon, 3, 40)
  assert.equal(s.side, -1)
  assert.equal(s.facing, 1)
  assert.equal(s.x, 1100 - (21 + 21 + 12))
  assert.equal(s.y, 800)
  // Too little room on the left of a short ledge: the right side, then none.
  assert.equal(Visit.spot({ x: 330, y: 400, halfW: 21, ledge: { x1: 300, x2: 600 } }, 21, mon, 3, 40).side, 1)
  assert.equal(Visit.spot({ x: 330, y: 400, halfW: 21, ledge: { x1: 300, x2: 400 } }, 21, mon, 3, 40), null)
  assert.equal(Visit.spot({ x: 700, y: 400, halfW: 21, ledge: null }, 21, mon, 3, 40).side, -1, "no ledge: the monitor")
})

test("timeline: arrive, greet, both show off once, cheer, leave, in about ten seconds", () => {
  for (let seed = 0; seed < 20; seed++) {
    const steps = Visit.timeline(rng(seed))
    assert.equal(steps[0].act, "arrive")
    assert.equal(steps[steps.length - 1].act, "leave")
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].at > steps[i - 1].at)
    const specials = steps.filter(s => s.act === "special").map(s => s.who).sort()
    assert.deepEqual(specials, ["friend", "host"])
    assert.ok(Visit.GREETINGS.includes(steps.find(s => s.act === "greet").emote))
    assert.ok(steps[steps.length - 1].at <= 10)
  }
})

test("a scripted friend never decides anything by itself", () => {
  const f = make({ scripted: true })
  World.setEnv(f, Object.assign({}, envFor(MAXIMIZED, "0xa"), { perch: null, focused: null }))
  World.place(f, { x: 500, y: 800 })
  const states = new Set()
  run([f], 600, () => states.add(f.st))
  assert.equal(Math.round(f.x), 500)
  for (const st of states) assert.ok(["idle", "land"].includes(st), st)
})

test("the friend steps out of a side portal next to the buddy and leaves through one", () => {
  const env = Object.assign({}, envFor(MAXIMIZED, "0xa"), { perch: null, focused: null })
  const f = make({ scripted: true })
  World.setEnv(f, env)
  assert.ok(World.portalIn(f, { x: 700, y: 800, facing: 1 }, 1))
  assert.equal(f.st, "portal")
  assert.equal(f.portal.kind, "side")
  assert.equal(f.portal.phase, "open-out")
  assert.equal(World.render(f).visible, false, "hidden while its portal opens")
  assert.ok(f.portal.exit.x < 700, "the portal is on the far side, it walks toward the buddy")
  const events = []
  run([f], 2, () => { for (const e of World.drain(f)) events.push(e.type) })
  assert.ok(events.includes("arrived"))
  assert.equal(Math.round(f.x), 700)
  assert.equal(f.facing, 1)
  assert.ok(World.render(f).visible)
  World.face(f, -1)
  World.portalOut(f)
  assert.equal(f.st, "portal")
  assert.equal(f.portal.dir, -1)
  run([f], 2, () => { for (const e of World.drain(f)) events.push(e.type) })
  assert.ok(events.includes("gone"))
  assert.equal(f.st, "gone")
  assert.equal(World.render(f).visible, false)
  assert.equal(World.render(f).portals.length, 0)
  assert.equal(World.react(f, "cheer"), true, "known reactions are skipped quietly")
  World.portalOut(f)
  assert.equal(World.drain(f).length, 0, "leaving twice does nothing")
})

test("without portals the friend just appears and vanishes; calm motion fades", () => {
  const env = Object.assign({}, envFor(MAXIMIZED, "0xa"), { perch: null, focused: null })
  const n = make({ scripted: true })
  World.setFlags(n, { warp: "none" })
  World.setEnv(n, env)
  World.portalIn(n, { x: 700, y: 800, facing: 1 }, 1)
  assert.notEqual(n.st, "portal")
  assert.ok(World.drain(n).some(e => e.type === "arrived"))
  World.portalOut(n)
  assert.equal(n.st, "gone")
  assert.ok(World.drain(n).some(e => e.type === "gone"))
  const c = make({ scripted: true })
  World.setFlags(c, { calm: true })
  World.setEnv(c, env)
  World.portalIn(c, { x: 700, y: 800, facing: 1 }, 1)
  assert.equal(c.portal.style, "fade")
  assert.equal(c.portal.phase, "fade-in")
  run([c], 1)
  assert.equal(Math.round(c.x), 700)
  World.portalOut(c)
  run([c], 1)
  assert.equal(c.st, "gone")
})

test("the host keeps still during a visit: no wandering, hopping, dangling, showing off or swaps", () => {
  const h = make({ seed: 9 })
  World.setEnv(h, envFor(MAXIMIZED, "0xa"))
  World.place(h, { x: 600, y: 800 })
  run([h], 30)
  World.setVisit(h, true)
  World.requestSwap(h)
  const x0 = h.x
  const states = new Set()
  run([h], 300, () => states.add(h.st))
  assert.equal(h.x, x0)
  for (const st of states) assert.ok(["idle", "sit", "land", "stretch"].includes(st), st)
  assert.equal(h.portal, null, "the swap waits")
  World.setVisit(h, false)
  run([h], 3)
  assert.ok(h.portal && h.portal.swap, "then it happens")
})

test("a visit stops a walk, and travelling moves play in place", () => {
  const h = make()
  World.setEnv(h, envFor(MAXIMIZED, "0xa"))
  World.place(h, { x: 600, y: 800 })
  World.setVisit(h, true)
  run([h], 1)
  const x0 = h.x
  World.special(h)
  run([h], 3)
  assert.equal(h.x, x0, "special with travel 2 stayed put")
})

test("the whole scene: both end where they started, the friend gone, in about ten seconds", () => {
  const env = envFor(MAXIMIZED, "0xa")
  const h = make({ seed: 3 })
  World.setEnv(h, env)
  World.place(h, { x: 900, y: 800 })
  run([h], 5)
  World.setVisit(h, true)
  run([h], 0.5)
  const host = { x: h.x, y: h.y, halfW: World.halfW(h), ledge: h.support }
  const f = make({ scripted: true, seed: 4 })
  World.setEnv(f, Object.assign({}, env, { perch: null, focused: null }))
  const spot = Visit.spot(host, World.halfW(f), MON, 3, 40)
  assert.ok(spot)
  World.portalIn(f, { x: spot.x, y: spot.y, ledge: h.support, facing: spot.facing }, spot.facing)
  const steps = Visit.timeline(rng(1))
  let i = 0, gone = false, t = 0
  const who = s => s.who === "both" ? [h, f] : s.who === "host" ? [h] : [f]
  run([h, f], 12, (now) => {
    t = now
    for (const e of World.drain(f)) if (e.type === "gone") gone = true
    World.drain(h)
    while (i < steps.length && steps[i].at <= now) {
      const s = steps[i++]
      for (const w of who(s)) {
        if (s.act === "notice") World.express(w, "bang", "wide", 1)
        if (s.act === "greet") { World.face(w, w === h ? spot.side : -spot.side); World.express(w, s.emote, "happy", 1.2) }
        if (s.act === "special") assert.ok(World.special(w), s.who + " shows off")
        if (s.act === "cheer") World.react(w, "cheer")
        if (s.act === "bye") World.express(w, "heart", "happy", 1)
        if (s.act === "leave") { World.face(w, spot.side); World.portalOut(w) }
      }
    }
    if (gone && i >= steps.length) return
  })
  assert.ok(gone, "the friend left")
  assert.equal(Math.round(h.x), Math.round(host.x), "the host didn't move")
  World.setVisit(h, false)
  run([h], 30)
  assert.notEqual(h.st, "portal")
})
