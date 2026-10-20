// Personalities (js/Personality.js) and how the world acts on them.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const { js, rng, characterFiles } = require("./helpers.cjs")

const Personality = js("Personality")
const World = js("World")
const P = js("Platforms")
const M = js("Motion")

const MON = P.monitorRect({ x: 0, y: 0, width: 1280, height: 800 }, [0, 26, 0, 0])
const SPRITE = { w: 42, h: 39 }
const BASE_METRICS = {
  k: 3, w: 16, h: 16, body: { x0: 1, y0: 3, x1: 14, y1: 15 }, hangTop: 1, motion: "walk", floats: false, flies: false, speed: 1,
  fps: { idle: 1.25, walk: 8, sit: 1, sleep: 0.8, carried: 4, hang: 2, cheer: 6, jump: 1, fall: 6, special: 6 },
  frames: { idle: 2, walk: 4, sit: 1, sleep: 2, carried: 2, hang: 2, cheer: 2, jump: 1, fall: 2, special: 2 },
  special: { travel: 0, emote: null, duration: null }
}
const MAXIMIZED = [{ address: "0xa", at: [12, 38], size: [1256, 750], workspace: { id: 1 }, monitor: 0, class: "kitty", focusHistoryID: 0 }]

function envFor(clients, focusAddress) {
  const rects = P.clientRects(clients, MON, { monitorId: 0, workspaceIds: [1], border: 2 })
  const ledges = P.ledges(rects, MON, SPRITE)
  const focused = rects.find(r => r.address === focusAddress) || null
  return { mon: MON, ledges, focused, perch: P.perchFor(focused, ledges, {}, SPRITE, MON) }
}

// raw: a character's personality block (undefined = none). withModule false
// builds the world the way it was before personalities existed.
function make(raw, opts = {}) {
  const personality = opts.off ? null : Personality.normalize(raw).personality
  const metrics = Object.assign({}, BASE_METRICS, opts.metrics || {}, { personality })
  return World.create({
    motion: M, platforms: P, personalities: opts.withModule === false ? undefined : Personality,
    metrics, rng: rng(opts.seed || 7), mode: opts.mode || "hopper"
  })
}

function run(w, seconds, onTick) {
  let t = 0
  while (t < seconds) {
    const r = World.tick(w, 0)
    const dt = r.fast ? 1 / 60 : Math.min(r.wait, seconds - t + 0.001)
    World.tick(w, dt)
    t += dt
    if (onTick) onTick(w, t, dt)
  }
}

const builtin = id => JSON.parse(fs.readFileSync(characterFiles().find(f => f.endsWith("/" + id + ".json")), "utf8")).personality

test("normalize fills in the generic values and only warns about bad ones", () => {
  assert.deepEqual(Personality.normalize(undefined).personality, Personality.GENERIC)
  assert.deepEqual(Personality.normalize(undefined).warnings, [])
  const r = Personality.normalize({ energy: 5, naps: 0.3, follows: "yes", zippy: true, sneezes: true })
  assert.equal(r.personality.energy, 1, "out of range falls back")
  assert.equal(r.personality.naps, 0.3)
  assert.equal(r.personality.follows, false, "a string is not a boolean")
  assert.equal(r.personality.zippy, true)
  assert.equal(r.warnings.length, 3)
  assert.ok(r.warnings.some(w => w.includes("sneezes")))
  assert.equal(Personality.normalize([1, 2]).warnings.length, 1)
  assert.equal(Personality.normalize(true).warnings.length, 1)
  assert.ok(Personality.isGeneric(Personality.normalize({}).personality))
  assert.ok(!Personality.isGeneric(Personality.normalize({ naps: 0.5 }).personality))
})

test("every built-in personality is valid, and the ones the roster promises are there", () => {
  for (const f of characterFiles()) {
    const raw = JSON.parse(fs.readFileSync(f, "utf8")).personality
    assert.deepEqual(Personality.normalize(raw).warnings, [], f)
  }
  assert.ok(builtin("cat").aloof > 0 && builtin("cat").naps > 0)
  assert.equal(builtin("puppy").follows, true)
  assert.equal(builtin("hamster").zippy, true)
  assert.equal(builtin("dragon").flies, true)
  assert.ok(builtin("ghost").wander > 1)
  assert.equal(builtin("knight").patrols, true)
  assert.ok(builtin("zombie").energy < 1)
})

test("generic weights are exactly the cutoffs from before personalities", () => {
  const g = Personality.GENERIC
  assert.deepEqual(Personality.weights(g, { mode: "hopper", night: false, scale: 1 }), { wander: 0.42, sit: 0.76, sleep: 0.76, nap: 0.76 })
  assert.deepEqual(Personality.weights(null, { mode: "hopper", night: true, scale: 0.4 }), { wander: 0.42 * 0.4, sit: 0.76, sleep: 0.86, nap: 0.86 })
  assert.equal(Personality.weights(g, { mode: "stay", night: false, scale: 1 }).wander, 0)
  // A personality reshapes them but never past 97% of decisions.
  const ghost = Personality.normalize({ wander: 2, energy: 2 }).personality
  const c = Personality.weights(ghost, { mode: "hopper", night: false, scale: 1 })
  assert.ok(c.wander > 0.42 && c.nap <= 0.97 + 1e-9)
  const napper = Personality.weights(Personality.normalize({ naps: 1 }).personality, { mode: "hopper", night: false, scale: 1 })
  assert.ok(napper.nap > napper.sleep, "daytime naps get a share")
  assert.equal(Personality.weights(Personality.normalize({ naps: 1 }).personality, { mode: "hopper", night: true, scale: 1 }).nap,
    Personality.weights(Personality.normalize({ naps: 1 }).personality, { mode: "hopper", night: true, scale: 1 }).sleep, "no naps at night: it sleeps")
})

test("a character without a personality behaves exactly as before personalities", () => {
  const trace = w => { const out = []; run(w, 600, w2 => out.push(w2.st + ":" + Math.round(w2.x) + ":" + Math.round(w2.y))); return out }
  for (const mode of ["hopper", "patrol", "roam", "stay"]) {
    const a = make(undefined, { mode, withModule: false })
    const b = make(undefined, { mode })
    for (const w of [a, b]) { World.setEnv(w, envFor(MAXIMIZED, "0xa")); World.place(w, { x: 600, y: 800 }) }
    assert.deepEqual(trace(b), trace(a), mode)
  }
  // Same with the personality setting off for a character that has one.
  const a = make(builtin("cat"), { off: true, withModule: false })
  const b = make(builtin("cat"), { off: true })
  for (const w of [a, b]) { World.setEnv(w, envFor(MAXIMIZED, "0xa")); World.place(w, { x: 600, y: 800 }) }
  assert.deepEqual(trace(b), trace(a))
})

function asleepSeconds(raw, seed) {
  const w = make(raw, { seed })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 600, y: 800 })
  let asleep = 0
  run(w, 1800, (w2, t, dt) => { if (w2.st === "sleep") asleep += dt })
  return asleep
}

test("the cat takes daytime naps; the puppy doesn't", () => {
  let cat = 0, puppy = 0
  for (const seed of [1, 2, 3]) { cat += asleepSeconds(builtin("cat"), seed); puppy += asleepSeconds(builtin("puppy"), seed) }
  assert.ok(cat > 120, "cat napped " + Math.round(cat) + " s in 90 minutes")
  assert.equal(puppy, 0)
})

test("the puppy trots after the pointer along its ledge; a generic buddy stays put", () => {
  for (const [raw, follows] of [[builtin("puppy"), true], [undefined, false]]) {
    const w = make(raw)
    World.setEnv(w, envFor(MAXIMIZED, "0xa"))
    World.place(w, { x: 1000, y: 800 })
    run(w, 2)
    const x0 = w.x
    let minX = w.x
    // The pointer keeps moving around far to the left.
    run(w, 90, (w2, t) => { World.setCursor(w2, 150 + (Math.floor(t * 4) % 2) * 6, 500); minX = Math.min(minX, w2.x) })
    if (follows) {
      // A few hundred pixels at a time, every half minute or so.
      assert.ok(minX < x0 - 500, "walked toward the pointer (" + Math.round(x0) + " -> " + Math.round(minX) + ")")
      assert.ok(minX >= MON.left + World.halfW(w), "stays on screen")
    } else {
      assert.ok(minX > x0 - 250, "a generic buddy wanders but doesn't chase (" + Math.round(minX) + ")")
    }
  }
})

test("the puppy only follows while the pointer is moving, and never in stay mode", () => {
  const w = make(builtin("puppy"), { mode: "stay" })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 1000, y: 800 })
  run(w, 12, w2 => World.setCursor(w2, 150 + (Math.floor(w2.clock * 4) % 2) * 6, 500))
  assert.equal(Math.round(w.x), 1000)
  const h = make(builtin("puppy"))
  World.setEnv(h, envFor(MAXIMIZED, "0xa"))
  World.place(h, { x: 1000, y: 800 })
  World.setCursor(h, 150, 500)
  run(h, 30)
  // The cursor stopped moving at once: at most the first follow (fresh) can happen.
  let follows = 0
  const g = make(builtin("puppy"))
  World.setEnv(g, envFor(MAXIMIZED, "0xa"))
  World.place(g, { x: 1000, y: 800 })
  World.setCursor(g, 150, 500)
  run(g, 60, w2 => { if (w2.st === "walk" && w2.plan && w2.plan.follow && w2.t === 0) follows++ })
  assert.ok(follows <= 1, "a still pointer isn't chased again (" + follows + ")")
})

const HIGH = { address: "0xb", at: [700, 150], size: [400, 300], workspace: { id: 1 }, monitor: 0, class: "kitty", floating: true, focusHistoryID: 0 }

test("the dragon flies up to a high perch; others take a mini portal", () => {
  for (const [raw, flies] of [[builtin("dragon"), true], [undefined, false]]) {
    const w = make(raw, { metrics: { motion: "fly", flies: true } })
    World.setEnv(w, envFor(MAXIMIZED.concat([HIGH]), "0xb"))
    World.place(w, { x: 200, y: 800 })
    const states = new Set()
    let highest = 9999, reached = false
    World.goTo(w, w.env.perch)
    run(w, 4, w2 => {
      if (reached) return
      states.add(w2.st)
      highest = Math.min(highest, w2.y - World.bodyH(w2))
      if (w2.st === "land" && w2.support && w2.support.address === "0xb") reached = true
    })
    assert.ok(reached, (raw ? "dragon" : "generic") + " reached the window top (" + [...states].join(",") + ")")
    if (flies) {
      assert.ok(states.has("fly") && !states.has("portal"), [...states].join(","))
      assert.ok(highest >= MON.top, "stays below the bar (" + highest + ")")
    } else {
      assert.ok(states.has("portal") && !states.has("fly"))
    }
  }
})

test("a flyer also flies up to dangle from a high window edge", () => {
  const w = make(builtin("dragon"))
  World.setEnv(w, envFor(MAXIMIZED.concat([HIGH]), "0xb"))
  World.place(w, { x: 200, y: 800 })
  World.react(w, "hang")
  assert.equal(w.st, "fly")
  run(w, 3)
  assert.equal(w.st, "hang")
})

test("an aloof cat sometimes gives a pet the cold shoulder", () => {
  const counts = { cat: { dots: 0, heart: 0 }, generic: { dots: 0, heart: 0 } }
  for (const [name, raw] of [["cat", builtin("cat")], ["generic", undefined]]) {
    const w = make(raw)
    World.setEnv(w, envFor(MAXIMIZED, "0xa"))
    World.place(w, { x: 600, y: 800 })
    for (let i = 0; i < 60; i++) {
      run(w, 2)
      w.emote = null
      World.pet(w)
      if (w.emote) counts[name][w.emote.id === "dots" ? "dots" : "heart"]++
    }
  }
  assert.ok(counts.cat.dots > 10 && counts.cat.heart > 10, JSON.stringify(counts.cat))
  assert.equal(counts.generic.dots, 0)
})

test("the knight walks its beat end to end and turns around at each end", () => {
  const w = make(builtin("knight"))
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 600, y: 800 })
  const targets = []
  let walking = null, turns = 0
  run(w, 900, (w2) => {
    if (w2.st === "walk" && w2.plan && w2.plan.patrol && walking !== w2.plan) { walking = w2.plan; targets.push({ x: Math.round(w2.plan.x), dir: w2.facing }) }
    if (walking && w2.st !== "walk") {
      // At the end of the beat it faces back the way it came.
      if (Math.abs(w2.x - walking.x) < 1 && w2.facing === -targets[targets.length - 1].dir) turns++
      walking = null
    }
  })
  assert.ok(targets.length >= 6, "patrolled " + targets.length + " times")
  const ends = [...new Set(targets.map(t => t.x))]
  assert.ok(ends.length <= 3, "always the ends of its beat: " + ends.join(","))
  assert.ok(Math.max(...ends) - Math.min(...ends) > 200, "a long beat")
  assert.ok(turns >= targets.length - 1, "turned around at the ends (" + turns + "/" + targets.length + ")")
})

function walkedPixels(raw) {
  const w = make(raw, { seed: 11 })
  World.setEnv(w, envFor(MAXIMIZED, "0xa"))
  World.place(w, { x: 600, y: 800 })
  let dist = 0, last = w.x
  run(w, 600, w2 => { if (w2.st === "walk") dist += Math.abs(w2.x - last); last = w2.x })
  return dist
}

test("the hamster scurries around; the zombie barely moves", () => {
  const hamster = walkedPixels(builtin("hamster"))
  const generic = walkedPixels(undefined)
  const zombie = walkedPixels(builtin("zombie"))
  assert.ok(hamster > generic * 1.3, "hamster " + Math.round(hamster) + " vs generic " + Math.round(generic))
  assert.ok(zombie < generic * 0.6, "zombie " + Math.round(zombie) + " vs generic " + Math.round(generic))
})

test("pure helpers", () => {
  const p = Personality.normalize({ follows: true }).personality
  const ctx = { x: 600, halfW: 21, lo: 30, hi: 1250, cursor: { x: 100, y: 400 }, cursorAge: 1, sinceFollow: 40 }
  assert.ok(Personality.followX(p, Object.assign({}, ctx, { sinceFollow: 40 })) < 200)
  assert.equal(Personality.followX(p, Object.assign({}, ctx, { sinceFollow: 40, maxDist: 270 })), 330, "at most maxDist at a time")
  assert.equal(Personality.followX(p, Object.assign({}, ctx, { sinceFollow: 3 })), null, "at most every 30 s")
  assert.equal(Personality.followX(p, Object.assign({}, ctx, { cursorAge: 9 })), null, "a stale pointer")
  assert.equal(Personality.followX(p, Object.assign({}, ctx, { cursor: { x: 630, y: 400 } })), null, "already close")
  assert.equal(Personality.followX(Personality.GENERIC, ctx), null)
  assert.equal(Personality.followX(p, Object.assign({}, ctx, { cursor: { x: -500, y: 0 } })), 30, "clamped to the ledge")
  const k = Personality.normalize({ patrols: true }).personality
  assert.equal(Personality.wanderTarget(k, 400, 100, 900, () => 0.5), 900)
  assert.equal(Personality.wanderTarget(k, 800, 100, 900, () => 0.5), 100)
  assert.equal(Personality.hopDelay(null), 6)
  assert.equal(Personality.hopDelay(Personality.GENERIC), 6)
  assert.ok(Personality.hopDelay(Personality.normalize({ zippy: true, energy: 1.5 }).personality) < 3)
  assert.equal(Personality.idleSecs(Personality.normalize({ energy: 0.5 }).personality, 4), 8)
})
