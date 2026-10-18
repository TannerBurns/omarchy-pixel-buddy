// "Surprise me daily": a different character each day. Days start at 04:00
// local time (so a late night doesn't swap buddies at midnight). Picks walk a
// seeded shuffle of the roster, so no character repeats until every one has
// had a day, and the first of a new cycle never repeats the last of the old.

var DAY_MS = 86400000
var BOUNDARY_HOUR = 4

// Local day number, shifted so the day changes at `boundaryHour`.
function dayIndex(date, boundaryHour) {
  var b = boundaryHour === undefined ? BOUNDARY_HOUR : boundaryHour
  var local = date.getTime() - date.getTimezoneOffset() * 60000 - b * 3600000
  return Math.floor(local / DAY_MS)
}

function dayKey(date, boundaryHour) {
  var b = boundaryHour === undefined ? BOUNDARY_HOUR : boundaryHour
  var d = new Date(date.getTime() - b * 3600000)
  var m = d.getMonth() + 1, day = d.getDate()
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day
}

function mulberry32(seed) {
  var a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    var t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function permutation(n, seed) {
  var rng = mulberry32(seed)
  var p = []
  for (var i = 0; i < n; i++) p.push(i)
  for (var j = n - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1))
    var t = p[j]; p[j] = p[k]; p[k] = t
  }
  return p
}

// The roster order for one cycle. Adjusted so a cycle never starts with the
// character that ended the previous one.
function cycleOrder(n, cycle) {
  var p = permutation(n, (cycle * 2654435761) >>> 0)
  if (n > 1 && cycle > 0) {
    var prev = permutation(n, ((cycle - 1) * 2654435761) >>> 0)
    if (p[0] === prev[n - 1]) { var t = p[0]; p[0] = p[1]; p[1] = t }
  }
  return p
}

// ids: the roster (sorted for determinism). Returns the id for that day.
function pick(ids, day) {
  var list = ids.slice().sort()
  var n = list.length
  if (n === 0) return null
  if (n === 1) return list[0]
  var cycle = Math.floor(day / n)
  var pos = ((day % n) + n) % n
  return list[cycleOrder(n, cycle)[pos]]
}

// Today's character, honoring a stored { date, id } so a roster change mid-day
// (adding a custom character) never swaps the buddy until tomorrow.
function today(ids, date, stored) {
  var key = dayKey(date)
  if (stored && stored.date === key && ids.indexOf(stored.id) >= 0) return { date: key, id: stored.id, changed: false }
  var id = pick(ids, dayIndex(date))
  if (stored && stored.id === id && ids.length > 1) {
    var list = ids.slice().sort()
    id = list[(list.indexOf(id) + 1) % list.length]
  }
  return { date: key, id: id, changed: !stored || stored.id !== id }
}

if (typeof module !== "undefined") module.exports = {
  DAY_MS: DAY_MS, BOUNDARY_HOUR: BOUNDARY_HOUR,
  dayIndex: dayIndex, dayKey: dayKey, mulberry32: mulberry32, permutation: permutation,
  cycleOrder: cycleOrder, pick: pick, today: today
}
