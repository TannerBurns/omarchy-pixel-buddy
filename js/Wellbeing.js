// Wellbeing nudges: a library of gentle stretches, a session timer that counts
// active time (idle gaps of 5+ minutes count as a break), and the picker that
// keeps nudges varied and suited to what Tanner has been doing.
//
// Each step names an `anim` the buddy performs while the step runs.

var STRETCHES = [
  { id: "neck-tilt", category: "neck", title: "Neck tilt", steps: [
    { text: "Ease your right ear toward your right shoulder. Breathe.", s: 15, anim: "tilt-right" },
    { text: "Now the left side.", s: 15, anim: "tilt-left" }] },
  { id: "chin-tucks", category: "neck", title: "Chin tucks", steps: [
    { text: "Sit tall and glide your chin straight back. Hold for 3 seconds, then release. Repeat 8 times.", s: 30, anim: "bob" }] },
  { id: "look-shoulders", category: "neck", title: "Look over your shoulders", steps: [
    { text: "Slowly turn to look over your right shoulder. Hold for a few seconds.", s: 8, anim: "look-right" },
    { text: "Now over your left shoulder. Repeat a few times each way.", s: 12, anim: "look-left" }] },
  { id: "shoulder-rolls", category: "shoulders", title: "Shoulder rolls", steps: [
    { text: "Roll your shoulders up, back and down, slowly. 10 times.", s: 15, anim: "bob" },
    { text: "Now roll them forward 10 times.", s: 15, anim: "bob" }] },
  { id: "overhead-reach", category: "shoulders", title: "Overhead reach", steps: [
    { text: "Lace your fingers, turn your palms up and reach for the ceiling. Hold and breathe.", s: 15, anim: "reach" }] },
  { id: "chest-opener", category: "shoulders", title: "Chest opener", steps: [
    { text: "Clasp your hands behind your back, draw your shoulder blades together and lift your chest. Hold.", s: 15, anim: "breathe-in" }] },
  { id: "cross-body", category: "shoulders", title: "Cross-body shoulder stretch", steps: [
    { text: "Pull your right arm across your chest with your left hand. Hold.", s: 15, anim: "lean-left" },
    { text: "Switch arms.", s: 15, anim: "lean-right" }] },
  { id: "wrist-flexor", category: "wrists", title: "Wrist flexor stretch", steps: [
    { text: "Arm out, palm up. Gently pull your fingers back with the other hand.", s: 15, anim: "hand" },
    { text: "Other hand.", s: 15, anim: "hand" }] },
  { id: "wrist-extensor", category: "wrists", title: "Wrist extensor stretch", steps: [
    { text: "Arm out, palm down. Gently press the back of your hand toward you.", s: 15, anim: "hand" },
    { text: "Other hand.", s: 15, anim: "hand" }] },
  { id: "fist-spread", category: "wrists", title: "Fist and spread", steps: [
    { text: "Make a gentle fist, then spread your fingers wide. 10 times.", s: 20, anim: "hand-flex" }] },
  { id: "prayer", category: "wrists", title: "Prayer stretch", steps: [
    { text: "Press your palms together in front of your chest, then slowly lower them until you feel a stretch. Hold.", s: 20, anim: "hand" }] },
  { id: "seated-twist", category: "back", title: "Seated twist", steps: [
    { text: "Sit tall, hold the back of your chair and gently twist to the right. Hold.", s: 12, anim: "twist-right" },
    { text: "Now twist to the left.", s: 12, anim: "twist-left" }] },
  { id: "side-bend", category: "back", title: "Side bend", steps: [
    { text: "Reach your right arm overhead and lean to the left.", s: 10, anim: "lean-left" },
    { text: "Switch sides.", s: 10, anim: "lean-right" }] },
  { id: "cat-cow", category: "back", title: "Seated cat-cow", steps: [
    { text: "Hands on your knees. Arch your back and look up as you breathe in.", s: 5, anim: "look-up" },
    { text: "Round your back and tuck your chin as you breathe out. Repeat 5 times.", s: 20, anim: "bob" }] },
  { id: "twenty-twenty", category: "eyes", title: "20-20-20 eye break", steps: [
    { text: "Look at something about 20 feet (6 m) away for 20 seconds. Blink slowly.", s: 20, anim: "look-far" }] },
  { id: "palming", category: "eyes", title: "Palming", steps: [
    { text: "Rub your palms warm, then cup them over your closed eyes. Breathe slowly.", s: 20, anim: "palming" }] },
  { id: "stand-walk", category: "legs", title: "Stand up and walk", steps: [
    { text: "Stand up and walk around for a couple of minutes. Grab some water while you're up.", s: 60, anim: "walk" }] },
  { id: "calf-raises", category: "legs", title: "Calf raises", steps: [
    { text: "Stand and slowly rise onto your toes, then lower down. 15 times.", s: 30, anim: "rise" }] },
  { id: "standing-quad", category: "legs", title: "Standing quad stretch", steps: [
    { text: "Stand, hold your chair for balance and bring one heel toward your seat. Hold.", s: 15, anim: "wobble" },
    { text: "Other leg.", s: 15, anim: "wobble" }] },
  { id: "box-breathing", category: "breathing", title: "Box breathing", steps: (function () {
    var out = []
    for (var i = 0; i < 4; i++) {
      out.push({ text: "Breathe in…", s: 4, anim: "breathe-in" })
      out.push({ text: "Hold…", s: 4, anim: "breathe-hold" })
      out.push({ text: "Breathe out…", s: 4, anim: "breathe-out" })
      out.push({ text: "Hold…", s: 4, anim: "breathe-rest" })
    }
    return out
  })() },
  { id: "physiological-sigh", category: "breathing", title: "Physiological sigh", steps: [
    { text: "Two quick breaths in through your nose…", s: 3, anim: "breathe-in" },
    { text: "…then one long breath out through your mouth. Repeat 3 times.", s: 12, anim: "breathe-out" }] },
  { id: "water", category: "water", title: "Water break", steps: [
    { text: "Have a few sips of water.", s: 10, anim: "sip" }] }
]

var CATEGORIES = ["neck", "shoulders", "wrists", "back", "eyes", "legs", "breathing", "water"]
var BREAK_GAP_MS = 5 * 60000
var SNOOZE_MS = 10 * 60000

function byId(id) {
  for (var i = 0; i < STRETCHES.length; i++) if (STRETCHES[i].id === id) return STRETCHES[i]
  return null
}

function totalSeconds(stretch) {
  var t = 0
  for (var i = 0; i < stretch.steps.length; i++) t += stretch.steps[i].s
  return t
}

function newSession(now) {
  return {
    activeMs: 0, lastTick: now, snoozeUntil: 0, history: [], lastCategory: "",
    doneDay: "", doneToday: 0, streak: 0, lastBedtimeNudge: ""
  }
}

// Restores a stored session, dropping anything malformed.
function restore(stored, now) {
  var s = newSession(now)
  if (!stored || typeof stored !== "object") return s
  if (stored.activeMs >= 0 && stored.activeMs < 24 * 3600000) s.activeMs = stored.activeMs
  if (stored.lastTick > 0) s.lastTick = stored.lastTick
  if (stored.snoozeUntil > 0) s.snoozeUntil = stored.snoozeUntil
  if (Array.isArray(stored.history)) s.history = stored.history.filter(function (id) { return !!byId(id) }).slice(-STRETCHES.length)
  if (CATEGORIES.indexOf(stored.lastCategory) >= 0) s.lastCategory = stored.lastCategory
  if (typeof stored.doneDay === "string") s.doneDay = stored.doneDay
  if (stored.doneToday >= 0) s.doneToday = stored.doneToday | 0
  if (stored.streak >= 0) s.streak = stored.streak | 0
  if (typeof stored.lastBedtimeNudge === "string") s.lastBedtimeNudge = stored.lastBedtimeNudge
  // A shell restart after a long gap (or a suspend) counts as a break.
  tick(s, now, false)
  return s
}

// Advances the session clock. A gap longer than BREAK_GAP_MS between ticks
// (suspend, shell down) resets the active time like a real break would.
function tick(s, now, userActive) {
  var gap = now - s.lastTick
  if (gap > BREAK_GAP_MS || gap < 0) s.activeMs = 0
  else if (userActive) s.activeMs += Math.min(gap, 60000)
  s.lastTick = now
  return s
}

function breakTaken(s) { s.activeMs = 0; return s }

// cfg: { enabled, breakMinutes }  ctx: { fullscreen, dnd, screencast, hidden }
function status(s, now, cfg, ctx) {
  if (!cfg.enabled) return { due: false, reason: "off" }
  var remaining = cfg.breakMinutes * 60000 - s.activeMs
  if (remaining > 0) return { due: false, reason: "active", remainingMs: remaining }
  if (now < s.snoozeUntil) return { due: false, reason: "snoozed", remainingMs: s.snoozeUntil - now }
  var c = ctx || {}
  if (c.hidden) return { due: false, reason: "hidden" }
  if (c.fullscreen) return { due: false, reason: "fullscreen" }
  if (c.dnd) return { due: false, reason: "dnd" }
  if (c.screencast) return { due: false, reason: "screencast" }
  return { due: true, reason: "due", remainingMs: 0 }
}

// Category weights for what Tanner has mostly been doing.
function weights(ctx) {
  var w = {}
  for (var i = 0; i < CATEGORIES.length; i++) w[CATEGORIES[i]] = 1
  var mood = ctx && ctx.mood
  if (mood === "focused") { w.wrists = 3; w.eyes = 2; w.neck = 2; w.shoulders = 1.5 }
  else if (mood === "reading" || mood === "chill") { w.eyes = 3; w.neck = 2 }
  else if (mood === "creative") { w.wrists = 2; w.shoulders = 2 }
  if (ctx && ctx.sessionMs > 90 * 60000) { w.legs *= 3; w.water *= 2 }
  if (ctx && ctx.night) { w.breathing *= 2; w.eyes *= 1.5; w.legs *= 0.5 }
  return w
}

// Weighted pick from the allowed categories. Never the same category twice in
// a row (unless it's the only one allowed) and no stretch repeats until the
// rotation through the allowed stretches is used up.
function pick(s, allowed, ctx, rng) {
  var r = rng || Math.random
  var cats = allowed && allowed.length ? allowed : CATEGORIES
  var pool = STRETCHES.filter(function (st) { return cats.indexOf(st.category) >= 0 })
  if (pool.length === 0) pool = STRETCHES.slice()
  var fresh = pool.filter(function (st) { return s.history.indexOf(st.id) < 0 })
  if (fresh.length === 0) {
    // Rotation used up: start a new one, but keep the last pick out.
    var last = s.history[s.history.length - 1]
    s.history = []
    fresh = pool.filter(function (st) { return st.id !== last || pool.length === 1 })
  }
  var varied = fresh.filter(function (st) { return st.category !== s.lastCategory })
  var candidates = varied.length > 0 ? varied : fresh
  var w = weights(ctx)
  var total = 0
  for (var i = 0; i < candidates.length; i++) total += w[candidates[i].category]
  var x = r() * total
  for (var j = 0; j < candidates.length; j++) {
    x -= w[candidates[j].category]
    if (x < 0) return candidates[j]
  }
  return candidates[candidates.length - 1]
}

// outcome: "done" | "later" | "skip" | "expired". dayKey: Roster.dayKey(now).
function finish(s, now, stretch, outcome, dayKey) {
  if (outcome === "later") { s.snoozeUntil = now + SNOOZE_MS; return s }
  s.activeMs = 0
  s.snoozeUntil = 0
  if (stretch) {
    s.lastCategory = stretch.category
    s.history.push(stretch.id)
    if (s.history.length > STRETCHES.length) s.history = s.history.slice(-STRETCHES.length)
  }
  if (outcome === "done") {
    if (s.doneDay !== dayKey) { s.doneDay = dayKey; s.doneToday = 0 }
    s.doneToday++
    s.streak++
  } else if (outcome === "skip") {
    s.streak = 0
  }
  // "expired" (the bubble timed out unanswered) resets the timer, nothing else.
  return s
}

// "HH:MM" → minutes after midnight, or -1 when off.
function bedtimeMinutes(bedtime) {
  var m = String(bedtime || "").match(/^(\d{1,2}):(\d{2})$/)
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1
}

// Late: past bedtime, until 04:00 the next morning.
function isNight(date, bedtime) {
  var b = bedtimeMinutes(bedtime)
  if (b < 0) return false
  var mins = date.getHours() * 60 + date.getMinutes()
  if (b >= 4 * 60) return mins >= b || mins < 4 * 60
  return mins >= b && mins < 4 * 60
}

function bedtimeNudgeDue(s, date, bedtime, dayKey) {
  return isNight(date, bedtime) && s.lastBedtimeNudge !== dayKey
}

if (typeof module !== "undefined") module.exports = {
  STRETCHES: STRETCHES, CATEGORIES: CATEGORIES, BREAK_GAP_MS: BREAK_GAP_MS, SNOOZE_MS: SNOOZE_MS,
  byId: byId, totalSeconds: totalSeconds, newSession: newSession, restore: restore, tick: tick,
  breakTaken: breakTaken, status: status, weights: weights, pick: pick, finish: finish,
  bedtimeMinutes: bedtimeMinutes, isNight: isNight, bedtimeNudgeDue: bedtimeNudgeDue
}
