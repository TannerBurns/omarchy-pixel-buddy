// Personalities: how a character tends to behave. A character file can carry a
// `personality` block (every key optional); missing keys keep GENERIC, which is
// how every character behaved before personalities, so a character without one
// (or with the `personality` setting off) acts exactly as it always has. Bad
// values never reject a character: they warn and the generic value stands in.
//
//   energy   0.5-2   how lively it is: shorter idles and sits, more moving about
//   wander   0-2     how much it wanders around
//   naps     0-1     how often it takes a daytime nap
//   aloof    0-1     how often it shrugs off a pet
//   special  0-0.2   how often it shows off on its own (per decision)
//   follows  bool    trots after the pointer
//   zippy    bool    quick on its feet: faster steps, quicker hops
//   flies    bool    flies up to high spots instead of taking a portal
//   patrols  bool    walks its beat end to end instead of ambling
//
// The world (js/World.js) gets this module passed in, like Motion and
// Platforms, and asks it how to decide.

var RANGES = { energy: [0.5, 2], wander: [0, 2], naps: [0, 1], aloof: [0, 1], special: [0, 0.2] }
var FLAGS = ["follows", "zippy", "flies", "patrols"]
var KEYS = ["energy", "wander", "naps", "aloof", "special", "follows", "zippy", "flies", "patrols"]
var GENERIC = { energy: 1, wander: 1, naps: 0, aloof: 0, special: 0.06, follows: false, zippy: false, flies: false, patrols: false }

// Seconds between cursor-following walks, and how fresh the pointer must be.
var FOLLOW_EVERY = 30
var FOLLOW_FRESH = 5

// Returns { personality, warnings }: every key filled in, nothing out of range.
function normalize(raw) {
  var p = {}
  var warnings = []
  for (var g in GENERIC) p[g] = GENERIC[g]
  if (raw === undefined || raw === null) return { personality: p, warnings: warnings }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("personality must be an object")
    return { personality: p, warnings: warnings }
  }
  for (var key in raw) {
    var v = raw[key]
    if (RANGES[key]) {
      var lo = RANGES[key][0], hi = RANGES[key][1]
      if (typeof v !== "number" || !isFinite(v) || v < lo || v > hi) warnings.push("personality." + key + " must be a number from " + lo + " to " + hi)
      else p[key] = v
    } else if (FLAGS.indexOf(key) >= 0) {
      if (typeof v !== "boolean") warnings.push("personality." + key + " must be true or false")
      else p[key] = v
    } else {
      warnings.push("unknown personality key '" + key + "' (known: " + KEYS.join(", ") + ")")
    }
  }
  return { personality: p, warnings: warnings }
}

function isGeneric(p) {
  if (!p) return true
  for (var k in GENERIC) if (p[k] !== GENERIC[k]) return false
  return true
}

// What a decision does, per movement mode, before any personality: cumulative
// cutoffs for one random draw. These are the numbers every character used
// before personalities (hopper: wander below 0.42 x the battery saver's wander
// scale, sit below 0.76, at night sleep below 0.86).
var BASE = {
  hopper: { wander: 0.42, sit: 0.76, sleep: 0.86 },
  patrol: { wander: 0.5, sit: 0.8, sleep: 0.8 },
  roam: { wander: 0.55, sit: 0.8, sleep: 0.8 },
  stay: { wander: 0, sit: 0.45, sleep: 0.55 }
}

// ctx: { mode, night, scale } (scale: the battery saver's wander scale).
// Returns cumulative cutoffs { wander, sit, sleep, nap } for one draw r:
// r < wander wanders, < sit sits, < sleep sleeps (night), < nap naps (day),
// anything above idles. A null personality gives the generic cutoffs.
function weights(p, ctx) {
  var b = BASE[ctx && ctx.mode] || BASE.hopper
  var scale = ctx && ctx.scale !== undefined ? ctx.scale : 1
  var night = !!(ctx && ctx.night)
  var wander = b.wander * scale
  var sit = b.sit - wander
  var sleep = night ? b.sleep - b.sit : 0
  var nap = 0
  if (p && !isGeneric(p)) {
    wander = Math.min(0.75, wander * p.wander * p.energy)
    sit = sit / p.energy
    nap = night ? 0 : p.naps * 0.15
    var total = wander + sit + sleep + nap
    if (total > 0.97) {
      var f = 0.97 / total
      wander *= f; sit *= f; sleep *= f; nap *= f
    }
  } else {
    return { wander: wander, sit: b.sit, sleep: night ? b.sleep : b.sit, nap: night ? b.sleep : b.sit }
  }
  return { wander: wander, sit: wander + sit, sleep: wander + sit + sleep, nap: wander + sit + sleep + nap }
}

// Scales a generic idle or sit duration (livelier characters settle for less).
function idleSecs(p, secs) { return p ? secs / p.energy / (p.zippy ? 1.5 : 1) : secs }

// The chance it sits down at the end of a walk (0.4 for everyone before).
function restAfterWalk(p) {
  if (!p) return 0.4
  return Math.min(0.9, 0.4 / p.energy * (p.zippy ? 0.5 : 1))
}

// Minimum seconds between hops back to its spot (6 for everyone before).
function hopDelay(p) {
  if (!p) return 6
  return 6 / p.energy * (p.zippy ? 0.5 : 1)
}

// Walking pace multiplier.
function pace(p) { return p && p.zippy ? 1.6 : 1 }

// How far it wanders around its spot, as a multiple of the usual radius
// (wanderers roam wider, a patroller walks a longer beat).
function reach(p) { return p ? Math.max(p.patrols ? 1.5 : 1, p.wander) : 1 }

// The share of decisions that are a signature move (when one is allowed).
function specialChance(p) { return p ? p.special : GENERIC.special }

// True when this pet gets the cold shoulder. Draws from rng only when aloof.
function ignoresPet(p, rng) { return !!(p && p.aloof > 0 && rng() < p.aloof) }

// Where a follower walks to, or null. ctx: { x, halfW, lo, hi, cursor: {x, y}
// or null, cursorAge (seconds since it moved), sinceFollow (seconds), maxDist }.
// It heads toward the pointer, at most maxDist at a time, and stops a little
// short of it, inside [lo, hi].
function followX(p, ctx) {
  if (!p || !p.follows || !ctx.cursor) return null
  if (ctx.cursorAge > FOLLOW_FRESH || ctx.sinceFollow < FOLLOW_EVERY) return null
  var hw = ctx.halfW
  var dx = ctx.cursor.x - ctx.x
  if (Math.abs(dx) < hw * 3) return null
  var target = ctx.cursor.x - (dx > 0 ? 1 : -1) * hw * 1.5
  if (ctx.maxDist > 0 && Math.abs(target - ctx.x) > ctx.maxDist) target = ctx.x + (dx > 0 ? 1 : -1) * ctx.maxDist
  target = Math.max(ctx.lo, Math.min(ctx.hi, target))
  if (Math.abs(target - ctx.x) < hw) return null
  return target
}

// Where a wander goes: a patroller heads for the far end of its beat; anyone
// else picks a random spot (one draw from rng, as before).
function wanderTarget(p, x, lo, hi, rng) {
  if (p && p.patrols) return x - lo < hi - x ? hi : lo
  return lo + rng() * (hi - lo)
}

if (typeof module !== "undefined") module.exports = {
  RANGES: RANGES, FLAGS: FLAGS, KEYS: KEYS, GENERIC: GENERIC, BASE: BASE, FOLLOW_EVERY: FOLLOW_EVERY, FOLLOW_FRESH: FOLLOW_FRESH,
  normalize: normalize, isGeneric: isGeneric, weights: weights, idleSecs: idleSecs, restAfterWalk: restAfterWalk, hopDelay: hopDelay, pace: pace,
  reach: reach, specialChance: specialChance, ignoresPet: ignoresPet, followX: followX, wanderTarget: wanderTarget
}
