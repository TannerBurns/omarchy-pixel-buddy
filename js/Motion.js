// Physics helpers: hop arcs, gravity/throws with swept landings, clamps.
// Units are logical pixels and seconds; constants are tuned at art scale 3 and
// scale with k so every size feels the same.

var BASE_K = 3
var GRAVITY = 2600
var MAX_FALL = 1700
var FLOAT_GRAVITY = 0
var GLIDE_GRAVITY = 700
var GLIDE_MAX_FALL = 260
var WALL_BOUNCE = 0.45
var AIR_DRAG = 0.35
var GROUND_FRICTION = 9
var MAX_DT = 0.05

function scaled(v, k) { return v * (k || BASE_K) / BASE_K }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

// A hop from (x0, y0) to (x1, y1) as a quadratic Bezier peaking above both.
// `lift` (optional, at art scale 3) asks for a higher peak, e.g. a leap in place.
function hop(x0, y0, x1, y1, k, lift) {
  var dx = x1 - x0, dy = y1 - y0
  var dist = Math.sqrt(dx * dx + dy * dy)
  var up = scaled(lift > 0 ? clamp(lift, 16, 160) : clamp(16 + Math.abs(dx) * 0.16, 16, 110), k)
  var top = Math.min(y0, y1) - up
  var dur = clamp(0.3 + dist / scaled(1500, k), 0.3, 0.9)
  if (lift > 0) dur = clamp(0.35 + up / scaled(250, k), 0.35, 0.9)
  return {
    x0: x0, y0: y0, x1: x1, y1: y1,
    cx: (x0 + x1) / 2, cy: 2 * top - (y0 + y1) / 2,
    dur: dur
  }
}

function hopAt(arc, t) {
  var u = clamp(t, 0, 1), v = 1 - u
  return {
    x: v * v * arc.x0 + 2 * v * u * arc.cx + u * u * arc.x1,
    y: v * v * arc.y0 + 2 * v * u * arc.cy + u * u * arc.y1,
    rising: u < 0.5
  }
}

// A flight from (x0, y0) to (x1, y1), for characters that fly up to high spots:
// a taller, slower arc than a hop, eased at both ends, that never rises past
// `ceiling` (the feet y that keeps the head below the bar).
function flight(x0, y0, x1, y1, k, ceiling) {
  var dx = x1 - x0, dy = y1 - y0
  var dist = Math.sqrt(dx * dx + dy * dy)
  var up = scaled(clamp(36 + Math.abs(dx) * 0.12, 36, 150), k)
  var top = Math.min(y0, y1) - up
  var ceil = ceiling === undefined || ceiling === null ? -Infinity : ceiling
  if (top < ceil) top = ceil
  return {
    x0: x0, y0: y0, x1: x1, y1: y1,
    cx: (x0 + x1) / 2, cy: 2 * top - (y0 + y1) / 2,
    dur: clamp(0.7 + dist / scaled(480, k), 0.7, 2.6), ceiling: ceil
  }
}

function flightAt(arc, t) {
  var u = clamp(t, 0, 1)
  var p = hopAt(arc, u * u * (3 - 2 * u))
  if (p.y < arc.ceiling) p.y = arc.ceiling
  return p
}

// One physics step for a falling or thrown body.
// body: { x, y, vx, vy, k, floats, glides, halfW, bodyH }
// world: { mon, ledges, landingBelow(list, x, y0, y1, halfW) }
// Returns { landed: ledge | null, bounced: bool }.
function step(body, dt, world) {
  var d = Math.min(MAX_DT, Math.max(0, dt))
  var k = body.k || BASE_K
  var g = body.floats ? FLOAT_GRAVITY : body.glides ? scaled(GLIDE_GRAVITY, k) : scaled(GRAVITY, k)
  var maxFall = body.glides ? scaled(GLIDE_MAX_FALL, k) : scaled(MAX_FALL, k)
  body.vy = Math.min(maxFall, body.vy + g * d)
  body.vx *= Math.max(0, 1 - AIR_DRAG * d)
  var yPrev = body.y
  body.x += body.vx * d
  body.y += body.vy * d
  var mon = world.mon
  var bounced = false
  if (body.x - body.halfW < mon.left) { body.x = mon.left + body.halfW; body.vx = Math.abs(body.vx) * WALL_BOUNCE; bounced = true }
  if (body.x + body.halfW > mon.right) { body.x = mon.right - body.halfW; body.vx = -Math.abs(body.vx) * WALL_BOUNCE; bounced = true }
  // Never rest or fly into the bar zone.
  if (body.y - body.bodyH < mon.top) { body.y = mon.top + body.bodyH; if (body.vy < 0) body.vy = Math.abs(body.vy) * 0.25; bounced = true }
  var landed = null
  if (body.vy >= 0 && !body.floats) {
    landed = world.landingBelow(world.ledges, body.x, yPrev, body.y, body.halfW)
    if (landed) { body.y = landed.y; body.vy = 0 }
  }
  if (body.y > mon.bottom) { body.y = mon.bottom; body.vy = 0; landed = landed || { id: "floor", kind: "floor", x1: mon.left, x2: mon.right, y: mon.bottom } }
  return { landed: landed, bounced: bounced }
}

// Ground slide after a throw lands: decays horizontal speed, keeps x on the ledge.
function slide(body, dt, ledge) {
  var d = Math.min(MAX_DT, Math.max(0, dt))
  body.vx *= Math.max(0, 1 - GROUND_FRICTION * d)
  body.x += body.vx * d
  if (ledge) body.x = clamp(body.x, ledge.x1 + body.halfW * 0.4, ledge.x2 - body.halfW * 0.4)
  return Math.abs(body.vx) < scaled(12, body.k)
}

// No-gravity glide (patrol/roam/stay drops, floaters): friction only.
function glide(body, dt, mon) {
  var d = Math.min(MAX_DT, Math.max(0, dt))
  var f = Math.max(0, 1 - 4 * d)
  body.vx *= f
  body.vy *= f
  body.x = clamp(body.x + body.vx * d, mon.left + body.halfW, mon.right - body.halfW)
  body.y = clamp(body.y + body.vy * d, mon.top + body.bodyH, mon.bottom)
  return Math.abs(body.vx) + Math.abs(body.vy) < scaled(14, body.k)
}

if (typeof module !== "undefined") module.exports = {
  BASE_K: BASE_K, GRAVITY: GRAVITY, MAX_FALL: MAX_FALL, MAX_DT: MAX_DT,
  scaled: scaled, clamp: clamp, hop: hop, hopAt: hopAt, flight: flight, flightAt: flightAt, step: step, slide: slide, glide: glide
}
