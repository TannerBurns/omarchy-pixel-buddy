// Stats and the wardrobe: what the buddy remembers about your days, for the
// menu's stats line and the accessories you unlock. Active time is counted per
// activity category (coding, browsing and so on: categories only, never window
// titles) for the last seven days. Stretches and focus rounds count per day
// and in total, and the day streak counts the days in a row with at least one
// Done stretch or finished focus round. Milestones unlock accessories to wear.
//
// Pure: the Service keeps the only copy (in its state file) and passes day
// keys ("YYYY-MM-DD" from Roster.dayKey, so days turn at 04:00). Every function
// leaves its inputs alone and returns new objects; one that changes nothing
// hands its input back as it is.
//
// Plain JS (no .pragma, no .import) so node tests can require() it.

var VERSION = 1
var KEEP_DAYS = 7
var DAY_MS = 86400000
var MAX_SECS = 86400                // active seconds per category per day
var MAX_COUNT = 999                 // stretches or focus rounds per day
var MAX_TOTAL = 999999
var MAX_STREAK = 9999
var CATEGORIES = ["coding", "terminal", "ai", "browsing", "reading", "chat", "design", "video", "gaming", "files", "system", "desktop", "other"]
var SLOTS = ["neck", "eyes", "head"]
var MILESTONES = [
  { id: "scarf", name: "Scarf", slot: "neck", kind: "stretches", need: 10, label: "10 stretches" },
  { id: "partyhat", name: "Party hat", slot: "head", kind: "streak", need: 3, label: "a 3-day streak" },
  { id: "sunglasses", name: "Sunglasses", slot: "eyes", kind: "focus", need: 5, label: "5 focus rounds" },
  { id: "crown", name: "Crown", slot: "head", kind: "streak", need: 7, label: "a 7-day streak" }
]
var UNITS = { stretches: "stretches", focus: "focus rounds", streak: "days in a row" }

function create() {
  return {
    v: VERSION, days: {}, total: { s: 0, f: 0 }, streak: { cur: 0, best: 0, last: "" },
    unlocked: [], wear: { neck: "", eyes: "", head: "" }
  }
}

function reset() { return create() }

function milestone(id) {
  for (var i = 0; i < MILESTONES.length; i++) if (MILESTONES[i].id === id) return MILESTONES[i]
  return null
}

function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {} }

// A whole, non-negative number from a stored value, capped; anything else is 0.
function count(v, max) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0 }

// ---------------------------------------------------------------- day keys

function pad(n, width) {
  var s = String(n)
  while (s.length < width) s = "0" + s
  return s
}

function keyOf(ms) {
  var d = new Date(ms)
  return pad(d.getUTCFullYear(), 4) + "-" + pad(d.getUTCMonth() + 1, 2) + "-" + pad(d.getUTCDate(), 2)
}

// Midnight UTC of a day key; NaN unless it names a real date.
function keyMs(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN
  var ms = Date.UTC(parseInt(key.slice(0, 4), 10), parseInt(key.slice(5, 7), 10) - 1, parseInt(key.slice(8, 10), 10))
  return keyOf(ms) === key ? ms : NaN
}

function isDayKey(key) { return isFinite(keyMs(key)) }

// The day key n days after `key` (before it for a negative n); "" for a bad key.
function dayOffset(key, n) {
  var ms = keyMs(key)
  if (!isFinite(ms) || typeof n !== "number" || !isFinite(n)) return ""
  var out = keyOf(ms + Math.round(n) * DAY_MS)
  return isDayKey(out) ? out : ""
}

// ---------------------------------------------------------------- cleaning

// One stored day as { c: { category: secs }, s, f }, or null when it's empty or
// not a day at all. Categories come out in CATEGORIES order.
function cleanDay(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  var c = obj(v.c)
  var d = { c: {}, s: count(v.s, MAX_COUNT), f: count(v.f, MAX_COUNT) }
  var any = d.s > 0 || d.f > 0
  for (var i = 0; i < CATEGORIES.length; i++) {
    var n = count(c[CATEGORIES[i]], MAX_SECS)
    if (n > 0) { d.c[CATEGORIES[i]] = n; any = true }
  }
  return any ? d : null
}

function met(n, m) {
  if (m.kind === "stretches") return n.total.s >= m.need
  if (m.kind === "focus") return n.total.f >= m.need
  return n.streak.best >= m.need
}

// Unlocks every milestone that's been reached; returns the new ones.
function addMet(n) {
  var fresh = []
  for (var i = 0; i < MILESTONES.length; i++) {
    var m = MILESTONES[i]
    if (met(n, m) && n.unlocked.indexOf(m.id) < 0) { n.unlocked.push(m.id); fresh.push(m.id) }
  }
  return fresh
}

// A complete, fresh copy holding only valid values. `withMet` also unlocks
// what has been reached before the worn items are checked.
function clean(raw, withMet) {
  var b = obj(raw)
  var st = create()
  var days = obj(b.days)
  var keys = []
  for (var key in days) if (Object.prototype.hasOwnProperty.call(days, key) && isDayKey(key)) keys.push(key)
  keys.sort()
  var sumS = 0, sumF = 0
  for (var i = 0; i < keys.length; i++) {
    var d = cleanDay(days[keys[i]])
    if (!d) continue
    st.days[keys[i]] = d
    sumS += d.s
    sumF += d.f
  }
  // Totals never fall below what the days show.
  var t = obj(b.total)
  st.total.s = Math.min(MAX_TOTAL, Math.max(count(t.s, MAX_TOTAL), sumS))
  st.total.f = Math.min(MAX_TOTAL, Math.max(count(t.f, MAX_TOTAL), sumF))
  var k = obj(b.streak)
  st.streak.cur = count(k.cur, MAX_STREAK)
  st.streak.best = Math.max(count(k.best, MAX_STREAK), st.streak.cur)
  st.streak.last = isDayKey(k.last) ? k.last : ""
  var u = Array.isArray(b.unlocked) ? b.unlocked : []
  for (var j = 0; j < u.length; j++) if (milestone(u[j]) && st.unlocked.indexOf(u[j]) < 0) st.unlocked.push(u[j])
  if (withMet) addMet(st)
  var w = obj(b.wear)
  for (var s = 0; s < SLOTS.length; s++) {
    var id = w[SLOTS[s]]
    var m = milestone(id)
    st.wear[SLOTS[s]] = m && m.slot === SLOTS[s] && st.unlocked.indexOf(id) >= 0 ? id : ""
  }
  return st
}

// Keeps today and the six days before it (or, without a good today, the seven
// latest days), in date order.
function pruneDays(n, todayKey) {
  var keys = Object.keys(n.days).sort()
  var keep
  if (isDayKey(todayKey)) {
    var lo = dayOffset(todayKey, -(KEEP_DAYS - 1))
    keep = keys.filter(function (k) { return k >= lo && k <= todayKey })
  } else {
    keep = keys.slice(-KEEP_DAYS)
  }
  var days = {}
  for (var i = 0; i < keep.length; i++) days[keep[i]] = n.days[keep[i]]
  n.days = days
}

// Whatever was stored (or nothing) as valid stats, pruned around today, with
// every milestone already reached unlocked. Never throws.
function restore(raw, todayKey) {
  var n = clean(raw, true)
  pruneDays(n, todayKey)
  return n
}

function prune(st, todayKey) {
  var n = clean(st, false)
  pruneDays(n, todayKey)
  return n
}

// ---------------------------------------------------------------- recording

// `secs` of active time in `category` (unknown ones count as "other"). Only a
// whole number of seconds from 1 to 3600 counts.
function addActivity(st, dayKey, category, secs) {
  if (!isDayKey(dayKey) || typeof secs !== "number" || !isFinite(secs) || Math.floor(secs) !== secs || secs < 1 || secs > 3600) return st
  var cat = CATEGORIES.indexOf(category) >= 0 ? category : "other"
  var n = clean(st, false)
  var d = n.days[dayKey] || { c: {}, s: 0, f: 0 }
  var c = {}
  for (var i = 0; i < CATEGORIES.length; i++) {
    var name = CATEGORIES[i]
    var v = (d.c[name] || 0) + (name === cat ? secs : 0)
    if (v > 0) c[name] = Math.min(MAX_SECS, v)
  }
  d.c = c
  n.days[dayKey] = d
  pruneDays(n, dayKey)
  return n
}

// The day streak after something counted on `day`: the same day changes
// nothing, the next day extends it, a gap starts over, and an earlier day (the
// clock went back) leaves it alone.
function bump(k, day) {
  var cur = k.cur, last = k.last
  if (last === day) cur = Math.max(1, cur)
  else if (last !== "" && day < last) return { cur: k.cur, best: k.best, last: k.last }
  else if (last !== "" && dayOffset(last, 1) === day) { cur = cur + 1; last = day }
  else { cur = 1; last = day }
  cur = Math.min(MAX_STREAK, cur)
  return { cur: cur, best: Math.max(k.best, cur), last: last }
}

function record(st, dayKey, field) {
  if (!isDayKey(dayKey)) return { state: st, unlocked: [] }
  var n = clean(st, false)
  var d = n.days[dayKey] || { c: {}, s: 0, f: 0 }
  d[field] = Math.min(MAX_COUNT, d[field] + 1)
  n.days[dayKey] = d
  n.total[field] = Math.min(MAX_TOTAL, n.total[field] + 1)
  n.streak = bump(n.streak, dayKey)
  pruneDays(n, dayKey)
  return { state: n, unlocked: addMet(n) }
}

// A Done stretch / a finished focus round. `unlocked` lists the accessories
// this call unlocked (each one only ever once).
function recordStretch(st, dayKey) { return record(st, dayKey, "s") }
function recordFocus(st, dayKey) { return record(st, dayKey, "f") }

// ---------------------------------------------------------------- reading

// The live streak: it holds while the last counted day is today or yesterday.
function streak(st, todayKey) {
  var k = clean(st, false).streak
  var alive = k.last !== "" && isDayKey(todayKey) && (k.last === todayKey || k.last === dayOffset(todayKey, -1))
  return { cur: alive ? k.cur : 0, best: k.best }
}

// One row per milestone, for the wardrobe: "7/10 stretches", "2/3 days in a
// row" (the live streak), "4/5 focus rounds", or "unlocked".
function progress(st, todayKey) {
  var n = clean(st, false)
  var live = streak(n, todayKey).cur
  return MILESTONES.map(function (m) {
    var value = m.kind === "stretches" ? n.total.s : m.kind === "focus" ? n.total.f : live
    var unlocked = n.unlocked.indexOf(m.id) >= 0
    var have = unlocked ? m.need : Math.min(m.need, value)
    return {
      id: m.id, slot: m.slot, label: m.label, unlocked: unlocked, have: have, need: m.need,
      text: unlocked ? "unlocked" : have + "/" + m.need + " " + UNITS[m.kind]
    }
  })
}

// The categories with the most whole minutes, at most three.
function top(secs) {
  var rows = []
  for (var i = 0; i < CATEGORIES.length; i++) {
    var minutes = Math.floor((secs[CATEGORIES[i]] || 0) / 60)
    if (minutes >= 1) rows.push({ category: CATEGORIES[i], minutes: minutes, order: i })
  }
  rows.sort(function (a, b) { return b.minutes - a.minutes || a.order - b.order })
  return rows.slice(0, 3).map(function (r) { return { category: r.category, minutes: r.minutes } })
}

function summary(st, todayKey) {
  var n = clean(st, false)
  var valid = isDayKey(todayKey)
  var lo = valid ? dayOffset(todayKey, -(KEEP_DAYS - 1)) : ""
  var today = { stretches: 0, focus: 0, activeMinutes: 0, top: [] }
  var week = { stretches: 0, focus: 0, activeMinutes: 0, days: 0, top: [] }
  var weekSecs = {}, weekTotal = 0
  for (var key in n.days) {
    if (valid && (key < lo || key > todayKey)) continue
    var d = n.days[key]
    var daySecs = 0
    for (var cat in d.c) {
      daySecs += d.c[cat]
      weekSecs[cat] = (weekSecs[cat] || 0) + d.c[cat]
    }
    weekTotal += daySecs
    week.stretches += d.s
    week.focus += d.f
    week.days++
    if (valid && key === todayKey) {
      today.stretches = d.s
      today.focus = d.f
      today.activeMinutes = Math.floor(daySecs / 60)
      today.top = top(d.c)
    }
  }
  week.activeMinutes = Math.floor(weekTotal / 60)
  week.top = top(weekSecs)
  return {
    today: today,
    week: week,
    total: { stretches: n.total.s, focus: n.total.f },
    streak: streak(n, todayKey),
    unlocked: n.unlocked.slice(),
    wear: { neck: n.wear.neck, eyes: n.wear.eyes, head: n.wear.head },
    progress: progress(n, todayKey)
  }
}

// ---------------------------------------------------------------- wardrobe

function canWear(st, id) { return clean(st, false).unlocked.indexOf(id) >= 0 }

// Takes off an accessory (by id), a whole slot (by slot name), or "none" for
// everything.
function takeOff(st, id) {
  var n = clean(st, false)
  var changed = false
  for (var i = 0; i < SLOTS.length; i++) {
    var slot = SLOTS[i]
    if (n.wear[slot] !== "" && (id === "none" || id === slot || n.wear[slot] === id)) { n.wear[slot] = ""; changed = true }
  }
  return changed ? n : st
}

// Puts on an unlocked accessory, in place of whatever is in its slot; "none"
// takes everything off.
function wear(st, id) {
  if (id === "none") return { ok: true, state: takeOff(st, "none"), error: "" }
  var m = milestone(id)
  if (!m) return { ok: false, state: st, error: "unknown accessory '" + String(id) + "'" }
  var n = clean(st, false)
  if (n.unlocked.indexOf(m.id) < 0) return { ok: false, state: st, error: "'" + m.id + "' is still locked (it takes " + m.label + ")" }
  n.wear[m.slot] = m.id
  return { ok: true, state: n, error: "" }
}

// What it's wearing, in paint order (neck, eyes, head).
function worn(st) {
  var n = clean(st, false)
  var out = []
  for (var i = 0; i < SLOTS.length; i++) if (n.wear[SLOTS[i]]) out.push(n.wear[SLOTS[i]])
  return out
}

if (typeof module !== "undefined") module.exports = {
  VERSION: VERSION, KEEP_DAYS: KEEP_DAYS, CATEGORIES: CATEGORIES, SLOTS: SLOTS, MILESTONES: MILESTONES,
  create: create, reset: reset, restore: restore, prune: prune, milestone: milestone,
  isDayKey: isDayKey, dayOffset: dayOffset,
  addActivity: addActivity, recordStretch: recordStretch, recordFocus: recordFocus,
  streak: streak, progress: progress, summary: summary,
  canWear: canWear, wear: wear, takeOff: takeOff, worn: worn
}
