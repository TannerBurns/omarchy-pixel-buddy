// Visiting friends: now and then another character portals in beside the
// buddy, they greet each other, each shows off, they cheer, and the friend
// heads home through a portal. Pure: when a visit is due, who comes, where it
// stands and the scene they play. Visit.qml runs it with a second, scripted
// world for the friend (js/World.js create({ scripted: true })).

var FIRST_DELAY_MS = 10 * 60000      // the very first visit comes about 10 minutes in
var MIN_UPTIME_MS = 2 * 60000        // never in the first two minutes after the shell starts
var RETRY_MS = 3 * 60000             // a visit that couldn't start tries again after this
var LEAVE_TIMEOUT_MS = 3000          // a friend on its way out is gone by then, portal or not
var ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

// Stored state: { last (ms of the last visit), jitter (-1..1, how early or
// late the next one comes), recent (the last few visitors) }. A first run
// counts as a visit long enough ago that the first one comes after about ten
// minutes.
function restore(raw, now, everyMinutes) {
  var s = { last: 0, jitter: 0, recent: [] }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.last === "number" && isFinite(raw.last) && raw.last > 0 && raw.last <= now) s.last = raw.last
    if (typeof raw.jitter === "number" && isFinite(raw.jitter)) s.jitter = clamp(raw.jitter, -1, 1)
    if (Array.isArray(raw.recent)) s.recent = raw.recent.filter(function (id) { return typeof id === "string" && ID_RE.test(id) }).slice(-3)
  }
  if (!s.last) s.last = now - Math.max(0, everyMinutes * 60000 - FIRST_DELAY_MS)
  return s
}

// After a visit: when it was, a new jitter, and who came.
function visited(state, now, id, rng) {
  var recent = (state.recent || []).filter(function (r) { return r !== id }).concat([id]).slice(-3)
  return { last: now, jitter: rng() * 2 - 1, recent: recent }
}

// friendEvery minutes after the last visit, give or take a fifth.
function nextAt(state, everyMinutes) {
  return state.last + everyMinutes * 60000 * (1 + 0.2 * clamp(state.jitter || 0, -1, 1))
}

// What keeps a friend from coming over, or ends a visit under way ("" when
// nothing does). ctx: { placed, hidden, covered, screencast, focusing, idle,
// bubble, busy }.
function blocker(ctx) {
  var c = ctx || {}
  if (!c.placed) return "not placed"
  if (c.hidden) return "hidden"
  if (c.covered) return "fullscreen"
  if (c.screencast) return "screencast"
  if (c.focusing) return "focus"
  if (c.idle) return "idle"
  if (c.bubble) return "bubble"
  if (c.busy) return "busy"
  return ""
}

// cfg: { enabled, everyMinutes }. ctx: blocker()'s fields plus uptimeMs and
// retryAt (ms; a visit that couldn't start waits until then).
// Returns { due, reason, inMs }.
function due(state, now, cfg, ctx) {
  if (!cfg.enabled) return { due: false, reason: "off" }
  var c = ctx || {}
  var next = nextAt(state, cfg.everyMinutes)
  if (c.retryAt > next) next = c.retryAt
  if (now < next) return { due: false, reason: "waiting", inMs: next - now }
  if (c.uptimeMs !== undefined && c.uptimeMs < MIN_UPTIME_MS) return { due: false, reason: "starting", inMs: MIN_UPTIME_MS - c.uptimeMs }
  var b = blocker(c)
  if (b) return { due: false, reason: b }
  return { due: true, reason: "due", inMs: 0 }
}

// Anyone but the buddy itself, preferring someone who hasn't visited lately.
function pickFriend(ids, shownId, recent, rng) {
  var all = (ids || []).filter(function (id) { return id !== shownId })
  if (all.length === 0) return null
  var fresh = all.filter(function (id) { return (recent || []).indexOf(id) < 0 })
  var pool = fresh.length > 0 ? fresh : all
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}

// Where the friend stands: beside the host on the same ledge, four art pixels
// apart, on the side with more room, with `room` to spare beyond it for the
// portal it steps out of. host: { x, y, halfW, ledge: { x1, x2 } | null };
// mon: { left, right }. Returns { x, y, side, facing } (facing the host) or
// null when neither side has room.
function spot(host, friendHalfW, mon, k, room) {
  var lo = mon.left, hi = mon.right
  if (host.ledge) { lo = Math.max(lo, host.ledge.x1); hi = Math.min(hi, host.ledge.x2) }
  var dist = host.halfW + friendHalfW + 4 * k
  var need = dist + Math.max(friendHalfW, room || 0)
  var right = hi - host.x, left = host.x - lo
  var sides = right >= left ? [1, -1] : [-1, 1]
  for (var i = 0; i < sides.length; i++) {
    var s = sides[i]
    if ((s > 0 ? right : left) >= need) return { x: host.x + s * dist, y: host.y, side: s, facing: -s }
  }
  return null
}

// The scene, in seconds from the friend's portal opening: it steps out, the
// buddy notices, they greet each other, one shows off and then the other, they
// cheer together, trade hearts, and the friend turns and steps into a portal.
// Steps: { at, who: "host" | "friend" | "both", act, emote } with act one of
// arrive, notice, greet, special, cheer, bye, leave. rng picks the greeting
// and who shows off first.
var GREETINGS = ["heart", "note", "sparkle", "question"]
function timeline(rng) {
  var greet = GREETINGS[Math.min(GREETINGS.length - 1, Math.floor(rng() * GREETINGS.length))]
  var first = rng() < 0.5 ? "host" : "friend"
  var second = first === "host" ? "friend" : "host"
  return [
    { at: 0, who: "friend", act: "arrive" },
    { at: 0.15, who: "host", act: "notice" },
    { at: 1.2, who: "both", act: "greet", emote: greet },
    { at: 2.5, who: first, act: "special" },
    { at: 4.7, who: second, act: "special" },
    { at: 6.9, who: "both", act: "cheer" },
    { at: 8.1, who: "both", act: "bye" },
    { at: 9.0, who: "friend", act: "leave" }
  ]
}

if (typeof module !== "undefined") module.exports = {
  FIRST_DELAY_MS: FIRST_DELAY_MS, MIN_UPTIME_MS: MIN_UPTIME_MS, RETRY_MS: RETRY_MS, LEAVE_TIMEOUT_MS: LEAVE_TIMEOUT_MS,
  GREETINGS: GREETINGS, restore: restore, visited: visited, nextAt: nextAt, blocker: blocker, due: due,
  pickFriend: pickFriend, spot: spot, timeline: timeline
}
