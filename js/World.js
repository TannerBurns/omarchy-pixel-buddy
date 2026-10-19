// The buddy's simulation: a small state machine plus physics. Pure JS; QML
// (Controller.qml) feeds it events and elapsed time and draws render(). Node
// tests drive it the same way.
//
// Coordinates are logical pixels relative to the monitor; (x, y) is the feet:
// x the center, y the bottom. tick() returns how soon it needs the next tick
// (`wait`, seconds) or `fast: true` while something moves smoothly, so the QML
// side never renders frames that change nothing.

var PORTAL_TIMES = {
  full: { "open-in": 0.2, enter: 0.3, "close-in": 0.14, gap: 0.05, "open-out": 0.18, exit: 0.3, "close-out": 0.16 },
  mini: { "open-in": 0.12, enter: 0.18, "close-in": 0.1, gap: 0.03, "open-out": 0.12, exit: 0.2, "close-out": 0.1 }
}
var PORTAL_ORDER = ["open-in", "enter", "close-in", "gap", "open-out", "exit", "close-out"]
var PORTAL_FPS = 15
var FADE_TIME = 0.22

function clamp(v, a, b) { return a > b ? (a + b) / 2 : v < a ? a : v > b ? b : v }

// opts: { motion, platforms, metrics, rng, mode, calm, warp }
// metrics: { k, w, h, body: {x0,y0,x1,y1}, hangTop, motion, floats, flies, speed, fps: {pose: fps}, frames: {pose: count} }
function create(opts) {
  var w = {
    M: opts.motion, P: opts.platforms, rng: opts.rng || Math.random,
    m: null, k: 3,
    mode: opts.mode || "hopper", calm: !!opts.calm, warp: opts.warp || "portal",
    x: 0, y: 0, vx: 0, vy: 0, facing: -1,
    support: null, placed: false, home: null,
    st: "idle", t: 0, dur: 2, plan: null,
    frame: 0, frameT: 0, clock: 0,
    blinkAt: 3, exprOverride: null, poseOverride: null, lookOverride: null,
    cursor: null, cursorMovedAt: -100,
    emote: null, prop: null, accessory: null,
    portal: null, switches: [], dizzyUntil: -1,
    lastHopAt: -100, lastHangAt: -1000, lastDecideAt: 0,
    mood: "playful", moodProp: null, moodEmote: null, night: false, tired: false,
    napping: false, hidden: false, stretchAnim: null, stretchT: 0,
    saver: false, policy: null, swapWanted: false, lastSpecialAt: -1000, spinUntil: -1,
    env: { mon: null, ledges: [], perch: null, focused: null },
    out: []
  }
  setMetrics(w, opts.metrics)
  return w
}

function setMetrics(w, metrics) {
  w.m = metrics
  w.k = metrics.k
  // A character swap lands while the buddy is inside the portal: size the exit
  // portal (and where it opens) for the new character.
  var P = w.portal
  if (P && P.style === "portal" && PORTAL_ORDER.indexOf(P.phase) <= PORTAL_ORDER.indexOf("gap")) {
    P.dims = portalDims(w, P.kind, P.mini)
    var off = halfW(w) + P.dims.w * w.k * 0.42
    if (P.kind === "side") P.exit = { x: P.dest.x - P.dir * off, y: P.dest.y - P.dims.h * w.k / 2 }
  }
  if (w.placed && w.env.mon && w.st !== "portal") clampToMonitor(w)
}

// Battery-saver policy (js/Power.js); defaults when none was set.
var NO_POLICY = { walkFps: 99, idleFps: 99, sleepFps: 99, blinkScale: 1, wanderScale: 1, hangs: true, specials: true }
function pol(w) { return w.policy || NO_POLICY }

// Frames per second for a pose, after the battery-saver caps.
function poseFps(w, pose) {
  var p = pol(w)
  var fps = fpsOf(w, pose)
  if (pose === "walk") return Math.min(fps * (w.m.speed || 1), p.walkFps)
  if (pose === "idle") return Math.min(fps, p.idleFps)
  if (pose === "sleep") return Math.min(fps, p.sleepFps)
  return fps
}

function halfW(w) { return (w.m.body.x1 - w.m.body.x0 + 1) * w.k / 2 }
function bodyH(w) { return (w.m.h - w.m.body.y0) * w.k }
function floats(w) { return !!w.m.floats }
function gravity(w) { return w.mode === "hopper" && !floats(w) }
function fpsOf(w, pose) { return (w.m.fps && w.m.fps[pose]) || 1 }
function framesOf(w, pose) { return (w.m.frames && w.m.frames[pose]) || 1 }
function emit(w, ev) { w.out.push(ev) }
function drain(w) { var o = w.out; w.out = []; return o }

function hangFeetY(w, ledgeY) {
  var top = w.m.hangTop === undefined ? w.m.body.y0 : w.m.hangTop
  return ledgeY + (w.m.h - top - 1) * w.k
}

function enter(w, st, dur, plan) {
  w.st = st
  w.t = 0
  w.dur = dur === undefined ? 2 : dur
  w.plan = plan || null
  w.frame = 0
  w.frameT = 0
  if (st !== "sit") w.prop = null
}

function clampToMonitor(w) {
  var mon = w.env.mon
  if (!mon) return
  var hw = halfW(w)
  w.x = clamp(w.x, mon.left + hw, mon.right - hw)
  if (w.st !== "hang") w.y = clamp(w.y, mon.top + bodyH(w), mon.bottom)
}

// ------------------------------------------------------------- placement

// Puts the buddy somewhere sensible: a restored position, else the perch, else
// the bottom-right of the monitor.
function place(w, pos) {
  var mon = w.env.mon
  if (!mon) return
  if (pos && isFinite(pos.x) && isFinite(pos.y)) { w.x = pos.x; w.y = pos.y }
  else if (w.mode === "hopper" && w.env.perch) { w.x = w.env.perch.x; w.y = w.env.perch.kind === "hang" ? mon.bottom : w.env.perch.y }
  else { w.x = mon.right - halfW(w) - 48 * w.k / 3; w.y = mon.bottom }
  w.placed = true
  clampToMonitor(w)
  w.home = { x: w.x, y: w.y }
  w.support = null
  if (gravity(w)) {
    w.support = w.P.supportAt(w.env.ledges, w.x, w.y, halfW(w), 2)
    if (!w.support) { w.vx = 0; w.vy = 0; enter(w, "fall", 99) }
    else { w.y = w.support.y; idle(w, 1.5) }
  } else {
    idle(w, 1.5)
  }
}

// ------------------------------------------------------------- environment

// env: { mon, ledges, perch, focused }
function setEnv(w, env) {
  w.env = env
  if (!env.mon) return
  if (!w.placed) return
  if (w.st === "portal") { refinePortal(w); return }
  if (w.st === "carried" || w.st === "thrown" || w.st === "glide") return
  if (!gravity(w)) { clampToMonitor(w); return }
  if (w.st === "hop") return
  if (!w.support) { if (w.st !== "fall") { w.vx = 0; w.vy = 0; enter(w, "fall", 99) }; return }
  var l = w.P.byId(env.ledges, w.support.id)
  if (!l) {
    // Same window, re-split ledge (occlusion changed)? Re-find by address.
    l = w.support.address ? findByAddress(env.ledges, w.support.address, w.x, w.support.kind) : null
  }
  if (!l || (l.kind === "hang") !== (w.st === "hang")) {
    w.support = null
    w.vx = 0; w.vy = 0
    setExpr(w, "wide", 0.8)
    enter(w, "fall", 99)
    return
  }
  // Ride along with a moving window.
  if (l.address && w.support.address === l.address) w.x += l.x1 - w.support.x1
  w.support = l
  if (w.st === "hang") w.y = hangFeetY(w, l.y)
  else w.y = l.y
  var hw = halfW(w)
  if (w.x + hw * 0.4 < l.x1 || w.x - hw * 0.4 > l.x2) {
    w.support = null
    enter(w, "fall", 99)
  }
  clampToMonitor(w)
}

function findByAddress(list, address, x, kind) {
  var best = null
  for (var i = 0; i < list.length; i++) {
    var l = list[i]
    if (l.address !== address || l.kind !== kind) continue
    if (x >= l.x1 && x <= l.x2) return l
    if (!best) best = l
  }
  return best
}

function setMode(w, mode) {
  if (w.mode === mode) return
  w.mode = mode
  if (!w.placed) return
  w.home = { x: w.x, y: w.y }
  if (w.st === "hang" || w.st === "hop") { w.support = null; enter(w, gravity(w) ? "fall" : "idle", gravity(w) ? 99 : 1) }
  if (gravity(w)) {
    w.support = w.P.supportAt(w.env.ledges, w.x, w.y, halfW(w), 2)
    if (!w.support) { w.vx = 0; w.vy = 0; enter(w, "fall", 99) }
  } else {
    w.support = null
    if (w.st === "fall") idle(w, 1)
  }
}

function setMood(w, mood, prop, emote) {
  w.mood = mood
  w.moodProp = prop || null
  w.moodEmote = emote || null
  if (w.st === "sit" && w.prop !== w.moodProp) w.prop = w.moodProp
}

function setFlags(w, f) {
  if (f.night !== undefined) w.night = !!f.night
  if (f.tired !== undefined) w.tired = !!f.tired
  if (f.calm !== undefined) w.calm = !!f.calm
  if (f.warp !== undefined) w.warp = f.warp
  if (f.saver !== undefined) w.saver = !!f.saver
  if (f.policy !== undefined) w.policy = f.policy || null
}

// ------------------------------------------------------------- expressions

function setExpr(w, expr, secs) { w.exprOverride = { expr: expr, until: w.clock + secs } }
function setEmote(w, id, secs) { w.emote = { id: id, until: w.clock + secs, start: w.clock } }
function setLook(w, look, secs) { w.lookOverride = { look: look, until: w.clock + secs } }
function setPose(w, pose, secs) { w.poseOverride = { pose: pose, until: w.clock + secs } }

function lookToward(w, px, py) {
  var dx = px - w.x, dy = py - (w.y - bodyH(w) * 0.6)
  var hw = halfW(w)
  return [Math.abs(dx) < hw * 1.2 ? 0 : dx > 0 ? 1 : -1, Math.abs(dy) < bodyH(w) * 0.8 ? 0 : dy > 0 ? 1 : -1]
}

// ------------------------------------------------------------- behaviors

function idle(w, secs) { enter(w, "idle", secs === undefined ? 2 + w.rng() * 4 : secs) }

function sit(w) {
  enter(w, "sit", 8 + w.rng() * 14)
  w.prop = w.moodProp
  if (w.moodEmote && w.rng() < 0.5) setEmote(w, w.moodEmote, 1.6)
}

function sleep(w, secs) {
  enter(w, "sleep", secs)
  setEmote(w, "zzz", 9999)
}

var BUSY = ["carried", "portal", "hop", "fall", "thrown", "skid", "glide", "hang"]

// The character's signature move (its `special` pose; characters without one
// fall back to cheer). Optional pose fields: travel (art px per frame, in the
// facing direction, stopping at the ledge end), emote, duration.
function special(w) {
  if (!w.placed || w.hidden || BUSY.indexOf(w.st) >= 0) return false
  var sp = w.m.special || {}
  var frames = framesOf(w, "special"), fps = fpsOf(w, "special")
  var dur = sp.duration || clamp(frames / fps * 2, 0.6, 3)
  w.lastSpecialAt = w.clock
  w.poseOverride = null      // a pet's short cheer must not hide the move
  // Stay mode means exactly where you put it: travelling moves play in place.
  enter(w, "special", dur, { travel: w.mode === "stay" ? 0 : sp.travel || 0 })
  if (sp.emote) setEmote(w, sp.emote, dur)
  setExpr(w, "happy", dur)
  return true
}

function stepTravel(w) {
  var p = w.plan
  if (!p || !p.travel || !w.env.mon) return
  var hw = halfW(w)
  var lo = w.env.mon.left + hw, hi = w.env.mon.right - hw
  if (gravity(w) && w.support) { lo = Math.max(lo, w.support.x1 + hw * 0.3); hi = Math.min(hi, w.support.x2 - hw * 0.3) }
  var nx = w.x + p.travel * w.k * (w.facing || 1)
  if (nx < lo || nx > hi) { w.x = clamp(nx, lo, hi); p.travel = 0; return }
  w.x = nx
}

// A quick spin (theme change): facing flips every 0.12 s for a second.
function spin(w) {
  if (!w.placed || w.hidden) return
  w.spinUntil = w.clock + 1.0
  setEmote(w, "sparkle", 1.2)
}

function canFlourish(w) {
  return !w.calm && !w.night && !w.tired && pol(w).specials && w.clock - w.lastSpecialAt > 180
}

// ---- character swap: the old character walks into a portal and the new one
// steps out at the same spot. The Service applies the new character on the
// portal's "gap" event; if a portal is already in flight it carries the swap.
function calmState(w) { return ["idle", "sit", "walk", "land", "sleep", "stretch", "special"].indexOf(w.st) >= 0 }

function requestSwap(w) {
  w.swapWanted = true
  trySwap(w)
}

function clearSwap(w) { w.swapWanted = false }

function trySwap(w) {
  if (!w.swapWanted || w.portal || !w.placed || w.hidden || !w.env.mon || !calmState(w)) return false
  var mon = w.env.mon
  var dir = mon.right - w.x >= w.x - mon.left ? 1 : -1
  startPortal(w, { kind: "side", dir: dir, swap: true, dest: { x: w.x, y: w.y, ledge: w.support, facing: w.facing } })
  return true
}

function atPerch(w, perch) {
  if (perch.kind === "hang") return w.st === "hang" && w.support && w.support.id === perch.ledgeId && Math.abs(w.x - perch.x) < halfW(w) * 3
  return w.support && w.support.id === perch.ledgeId && Math.abs(w.x - perch.x) < halfW(w) * 2.5
}

function wander(w, center, radius) {
  var mon = w.env.mon
  var hw = halfW(w)
  var lo = mon.left + hw, hi = mon.right - hw
  if (gravity(w) && w.support) { lo = Math.max(lo, w.support.x1 + hw * 0.5); hi = Math.min(hi, w.support.x2 - hw * 0.5) }
  if (center !== null && center !== undefined && radius) { lo = Math.max(lo, center - radius); hi = Math.min(hi, center + radius) }
  if (hi - lo < hw) return idle(w)
  var target = lo + w.rng() * (hi - lo)
  if (Math.abs(target - w.x) < hw) target = clamp(w.x + (target < w.x ? -1 : 1) * hw * 2.5, lo, hi)
  walkTo(w, target, null)
}

function walkTo(w, x, then) {
  w.facing = x > w.x ? 1 : -1
  enter(w, "walk", 60, { x: x, then: then })
}

// Move to a perch: walk along the same ledge, hop when it's within reach,
// mini-portal when it's far above.
function goTo(w, perch) {
  w.lastHopAt = w.clock
  if (!gravity(w)) { walkTo(w, perch.x, null); return }
  var mon = w.env.mon
  var ledge = perch.kind === "floor" ? { id: "floor", kind: "floor", x1: mon.left, x2: mon.right, y: mon.bottom, address: "" }
    : w.P.byId(w.env.ledges, perch.ledgeId)
  if (!ledge) return idle(w)
  var targetY = perch.kind === "hang" ? hangFeetY(w, ledge.y) : ledge.y
  var dx = perch.x - w.x
  if (perch.kind !== "hang" && w.support && w.support.id === ledge.id && Math.abs(dx) < 420 * w.k / 3) {
    walkTo(w, perch.x, perch.facing)
    return
  }
  var rise = w.y - targetY
  if (rise > bodyH(w) * 3 || Math.abs(dx) > 700 * w.k / 3) {
    startPortal(w, { kind: "floor", mini: true, dir: dx >= 0 ? 1 : -1, dest: { x: perch.x, y: targetY, ledge: ledge, hang: perch.kind === "hang", facing: perch.facing } })
    return
  }
  hopTo(w, perch.x, targetY, ledge, perch.kind === "hang", perch.facing)
}

function hopTo(w, x, y, ledge, hang, facing) {
  w.facing = x >= w.x ? 1 : -1
  var arc = w.M.hop(w.x, w.y, x, y, w.k)
  w.support = null
  enter(w, "hop", arc.dur, { arc: arc, ledge: ledge, hang: !!hang, facing: facing || w.facing })
}

function goHang(w, ledge) {
  w.lastHangAt = w.clock
  var hw = halfW(w)
  var x = clamp(w.env.focused ? w.env.focused.x + w.env.focused.w * 0.8 : (ledge.x1 + ledge.x2) / 2, ledge.x1 + hw, ledge.x2 - hw)
  var y = hangFeetY(w, ledge.y)
  if (w.y - y > bodyH(w) * 3) startPortal(w, { kind: "floor", mini: true, dir: x >= w.x ? 1 : -1, dest: { x: x, y: y, ledge: ledge, hang: true } })
  else hopTo(w, x, y, ledge, true)
}

function decide(w) {
  w.lastDecideAt = w.clock
  var r = w.rng()
  if (w.napping) return sleep(w, 9999)
  if (w.stretchAnim) return enter(w, "stretch", 9999)
  if (canFlourish(w) && w.rng() < 0.06 && special(w)) return
  var ws = pol(w).wanderScale
  var perch = w.env.perch
  if (w.mode === "hopper") {
    if (perch && !atPerch(w, perch) && w.clock - w.lastHopAt > 6 && !floats(w)) return goTo(w, perch)
    if (floats(w) && perch && Math.abs(perch.x - w.x) > halfW(w) * 4 && w.clock - w.lastHopAt > 6) {
      w.lastHopAt = w.clock
      return walkTo(w, perch.x, perch.facing)
    }
    if (!w.calm && pol(w).hangs && !floats(w) && w.clock - w.lastHangAt > 300 && r < 0.1) {
      var spot = w.P.hangSpot(w.env.ledges, w.env.focused ? w.env.focused.address : "")
      if (spot) return goHang(w, spot)
    }
    if (w.night && r > 0.9) { setExpr(w, "sleepy", 1.6); setEmote(w, "dots", 1.6); return idle(w, 2) }
    if (r < 0.42 * ws) return wander(w, perch ? perch.x : w.x, 120 * w.k / 3)
    if (r < 0.76) return sit(w)
    if (r < 0.86 && w.night) return sleep(w, 20 + w.rng() * 25)
    return idle(w)
  }
  if (w.mode === "patrol") {
    if (r < 0.5 * ws) return wander(w, w.home ? w.home.x : w.x, 150 * w.k / 3)
    if (r < 0.8) return sit(w)
    return idle(w)
  }
  if (w.mode === "roam") {
    if (r < 0.55 * ws) return wander(w, null, null)
    if (r < 0.8) return sit(w)
    return idle(w)
  }
  if (w.night && r > 0.9) { setExpr(w, "sleepy", 1.6); setEmote(w, "dots", 1.6); return idle(w, 2) }
  if (r < 0.45) return sit(w)
  if (r < 0.55 && w.night) return sleep(w, 20 + w.rng() * 20)
  return idle(w, 4 + w.rng() * 6)
}

// ------------------------------------------------------------- portal

function portalDims(w, kind, mini) {
  var s = mini ? 0.8 : 1
  if (kind === "side") return { w: Math.max(7, Math.round(w.m.w * 0.72 * s)), h: Math.max(12, Math.round(w.m.h * 1.4 * s)) }
  return { w: Math.max(10, Math.round(w.m.w * 1.2 * s)), h: mini ? 5 : 6 }
}

// o: { kind: "side" | "floor", dir, dest: { x, y, ledge, hang, facing }, mini, screen }
function startPortal(w, o) {
  var style = w.calm && w.warp !== "none" ? "fade" : w.warp
  var dest = o.dest || { x: w.x, y: w.y, ledge: w.support }
  if (style === "none") {
    // No animation, but listeners still need the moments a portal reports:
    // the monitor change and the gap where a character swap lands.
    if (o.screen) emit(w, { type: "screen", screen: o.screen })
    emit(w, { type: "gap" })
    arrive(w, dest)
    return
  }
  var kind = o.kind === "side" ? "side" : "floor"
  var dims = portalDims(w, kind, o.mini)
  var dir = o.dir > 0 ? 1 : o.dir < 0 ? -1 : (w.facing || 1)
  w.facing = dir
  var P = {
    style: style, kind: kind, mini: !!o.mini, dir: dir, dest: dest, dims: dims, screen: o.screen || null,
    phase: style === "fade" ? "fade-out" : "open-in", pt: 0, step: 0, swap: !!o.swap,
    from: { x: w.x, y: w.y }, entry: null, exit: null
  }
  var off = halfW(w) + dims.w * w.k * 0.42
  if (kind === "side") {
    P.entry = { x: w.x + dir * off, y: w.y - dims.h * w.k / 2 }
    P.exit = { x: dest.x - dir * off, y: dest.y - dims.h * w.k / 2 }
  } else {
    P.entry = { x: w.x, y: w.y }
    P.exit = { x: dest.x, y: dest.hang && dest.ledge ? dest.ledge.y : dest.y }
  }
  w.portal = P
  w.support = null
  enter(w, "portal", 99)
  if (!o.mini && style === "portal") { setExpr(w, "wide", 0.5); setEmote(w, "bang", 0.6) }
}

// A newer workspace switch while a portal is in flight: retarget instead of queueing.
function refinePortal(w) {
  var P = w.portal
  if (!P || P.mini || P.swap) return
  if (w.mode !== "hopper" || !w.env.perch) return
  var idx = PORTAL_ORDER.indexOf(P.phase)
  if (P.style === "portal" && idx >= PORTAL_ORDER.indexOf("exit")) return
  var perch = w.env.perch
  var ledge = perch.kind === "floor" ? null : w.P.byId(w.env.ledges, perch.ledgeId)
  var y = perch.kind === "hang" && ledge ? hangFeetY(w, ledge.y) : perch.y
  P.dest = { x: perch.x, y: y, ledge: ledge || { id: "floor", kind: "floor", x1: w.env.mon.left, x2: w.env.mon.right, y: w.env.mon.bottom, address: "" }, hang: perch.kind === "hang", facing: perch.facing }
  var off = halfW(w) + P.dims.w * w.k * 0.42
  if (P.kind === "side") P.exit = { x: P.dest.x - P.dir * off, y: P.dest.y - P.dims.h * w.k / 2 }
  else P.exit = { x: P.dest.x, y: P.dest.hang && P.dest.ledge ? P.dest.ledge.y : P.dest.y }
}

function arrive(w, dest) {
  w.portal = null
  w.x = dest.x
  w.y = dest.y
  clampToMonitor(w)
  if (dest.facing) w.facing = dest.facing
  if (dest.hang && dest.ledge) {
    w.support = dest.ledge
    w.y = hangFeetY(w, dest.ledge.y)
    enter(w, "hang", 15 + w.rng() * 30)
  } else if (gravity(w)) {
    w.support = dest.ledge && dest.ledge.kind !== "hang" ? dest.ledge : w.P.supportAt(w.env.ledges, w.x, w.y, halfW(w), 2)
    if (!w.support) { w.vx = 0; w.vy = 0; enter(w, "fall", 99); return }
    w.y = w.support.y
    land(w, false)
  } else {
    land(w, false)
  }
  emit(w, { type: "arrived" })
}

function land(w, hard) {
  enter(w, "land", hard ? 0.28 : 0.16)
  if (w.clock < w.dizzyUntil) { setExpr(w, "dizzy", w.dizzyUntil - w.clock); setEmote(w, "spiral", w.dizzyUntil - w.clock) }
  else if (hard) setExpr(w, "dizzy", 0.9)
}

// Focus settled on another window: glance at it, and in hopper mode head for
// its perch unless busy or it moved very recently.
function focusChanged(w) {
  if (!w.placed || w.hidden) return
  var f = w.env.focused
  if (f) setLook(w, lookToward(w, f.x + f.w / 2, f.y + f.h / 3), 1.2)
  if (w.mode !== "hopper" || !w.env.perch) return
  if (w.st !== "idle" && w.st !== "sit" && w.st !== "walk" && w.st !== "land") return
  if (atPerch(w, w.env.perch)) return
  if (w.clock - w.lastHopAt < 6) return
  if (floats(w)) { w.lastHopAt = w.clock; walkTo(w, w.env.perch.x, w.env.perch.facing); return }
  goTo(w, w.env.perch)
}

function workspaceSwitch(w, dir, kind) {
  if (!w.placed || w.hidden) return
  w.switches.push(w.clock)
  w.switches = w.switches.filter(function (t) { return w.clock - t <= 2 })
  if (w.switches.length >= 4) w.dizzyUntil = w.clock + 1.8
  var perch = w.env.perch
  var mon = w.env.mon
  var dest
  if (w.mode === "hopper" && perch && !floats(w)) {
    var ledge = perch.kind === "floor" ? { id: "floor", kind: "floor", x1: mon.left, x2: mon.right, y: mon.bottom, address: "" } : w.P.byId(w.env.ledges, perch.ledgeId)
    dest = { x: perch.x, y: perch.kind === "hang" && ledge ? hangFeetY(w, ledge.y) : perch.y, ledge: ledge, hang: perch.kind === "hang" && !!ledge, facing: perch.facing }
  } else if (w.mode === "hopper" && perch && floats(w)) {
    dest = { x: perch.x, y: w.y, ledge: null, facing: perch.facing }
  } else {
    dest = { x: w.x, y: w.y, ledge: w.support, facing: w.facing }
  }
  if (w.st === "carried") return
  if (w.st === "portal" && w.portal && !w.portal.mini) {
    var idx = PORTAL_ORDER.indexOf(w.portal.phase)
    if (w.portal.style === "portal" && idx >= 0 && idx < PORTAL_ORDER.indexOf("exit")) {
      // Still going in: just retarget where it comes out. (A swap riding on
      // this portal still lands at the gap; the destination becomes the perch.)
      w.portal.swap = false
      w.portal.dest = dest
      w.portal.dir = dir > 0 ? 1 : dir < 0 ? -1 : w.portal.dir
      refinePortal(w)
      return
    }
    // Already coming out: dive straight back in from where it is now.
  }
  startPortal(w, { kind: kind === "floor" ? "floor" : "side", dir: dir, dest: dest })
}

// The buddy follows focus to another monitor; QML switches the window's screen
// when the portal reaches the gap ("screen" event).
function monitorSwitch(w, dir, screenName) {
  if (!w.placed || w.hidden) return
  startPortal(w, { kind: "side", dir: dir, dest: { x: w.x, y: w.y, ledge: null }, screen: screenName })
}

// Remaps the destination once the window sits on the new monitor.
function portalOnNewScreen(w) {
  var P = w.portal
  if (!P) return
  var mon = w.env.mon
  var perch = w.env.perch
  var x = perch && w.mode === "hopper" ? perch.x : clamp(P.dest.x, mon.left + halfW(w), mon.right - halfW(w))
  var y = perch && w.mode === "hopper" && perch.kind !== "hang" ? perch.y : mon.bottom
  P.dest = { x: x, y: y, ledge: perch && w.mode === "hopper" ? (perch.kind === "floor" ? null : w.P.byId(w.env.ledges, perch.ledgeId)) : null, facing: perch ? perch.facing : w.facing }
  var off = halfW(w) + P.dims.w * w.k * 0.42
  P.exit = P.kind === "side" ? { x: x - P.dir * off, y: y - P.dims.h * w.k / 2 } : { x: x, y: y }
}

function portalTick(w, dt) {
  var P = w.portal
  P.pt += dt
  P.step = Math.floor((w.clock * PORTAL_FPS)) % 1000
  if (P.style === "fade") {
    if (P.phase === "fade-out" && P.pt >= FADE_TIME) {
      emit(w, { type: "gap" })
      if (P.screen) emit(w, { type: "screen", screen: P.screen })
      P.phase = "fade-in"; P.pt = 0
      w.x = P.dest.x; w.y = P.dest.y
    } else if (P.phase === "fade-in" && P.pt >= FADE_TIME) {
      arrive(w, P.dest)
    }
    return
  }
  var times = P.mini ? PORTAL_TIMES.mini : PORTAL_TIMES.full
  var guard = 0
  while (w.portal === P && P.pt >= times[P.phase] && guard++ < 10) {
    P.pt -= times[P.phase]
    var i = PORTAL_ORDER.indexOf(P.phase)
    if (P.phase === "close-in") emit(w, { type: "gap" })
    if (P.phase === "gap" && P.screen) emit(w, { type: "screen", screen: P.screen })
    if (i >= PORTAL_ORDER.length - 1) { arrive(w, P.dest); return }
    P.phase = PORTAL_ORDER[i + 1]
    if (P.phase === "exit") { w.x = P.kind === "side" ? P.exit.x : P.dest.x; w.y = P.kind === "side" ? P.dest.y : P.exit.y }
    // Hold the gap until the next tick, so whoever handles the "gap" event (a
    // character swap) still sees the portal before its exit is sized.
    if (P.phase === "gap") return
  }
  var u = clamp(P.pt / times[P.phase], 0, 1)
  var e = 1 - Math.pow(1 - u, 2)
  if (P.phase === "enter") {
    if (P.kind === "side") { w.x = P.from.x + (P.entry.x - P.from.x) * e }
    else {
      // Hop up a little, then dive into the floor portal.
      var lift = bodyH(w) * 0.5
      w.y = P.from.y - lift * Math.sin(Math.PI * Math.min(1, u * 1.6)) + (u > 0.6 ? (u - 0.6) / 0.4 * bodyH(w) * 1.05 : 0)
    }
  } else if (P.phase === "exit") {
    if (P.kind === "side") { w.x = P.exit.x + (P.dest.x - P.exit.x) * e; w.y = P.dest.y }
    else if (P.dest.hang) {
      // Drops down out of a portal on the window's top edge into a dangle.
      w.y = P.exit.y + (P.dest.y - P.exit.y) * e
      w.x = P.dest.x
    } else {
      var up = bodyH(w) * 1.05
      w.y = P.exit.y + up * (1 - e) - Math.sin(Math.PI * u) * bodyH(w) * 0.35
      w.x = P.dest.x
    }
  }
}

// ------------------------------------------------------------- input

// `now` is wall-clock seconds from the caller: pointer events arrive far more
// often than ticks, so drag velocity can't use the world clock.
function dragStart(w, px, py, now) {
  if (w.st === "portal" && w.portal) { w.portal = null }
  w.support = null
  w.plan = null
  enter(w, "carried", 9999, { dx: w.x - px, dy: w.y - py, lx: px, ly: py, lt: now, vx: 0, vy: 0 })
  setExpr(w, "wide", 0.5)
}

function dragMove(w, px, py, now) {
  if (w.st !== "carried" || !w.plan) return
  var p = w.plan
  var dt = now - p.lt
  if (dt < 0.004) dt = 0.004
  var vx = (px - p.lx) / dt, vy = (py - p.ly) / dt
  p.vx = p.vx * 0.5 + vx * 0.5
  p.vy = p.vy * 0.5 + vy * 0.5
  p.lx = px; p.ly = py; p.lt = now
  w.x = px + p.dx
  w.y = py + p.dy
  var mon = w.env.mon
  if (mon) {
    w.x = clamp(w.x, mon.left - halfW(w) * 4, mon.right + halfW(w) * 4)
    w.y = clamp(w.y, bodyH(w), mon.h + bodyH(w))
  }
}

function dragEnd(w, now) {
  if (w.st !== "carried") return
  var p = w.plan || { vx: 0, vy: 0, lt: now }
  var max = 2200 * w.k / 3
  var vx = clamp(p.vx, -max, max), vy = clamp(p.vy, -max, max)
  // Held still before letting go: a drop, not a throw.
  if (now - p.lt > 0.12) { vx = 0; vy = 0 }
  w.vx = vx; w.vy = vy
  var mon = w.env.mon
  if (mon) {
    w.x = clamp(w.x, mon.left + halfW(w), mon.right - halfW(w))
    w.y = clamp(w.y, mon.top + bodyH(w), mon.bottom)
  }
  emit(w, { type: "dropped", x: w.x, y: w.y })
  if (gravity(w) || (w.m.flies && w.mode === "hopper")) enter(w, "thrown", 99, { fromDrop: true })
  else enter(w, "glide", 99, { fromDrop: true })
}

function pet(w) {
  if (w.st === "carried" || w.st === "portal") return
  setEmote(w, "heart", 1.6)
  setExpr(w, "happy", 1.3)
  if (w.st === "idle" || w.st === "sit" || w.st === "land") setPose(w, "cheer", 0.45)
  if (w.st === "sleep" && !w.napping) idle(w, 2)
}

function hover(w, on) {
  if (on && (w.st === "idle" || w.st === "sit" || w.st === "walk")) setExpr(w, "happy", 0.9)
}

// kind: "notification" | "urgent" | "open"; at: monitor-local point to glance at.
function notify(w, kind, at) {
  if (!w.placed || w.napping || w.st === "portal" || w.st === "carried") return
  if (at) setLook(w, lookToward(w, at.x, at.y), 1.6)
  setEmote(w, kind === "open" ? "sparkle" : "bang", kind === "open" ? 0.9 : 1.3)
  setExpr(w, "wide", 0.6)
  if (w.st === "sleep") idle(w, 2)
}

var REACTIONS = ["pet", "notify", "dizzy", "sleep", "wake", "cheer", "question", "battery", "charging", "flop",
                 "yawn", "sad", "heart", "hang", "hop", "special", "done", "celebrate", "spin"]

// Returns false for names it doesn't know.
function react(w, name) {
  switch (name) {
  case "pet": pet(w); break
  case "notify": notify(w, "notification", null); break
  case "dizzy": w.dizzyUntil = w.clock + 1.8; setExpr(w, "dizzy", 1.8); setEmote(w, "spiral", 1.8); break
  case "sleep": sleep(w, 20); break
  case "wake": idle(w, 2); setEmote(w, "bang", 1); break
  case "cheer": setPose(w, "cheer", 1.2); setEmote(w, "sparkle", 1.2); setExpr(w, "happy", 1.2); break
  case "question": setEmote(w, "question", 1.5); break
  case "battery": setEmote(w, "battery", 2); setExpr(w, "sleepy", 2); break
  case "charging": setEmote(w, "bolt", 1.5); setExpr(w, "happy", 1.5); break
  case "flop": setPose(w, "sleep", 1.2); setExpr(w, "sleepy", 1.5); setEmote(w, "battery", 2); break
  case "yawn": setExpr(w, "sleepy", 1.6); setEmote(w, "dots", 1.6); break
  case "sad": setExpr(w, "sad", 1.6); break
  case "heart": setEmote(w, "heart", 1.5); setExpr(w, "heart", 1.5); break
  case "hang": {
    var spot = w.P.hangSpot(w.env.ledges, w.env.focused ? w.env.focused.address : "")
    if (spot && gravity(w)) goHang(w, spot)
    break
  }
  case "hop":
    if (w.env.perch) { w.lastHopAt = -100; goTo(w, w.env.perch) }
    break
  case "special": special(w); break
  case "done":
    special(w)
    setEmote(w, "heart", 1.6)
    break
  case "celebrate":
    if (!special(w)) { setPose(w, "cheer", 1.2); setExpr(w, "happy", 1.2) }
    setEmote(w, "sparkle", 1.6)
    break
  case "spin": spin(w); break
  default: return false
  }
  return true
}

function userIdle(w, isIdle) {
  if (w.napping === isIdle) return
  w.napping = isIdle
  if (isIdle) {
    if (w.st === "idle" || w.st === "sit" || w.st === "walk" || w.st === "land") sleep(w, 9999)
  } else if (w.st === "sleep") {
    w.emote = null
    idle(w, 1.5)
    setExpr(w, "wide", 0.5)
    setEmote(w, "bang", 1)
  }
}

// Cursor in monitor-local coordinates (null when unknown/off-monitor).
function setCursor(w, x, y) {
  if (!w.cursor || Math.abs(w.cursor.x - x) > 2 || Math.abs(w.cursor.y - y) > 2) w.cursorMovedAt = w.clock
  w.cursor = { x: x, y: y }
}

function setHidden(w, hidden) { w.hidden = !!hidden }

function setStretch(w, anim) {
  w.stretchAnim = anim || null
  w.stretchT = 0
  if (anim) {
    if (w.st === "idle" || w.st === "sit" || w.st === "walk" || w.st === "sleep" || w.st === "land" || w.st === "stretch") {
      w.emote = null
      enter(w, "stretch", 9999)
      setEmote(w, "stretch", 1.2)
    }
  } else if (w.st === "stretch") {
    idle(w, 1.5)
  }
}

// ------------------------------------------------------------- tick

function tick(w, dt) {
  var d = clamp(dt, 0, 0.25)
  w.clock += d
  w.t += d
  if (!w.placed || !w.env.mon) return { fast: false, wait: 0.5 }
  if (w.exprOverride && w.clock >= w.exprOverride.until) w.exprOverride = null
  if (w.poseOverride && w.clock >= w.poseOverride.until) w.poseOverride = null
  if (w.lookOverride && w.clock >= w.lookOverride.until) w.lookOverride = null
  if (w.emote && w.clock >= w.emote.until) w.emote = null
  if (w.st !== "sleep" && w.emote && w.emote.id === "zzz") w.emote = null

  switch (w.st) {
  case "idle": case "sit": case "stretch":
    if (w.st === "stretch") w.stretchT += d
    if (w.st === "stretch" && !w.stretchAnim) { idle(w, 1); break }
    if (w.st !== "stretch" && w.stretchAnim) { enter(w, "stretch", 9999); break }
    if (w.t >= w.dur) decide(w)
    break
  case "sleep":
    if (!w.napping && w.t >= w.dur) { w.emote = null; idle(w, 1.5); setExpr(w, "sleepy", 1) }
    break
  case "land":
    if (w.t >= w.dur) {
      if (w.plan && w.plan.fromDrop) emit(w, { type: "landed", support: w.support, x: w.x, y: w.y })
      if (w.stretchAnim) enter(w, "stretch", 9999)
      else idle(w, 1 + w.rng() * 2)
    }
    break
  case "walk": walkTick(w, d); break
  case "hop": hopTick(w); break
  case "fall": case "thrown": fallTick(w, d); break
  case "glide": glideTick(w, d); break
  case "hang":
    if (w.t >= w.dur || !w.support) { w.support = null; w.vx = 0; w.vy = 0; setExpr(w, "wide", 0.4); enter(w, "fall", 99) }
    break
  case "skid": skidTick(w, d); break
  case "portal": portalTick(w, d); break
  case "special":
    if (w.t >= w.dur) {
      if (w.stretchAnim) enter(w, "stretch", 9999)
      else idle(w, 1 + w.rng() * 2)
    }
    break
  }
  if (w.swapWanted && !w.portal) trySwap(w)

  // Blink while awake and still.
  if ((w.st === "idle" || w.st === "sit" || w.st === "walk" || w.st === "hang" || w.st === "stretch") && w.clock >= w.blinkAt) {
    if (!w.exprOverride) setExpr(w, "blink", 0.14)
    w.blinkAt = w.clock + (2.5 + w.rng() * 4) * pol(w).blinkScale
  }

  advanceFrames(w, d)
  return schedule(w)
}

function walkTick(w, d) {
  var p = w.plan
  if (!p) return idle(w)
  // Movement happens on animation frames (stepped, see advanceFrames).
  if (Math.abs(p.x - w.x) < 1) {
    w.x = p.x
    if (p.then) w.facing = p.then
    if (w.rng() < 0.4) sit(w)
    else idle(w)
  }
}

function stepWalk(w) {
  var p = w.plan
  if (!p) return
  var motion = w.m.motion
  var n = framesOf(w, "walk")
  // Hoppers only travel while airborne (middle of the cycle).
  if (motion === "hop" && n >= 3 && (w.frame % n === 0)) return
  var step = w.k * (motion === "hop" ? 2 : 1) * (w.m.speed || 1) * (motion === "scuttle" ? 1.5 : 1)
  step = Math.max(1, Math.round(step))
  var dir = p.x > w.x ? 1 : -1
  w.facing = motion === "scuttle" ? w.facing : dir
  w.x = Math.abs(p.x - w.x) <= step ? p.x : w.x + dir * step
  if (gravity(w) && w.support) {
    var hw = halfW(w)
    if (w.x < w.support.x1 + hw * 0.3 || w.x > w.support.x2 - hw * 0.3) {
      w.x = clamp(w.x, w.support.x1 + hw * 0.3, w.support.x2 - hw * 0.3)
      p.x = w.x
    }
  }
}

function hopTick(w) {
  var p = w.plan
  var u = clamp(w.t / w.dur, 0, 1)
  var pos = w.M.hopAt(p.arc, u)
  w.x = pos.x
  w.y = pos.y
  w.rising = pos.rising
  if (u >= 1) {
    w.x = p.arc.x1
    w.y = p.arc.y1
    if (p.facing) w.facing = p.facing
    if (p.hang && p.ledge) { w.support = p.ledge; enter(w, "hang", 15 + w.rng() * 30); return }
    w.support = p.ledge && p.ledge.kind !== "hang" ? p.ledge : w.P.supportAt(w.env.ledges, w.x, w.y, halfW(w), 3)
    if (!w.support) { w.vx = 0; w.vy = 0; enter(w, "fall", 99); return }
    w.y = w.support.y
    land(w, false)
  }
}

function fallTick(w, d) {
  var vyPrev = w.vy
  var body = { x: w.x, y: w.y, vx: w.vx, vy: w.vy, k: w.k, floats: floats(w), glides: !!w.m.flies, halfW: halfW(w), bodyH: bodyH(w) }
  var res = w.M.step(body, d, { mon: w.env.mon, ledges: w.env.ledges, landingBelow: w.P.landingBelow })
  w.x = body.x; w.y = body.y; w.vx = body.vx; w.vy = body.vy
  if (Math.abs(w.vx) > 30) w.facing = w.vx > 0 ? 1 : -1
  if (!res.landed) return
  var fromDrop = !!(w.plan && w.plan.fromDrop)
  w.support = res.landed
  if (Math.abs(w.vx) > 40 * w.k / 3) { enter(w, "skid", 99, { fromDrop: fromDrop }); return }
  land(w, vyPrev > 1300 * w.k / 3)
  w.plan = { fromDrop: fromDrop }
}

function skidTick(w, d) {
  var body = { x: w.x, vx: w.vx, k: w.k, halfW: halfW(w) }
  var stopped = w.M.slide(body, d, w.support)
  w.x = body.x; w.vx = body.vx
  if (stopped) {
    var fromDrop = !!(w.plan && w.plan.fromDrop)
    land(w, false)
    w.plan = { fromDrop: fromDrop }
  }
}

function glideTick(w, d) {
  var body = { x: w.x, y: w.y, vx: w.vx, vy: w.vy, k: w.k, halfW: halfW(w), bodyH: bodyH(w) }
  var done = w.M.glide(body, d, w.env.mon)
  w.x = body.x; w.y = body.y; w.vx = body.vx; w.vy = body.vy
  if (done) {
    w.home = { x: w.x, y: w.y }
    var fromDrop = w.plan && w.plan.fromDrop
    enter(w, "land", 0.12, { fromDrop: fromDrop })
  }
}

function advanceFrames(w, d) {
  var pose = poseName(w)
  var fps = poseFps(w, pose)
  if (w.st === "walk") fps = poseFps(w, "walk")
  if (w.st === "portal") fps = fpsOf(w, "walk")
  w.frameT += d
  var period = 1 / Math.max(0.25, fps)
  var guard = 0
  while (w.frameT >= period && guard++ < 8) {
    w.frameT -= period
    w.frame++
    if (w.st === "walk") stepWalk(w)
    if (w.st === "special") stepTravel(w)
  }
}

// Seconds until the next tick could change anything (or fast while moving).
function schedule(w) {
  if (w.st === "hop" || w.st === "fall" || w.st === "thrown" || w.st === "glide" || w.st === "skid") return { fast: true, wait: 0 }
  if (w.st === "portal") return { fast: false, wait: 1 / PORTAL_FPS }
  var waits = []
  var pose = poseName(w)
  var fps = w.st === "walk" ? poseFps(w, "walk") : poseFps(w, pose)
  if (framesOf(w, pose) > 1 || w.st === "walk" || pose === "idle") waits.push(1 / fps - w.frameT)
  if (w.st !== "sleep" && w.st !== "carried") waits.push(w.blinkAt - w.clock)
  if (w.exprOverride) waits.push(w.exprOverride.until - w.clock)
  if (w.poseOverride) waits.push(w.poseOverride.until - w.clock)
  if (w.lookOverride) waits.push(w.lookOverride.until - w.clock)
  if (w.emote && w.emote.until < 9000) waits.push(w.emote.until - w.clock)
  if (w.emote && w.emote.id === "zzz") waits.push(1)
  if (w.st === "stretch") waits.push(0.5)
  if (w.clock < w.spinUntil) waits.push(0.12)
  if (w.dur < 9000) waits.push(w.dur - w.t)
  var wait = 5
  for (var i = 0; i < waits.length; i++) if (waits[i] < wait) wait = waits[i]
  return { fast: false, wait: clamp(wait, 0.03, 5) }
}

// ------------------------------------------------------------- render

function poseName(w) {
  if (w.poseOverride && w.st !== "carried" && w.st !== "portal") return w.poseOverride.pose
  switch (w.st) {
  case "walk": return floats(w) ? "idle" : "walk"
  case "sit": return "sit"
  case "sleep": return "sleep"
  case "hop": return w.rising ? "jump" : "fall"
  case "fall": case "thrown": return floats(w) ? "idle" : "fall"
  case "glide": case "skid": return "idle"
  case "hang": return "hang"
  case "carried": return "carried"
  case "land": return "idle"
  case "special": return "special"
  case "portal": {
    var P = w.portal
    if (!P) return "idle"
    if (P.kind === "floor") return "jump"
    return floats(w) ? "idle" : "walk"
  }
  case "stretch": return w.stretchAnim === "reach" || w.stretchAnim === "rise" ? "cheer" : w.stretchAnim === "walk" ? "walk" : "idle"
  default: return "idle"
  }
}

function stretchOps(w) {
  var t = w.stretchT
  var a = w.stretchAnim
  var ops = {}
  var beat = Math.floor(t) % 2
  switch (a) {
  case "tilt-left": ops.lean = -0.12; break
  case "tilt-right": ops.lean = 0.12; break
  case "lean-left": ops.lean = -0.16; break
  case "lean-right": ops.lean = 0.16; break
  case "twist-left": ops.lean = -0.08; break
  case "twist-right": ops.lean = 0.08; break
  case "bob": ops.squash = beat; break
  case "rise": ops.bob = beat ? -1 : 0; break
  case "wobble": ops.lean = (Math.floor(t * 2) % 2 ? 0.05 : -0.05); break
  case "reach": ops.stretch = 1; break
  case "breathe-in": ops.stretch = Math.min(2, Math.floor(t * 0.75)); break
  case "breathe-hold": ops.stretch = 2; break
  case "breathe-out": ops.stretch = Math.max(0, 2 - Math.floor(t * 0.75)); break
  case "breathe-rest": break
  default: break
  }
  return ops
}

function stretchExtras(w) {
  var a = w.stretchAnim
  var t = w.stretchT
  var r = { expr: null, look: null, prop: null, facing: null }
  if (a === "tilt-left" || a === "tilt-right" || a === "palming" || a === "breathe-hold" || a === "breathe-rest") r.expr = "closed"
  if (a === "breathe-in" || a === "breathe-out") r.expr = "sleepy"
  if (a === "look-left") r.look = [-1, 0]
  if (a === "look-right") r.look = [1, 0]
  if (a === "look-up") r.look = [0, -1]
  if (a === "look-far") r.look = [1, -1]
  if (a === "twist-left") r.facing = -1
  if (a === "twist-right") r.facing = 1
  if (a === "hand" || a === "palming") r.prop = "hand"
  if (a === "hand-flex") r.prop = Math.floor(t) % 2 ? "hand" : null
  if (a === "sip") r.prop = "cup"
  return r
}

function render(w) {
  var ops = {}
  var pose = poseName(w)
  var expr = "open"
  var look = [0, 0]
  var prop = w.st === "sit" ? w.prop : null
  var facing = w.facing
  var portals = []
  var visible = w.placed && !w.hidden

  if (w.st === "sleep") expr = "closed"
  else if (w.st === "fall" || w.st === "thrown") expr = "wide"
  else if (w.st === "carried") expr = Math.floor(w.t * 2) % 4 === 3 ? "happy" : "wide"
  else if (w.st === "hang") expr = Math.floor(w.t / 3) % 3 === 2 ? "happy" : "open"
  else if (w.st === "sit" && w.mood === "focused") expr = "focused"
  else if (w.tired) expr = "sleepy"

  // Gaze: an event glance, else the cursor (while it's been moving lately),
  // else the focused window.
  if (w.cursor && w.clock - w.cursorMovedAt < 5) look = lookToward(w, w.cursor.x, w.cursor.y)
  else if (w.env.focused) look = lookToward(w, w.env.focused.x + w.env.focused.w / 2, w.env.focused.y + w.env.focused.h / 3)
  if (w.lookOverride) look = w.lookOverride.look

  if (w.st === "walk" && w.m.motion === "waddle") ops.lean = w.frame % 2 ? 0.06 : -0.06
  if (w.st === "carried" && w.plan) ops.lean = clamp(-(w.plan.vx || 0) / 4000, -0.2, 0.2)
  if (w.st === "hang") ops.lean = Math.floor(w.t) % 2 ? 0.04 : -0.04
  if (w.st === "land") ops.squash = 1
  // Characters drawn with a single idle frame still breathe.
  if (pose === "idle" && framesOf(w, "idle") === 1 && w.frame % 2 === 1 && (w.st === "idle" || w.st === "stretch")) ops.squash = 1
  if (w.st === "hop" && w.rising && w.t < 0.08) ops.squash = 1
  if (w.st === "idle" && floats(w)) ops.bob = Math.floor(w.clock) % 2 ? -1 : 0
  if (w.st === "walk" && floats(w)) ops.bob = w.frame % 2 ? -1 : 0
  if (w.st === "stretch") {
    ops = stretchOps(w)
    var ex = stretchExtras(w)
    if (ex.expr) expr = ex.expr
    if (ex.look) look = ex.look
    if (ex.facing) facing = ex.facing
    prop = ex.prop
  }

  if (w.st === "portal" && w.portal) {
    var P = w.portal
    var times = P.mini ? PORTAL_TIMES.mini : PORTAL_TIMES.full
    var u = clamp(P.pt / (times[P.phase] || FADE_TIME), 0, 1)
    var dims = P.dims
    var entryOpen = P.phase === "open-in" ? u : P.phase === "enter" ? 1 : P.phase === "close-in" ? 1 - u : 0
    var exitOpen = P.phase === "open-out" ? u : P.phase === "exit" ? 1 : P.phase === "close-out" ? 1 - u : 0
    if (P.style === "portal") {
      if (entryOpen > 0) portals.push({ x: P.entry.x, y: P.kind === "side" ? P.entry.y : P.entry.y, kind: P.kind, w: dims.w, h: dims.h, open: entryOpen, step: P.step, flash: P.phase === "close-in" && u < 0.4 })
      if (exitOpen > 0) portals.push({ x: P.exit.x, y: P.exit.y, kind: P.kind, w: dims.w, h: dims.h, open: exitOpen, step: P.step + 3, flash: P.phase === "open-out" && u > 0.7 })
      var hideBuddy = P.phase === "close-in" || P.phase === "gap" || P.phase === "open-out"
      if (P.phase === "open-in") expr = "wide"
      if (P.phase === "exit" || P.phase === "close-out") expr = "happy"
      if (hideBuddy) visible = false
      if (P.phase === "enter" || P.phase === "exit") {
        var cellLeft = w.x - (w.m.w / 2) * w.k
        var cellTop = w.y - w.m.h * w.k
        if (P.kind === "side") {
          var cx = P.phase === "enter" ? P.entry.x : P.exit.x
          var at = Math.round((cx - cellLeft) / w.k)
          var keepLeft = (P.phase === "enter") === (P.dir > 0)
          ops.clip = { side: keepLeft ? "right" : "left", at: at }
        } else {
          var lineY = P.phase === "enter" ? P.entry.y : P.exit.y
          var fromAbove = P.phase === "exit" && P.dest.hang
          ops.clip = { side: fromAbove ? "top" : "bottom", at: Math.round((lineY - cellTop) / w.k) }
        }
      }
      if (P.phase === "enter" && u > 0.75) ops.flash = (u - 0.75) * 2.4
    } else if (P.style === "fade") {
      ops.ghost = P.phase === "fade-out" ? clamp(P.pt / FADE_TIME, 0, 1) : clamp(1 - P.pt / FADE_TIME, 0, 1)
    }
  }

  if (w.st === "special") look = [0, 0]
  if (w.clock < w.spinUntil) facing = (Math.floor((w.spinUntil - w.clock) / 0.12) % 2 === 0 ? 1 : -1) * (w.facing || 1)
  if (w.exprOverride) expr = w.exprOverride.expr
  if (w.clock < w.dizzyUntil && w.st !== "portal") expr = "dizzy"
  // Gaze is drawn before the flip, so mirror it when facing left.
  var lx = facing < 0 ? -look[0] : look[0]

  var frameCount = framesOf(w, pose)
  var frame = w.frame % Math.max(1, frameCount)
  if (w.st === "hop" || w.st === "fall" || w.st === "thrown") frame = 0

  return {
    visible: visible,
    x: Math.round(w.x), y: Math.round(w.y),
    pose: pose, frame: frame, expr: expr, look: [lx, look[1]], facing: facing,
    prop: prop, accessory: w.night && w.st !== "portal" ? "nightcap" : null,
    ops: ops,
    emote: w.emote && visible ? { id: w.emote.id, age: w.clock - w.emote.start } : null,
    portals: portals,
    state: w.st
  }
}

// What the menu/status shows; categories only, never window titles.
function describe(w) {
  return {
    state: w.st, mode: w.mode, mood: w.mood, x: Math.round(w.x), y: Math.round(w.y),
    facing: w.facing, support: w.support ? { id: w.support.id, kind: w.support.kind } : null,
    napping: w.napping, hidden: w.hidden, night: w.night, tired: w.tired
  }
}

if (typeof module !== "undefined") module.exports = {
  PORTAL_TIMES: PORTAL_TIMES, PORTAL_ORDER: PORTAL_ORDER, PORTAL_FPS: PORTAL_FPS,
  create: create, setMetrics: setMetrics, place: place, setEnv: setEnv, setMode: setMode,
  setMood: setMood, setFlags: setFlags, focusChanged: focusChanged, workspaceSwitch: workspaceSwitch,
  special: special, spin: spin, requestSwap: requestSwap, clearSwap: clearSwap, REACTIONS: REACTIONS, monitorSwitch: monitorSwitch,
  portalOnNewScreen: portalOnNewScreen, dragStart: dragStart, dragMove: dragMove, dragEnd: dragEnd,
  pet: pet, hover: hover, notify: notify, react: react, userIdle: userIdle, setCursor: setCursor,
  setHidden: setHidden, setStretch: setStretch, goTo: goTo, tick: tick, render: render,
  describe: describe, drain: drain, halfW: halfW, bodyH: bodyH, hangFeetY: hangFeetY
}
