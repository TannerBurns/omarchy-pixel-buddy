// Stats: activity minutes per category, stretches and focus rounds, the day
// streak, the milestones that unlock accessories, and the wardrobe.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js } = require("./helpers.cjs")

const S = js("Stats")
const R = js("Roster")

const TODAY = "2026-10-19"
const day = n => S.dayOffset(TODAY, n)

// Records `n` stretches (or focus rounds) on one day.
function times(st, n, fn, key) {
  for (let i = 0; i < n; i++) st = fn(st, key).state
  return st
}

function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze)
    Object.freeze(o)
  }
  return o
}

function fullState() {
  const c = {}
  for (const cat of S.CATEGORIES) c[cat] = 86400
  const days = {}
  for (let i = 0; i < 7; i++) days[day(-i)] = { c: Object.assign({}, c), s: 999, f: 999 }
  return {
    v: 1, days, total: { s: 999999, f: 999999 }, streak: { cur: 9999, best: 9999, last: TODAY },
    unlocked: S.MILESTONES.map(m => m.id), wear: { neck: "scarf", eyes: "sunglasses", head: "crown" }
  }
}

test("stats: a fresh state, and reset", () => {
  assert.deepEqual(S.create(), {
    v: 1, days: {}, total: { s: 0, f: 0 }, streak: { cur: 0, best: 0, last: "" },
    unlocked: [], wear: { neck: "", eyes: "", head: "" }
  })
  assert.deepEqual(S.reset(), S.create())
  assert.deepEqual(S.MILESTONES.map(m => [m.id, m.slot, m.kind, m.need]),
    [["scarf", "neck", "stretches", 10], ["partyhat", "head", "streak", 3], ["sunglasses", "eyes", "focus", 5], ["crown", "head", "streak", 7]])
  assert.deepEqual(S.SLOTS, ["neck", "eyes", "head"])
  assert.equal(S.CATEGORIES.length, 13)
})

test("stats: day keys and offsets cross months, years and leap days", () => {
  assert.equal(S.dayOffset("2026-10-31", 1), "2026-11-01")
  assert.equal(S.dayOffset("2026-12-31", 1), "2027-01-01")
  assert.equal(S.dayOffset("2027-01-01", -1), "2026-12-31")
  assert.equal(S.dayOffset("2028-02-28", 1), "2028-02-29")
  assert.equal(S.dayOffset("2026-10-19", -6), "2026-10-13")
  assert.equal(S.dayOffset("2026-10-19", 0), "2026-10-19")
  assert.equal(S.dayOffset("2026-02-30", 1), "")
  assert.equal(S.dayOffset("yesterday", 1), "")
  assert.equal(S.dayOffset(TODAY, NaN), "")
  assert.equal(S.isDayKey("2026-10-19"), true)
  for (const bad of ["2026-13-01", "2026-02-29", "2026-1-01", "20261019", "", null, 20261019]) assert.equal(S.isDayKey(bad), false, String(bad))
})

test("stats: days turn at 04:00 (03:59 counts toward the day before)", () => {
  const before = R.dayKey(new Date(2026, 9, 19, 3, 59))
  const after = R.dayKey(new Date(2026, 9, 19, 4, 0))
  assert.equal(before, "2026-10-18")
  assert.equal(after, "2026-10-19")
  let st = S.addActivity(S.create(), before, "coding", 60)
  st = S.recordStretch(st, before).state
  st = S.addActivity(st, after, "coding", 120)
  const late = S.summary(st, before).today
  assert.deepEqual([late.activeMinutes, late.stretches], [1, 1])
  const morning = S.summary(st, after)
  assert.deepEqual([morning.today.activeMinutes, morning.today.stretches], [2, 0])
  assert.deepEqual([morning.week.activeMinutes, morning.week.stretches, morning.week.days], [3, 1, 2])
  // The stretch late at night and nothing the next morning: still one day.
  assert.deepEqual(S.streak(st, after), { cur: 1, best: 1 })
})

test("stats: activity adds up per category, capped, unknown categories count as other", () => {
  let st = S.create()
  for (let i = 0; i < 4; i++) st = S.addActivity(st, TODAY, "coding", 30)
  st = S.addActivity(st, TODAY, "hacking", 90)
  st = S.addActivity(st, TODAY, null, 30)
  assert.deepEqual(st.days[TODAY], { c: { coding: 120, other: 120 }, s: 0, f: 0 })
  for (let i = 0; i < 30; i++) st = S.addActivity(st, TODAY, "ai", 3600)
  assert.equal(st.days[TODAY].c.ai, 86400, "capped at a day's worth")
  // Categories stay in a fixed order, whatever order they came in.
  assert.deepEqual(Object.keys(st.days[TODAY].c), ["coding", "ai", "other"])
})

test("stats: only 1-3600 whole seconds on a real day count; anything else hands the input back", () => {
  const st = S.addActivity(S.create(), TODAY, "coding", 30)
  for (const secs of [0, -5, 1.5, 3601, "30", NaN, Infinity, null, undefined]) {
    assert.equal(S.addActivity(st, TODAY, "coding", secs), st, "secs " + String(secs))
  }
  for (const key of ["", "today", "2026-02-30", undefined]) assert.equal(S.addActivity(st, key, "coding", 30), st, "day " + String(key))
  assert.notEqual(S.addActivity(st, TODAY, "coding", 1), st)
  assert.equal(S.addActivity(st, TODAY, "coding", 3600).days[TODAY].c.coding, 3630)
})

test("stats: pruning keeps today and the six days before it", () => {
  const days = {}
  for (let i = -19; i <= 3; i++) days[day(i)] = { c: { coding: 600 }, s: 1, f: 0 }
  const raw = { days }
  const st = S.prune(raw, TODAY)
  assert.deepEqual(Object.keys(st.days), ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"])
  // Across a month boundary.
  assert.deepEqual(Object.keys(S.prune(raw, "2026-10-02").days), ["2026-09-30", "2026-10-01", "2026-10-02"])
  // Without a usable today: the seven latest days.
  assert.deepEqual(Object.keys(S.prune(raw, "").days), [day(-3), day(-2), day(-1), day(0), day(1), day(2), day(3)])
  // Recording prunes too.
  assert.deepEqual(Object.keys(S.addActivity(st, day(7), "coding", 30).days), [day(7)])
  assert.deepEqual(Object.keys(S.recordStretch(st, day(2)).state.days), [day(-4), day(-3), day(-2), day(-1), day(0), day(2)])
})

test("stats: the day streak counts days in a row with a stretch or a focus round", () => {
  let st = S.recordStretch(S.create(), day(0)).state
  assert.deepEqual(st.streak, { cur: 1, best: 1, last: day(0) })
  st = S.recordFocus(st, day(0)).state
  assert.deepEqual(st.streak, { cur: 1, best: 1, last: day(0) }, "the same day changes nothing")
  st = S.recordFocus(st, day(1)).state
  st = S.recordStretch(st, day(2)).state
  assert.deepEqual(st.streak, { cur: 3, best: 3, last: day(2) })
  // Activity alone doesn't count toward the streak.
  st = S.addActivity(st, day(3), "coding", 600)
  assert.deepEqual(S.streak(st, day(3)), { cur: 3, best: 3 }, "alive through the next day")
  assert.deepEqual(S.streak(st, day(4)), { cur: 0, best: 3 }, "a day without a stretch or a round ends it")
  st = S.recordStretch(st, day(5)).state
  assert.deepEqual(st.streak, { cur: 1, best: 3, last: day(5) }, "a gap starts over")
  // The clock went back a day: the streak stays as it was.
  st = S.recordStretch(st, day(4)).state
  assert.deepEqual(st.streak, { cur: 1, best: 3, last: day(5) })
  st = S.recordStretch(st, day(6)).state
  assert.deepEqual(S.streak(st, day(6)), { cur: 2, best: 3 })
  assert.deepEqual(S.streak(st, "not a day"), { cur: 0, best: 3 })
})

test("stats: each milestone unlocks exactly once, when it's reached", () => {
  // Scarf: the 10th stretch.
  let st = S.create()
  for (let i = 1; i <= 11; i++) {
    const r = S.recordStretch(st, TODAY)
    assert.deepEqual(r.unlocked, i === 10 ? ["scarf"] : [], "stretch " + i)
    st = r.state
  }
  assert.deepEqual(st.unlocked, ["scarf"])

  // Sunglasses: the 5th focus round.
  st = S.create()
  for (let i = 1; i <= 6; i++) {
    const r = S.recordFocus(st, TODAY)
    assert.deepEqual(r.unlocked, i === 5 ? ["sunglasses"] : [], "round " + i)
    st = r.state
  }

  // Party hat at a 3-day streak, the crown at 7; once each.
  st = S.create()
  const got = []
  for (let d = 0; d < 9; d++) {
    for (let k = 0; k < 3; k++) {
      const r = S.recordFocus(st, day(d))
      if (r.unlocked.length) got.push([d, ...r.unlocked])
      st = r.state
    }
  }
  assert.deepEqual(got, [[1, "sunglasses"], [2, "partyhat"], [6, "crown"]])

  // A streak that ends keeps what it unlocked.
  st = S.recordFocus(st, day(20)).state
  assert.equal(st.streak.cur, 1)
  assert.deepEqual(st.unlocked, ["sunglasses", "partyhat", "crown"])

  // Two at once come in milestone order.
  st = times(S.create(), 8, S.recordStretch, day(0))
  st = S.recordStretch(st, day(1)).state
  const both = S.recordStretch(st, day(2))
  assert.deepEqual(both.unlocked, ["scarf", "partyhat"])
})

test("stats: restore sanitizes whatever was stored", () => {
  for (const junk of [null, undefined, "x", 42, [], true, { days: "x", total: [], streak: 5, unlocked: "crown", wear: [] }]) {
    assert.deepEqual(S.restore(junk, TODAY), S.create(), JSON.stringify(junk))
  }
  // As it would come out of a hand-edited state file.
  const raw = JSON.parse(`{
    "v": 9,
    "junk": { "big": "${"x".repeat(200)}" },
    "days": {
      "nope": { "s": 5 },
      "__proto__": { "s": 5 },
      "2026-13-40": { "s": 5 },
      "2026-02-30": { "s": 5 },
      "2026-10-18": "x",
      "2026-10-17": { "c": {}, "s": 0, "f": 0 },
      "2026-10-19": { "c": { "coding": -5, "ai": 1e9, "reading": "100", "hacking": 100, "video": 90.7, "__proto__": 5 }, "s": -1, "f": 5000, "extra": 1 }
    },
    "total": { "s": "9", "f": 3.7 },
    "streak": { "cur": -2, "best": "x", "last": "yesterday" },
    "unlocked": ["crown", "crown", "jetpack", 5, null, "nightcap"],
    "wear": { "head": "crown", "eyes": "scarf", "neck": "jetpack", "extra": "x" }
  }`)
  const st = S.restore(raw, TODAY)
  assert.deepEqual(Object.keys(st), ["v", "days", "total", "streak", "unlocked", "wear"])
  assert.equal(st.v, 1)
  assert.deepEqual(st.days, { "2026-10-19": { c: { ai: 86400, video: 90 }, s: 0, f: 999 } })
  assert.deepEqual(st.total, { s: 0, f: 999 }, "totals never fall below what the days show")
  assert.deepEqual(st.streak, { cur: 0, best: 0, last: "" })
  assert.deepEqual(st.unlocked, ["crown", "sunglasses"], "known ids once, plus what's been reached")
  assert.deepEqual(st.wear, { neck: "", eyes: "", head: "crown" })

  // Wear only what's unlocked, in its own slot; something reached counts as unlocked.
  const w = S.restore({ total: { s: 10 }, wear: { neck: "scarf", head: "partyhat", eyes: "crown" } }, TODAY)
  assert.deepEqual(w.unlocked, ["scarf"])
  assert.deepEqual(w.wear, { neck: "scarf", eyes: "", head: "" })
  assert.deepEqual(S.restore({ wear: { neck: "scarf" } }, TODAY).wear, { neck: "", eyes: "", head: "" })

  // A streak whose best fell behind its current run.
  assert.deepEqual(S.restore({ streak: { cur: 4, best: 2, last: TODAY } }, TODAY).streak, { cur: 4, best: 4, last: TODAY })
  // A round trip through JSON changes nothing.
  const full = S.restore(fullState(), TODAY)
  assert.deepEqual(S.restore(JSON.parse(JSON.stringify(full)), TODAY), full)
})

test("stats: wear, take off and none", () => {
  let st = S.restore({ total: { s: 10, f: 5 }, streak: { cur: 7, best: 7, last: TODAY } }, TODAY)
  assert.deepEqual(st.unlocked, ["scarf", "partyhat", "sunglasses", "crown"])
  let r = S.wear(st, "scarf")
  assert.equal(r.ok, true)
  st = r.state
  st = S.wear(st, "partyhat").state
  st = S.wear(st, "sunglasses").state
  assert.deepEqual(S.worn(st), ["scarf", "sunglasses", "partyhat"], "paint order: neck, eyes, head")
  st = S.wear(st, "crown").state
  assert.deepEqual(st.wear, { neck: "scarf", eyes: "sunglasses", head: "crown" }, "the crown replaces the party hat")
  assert.deepEqual(S.worn(S.takeOff(st, "sunglasses")), ["scarf", "crown"])
  assert.deepEqual(S.worn(S.takeOff(st, "head")), ["scarf", "sunglasses"], "a slot name takes off what's in it")
  assert.equal(S.takeOff(st, "partyhat"), st, "taking off something not worn changes nothing")
  r = S.wear(st, "none")
  assert.equal(r.ok, true)
  assert.deepEqual(S.worn(r.state), [])
  assert.deepEqual(S.worn(S.takeOff(st, "none")), [])

  const fresh = S.recordStretch(S.create(), TODAY).state
  r = S.wear(fresh, "crown")
  assert.equal(r.ok, false)
  assert.equal(r.state, fresh)
  assert.match(r.error, /locked/)
  assert.match(r.error, /7-day streak/)
  r = S.wear(fresh, "jetpack")
  assert.equal(r.ok, false)
  assert.match(r.error, /unknown accessory 'jetpack'/)
  assert.equal(S.wear(fresh, "nightcap").ok, false, "the nightcap comes with bedtime, not the wardrobe")
  assert.equal(S.canWear(fresh, "scarf"), false)
  assert.equal(S.canWear(st, "scarf"), true)
})

test("stats: progress toward each milestone", () => {
  let st = times(S.create(), 7, S.recordStretch, day(0))
  st = times(st, 4, S.recordFocus, day(1))
  const rows = S.progress(st, day(1))
  assert.deepEqual(rows.map(r => [r.id, r.text]), [
    ["scarf", "7/10 stretches"], ["partyhat", "2/3 days in a row"], ["sunglasses", "4/5 focus rounds"], ["crown", "2/7 days in a row"]
  ])
  assert.deepEqual(rows[0], { id: "scarf", slot: "neck", label: "10 stretches", unlocked: false, have: 7, need: 10, text: "7/10 stretches" })
  // Two days later the streak has lapsed.
  assert.equal(S.progress(st, day(3))[1].text, "0/3 days in a row")
  st = times(st, 3, S.recordStretch, day(1))
  const scarf = S.progress(st, day(1))[0]
  assert.deepEqual([scarf.unlocked, scarf.have, scarf.text], [true, 10, "unlocked"])
})

test("stats: summary of today and the week", () => {
  let st = S.create()
  for (let i = 0; i < 3; i++) st = S.addActivity(st, day(-1), "terminal", 3600)
  st = S.recordStretch(st, day(-1)).state
  st = S.addActivity(st, TODAY, "coding", 3600)
  st = S.addActivity(st, TODAY, "coding", 3600)
  st = S.addActivity(st, TODAY, "browsing", 1800)
  st = S.addActivity(st, TODAY, "files", 600)
  st = S.addActivity(st, TODAY, "chat", 600)
  st = S.addActivity(st, TODAY, "video", 300)
  st = S.addActivity(st, TODAY, "ai", 59)
  st = S.recordStretch(st, TODAY).state
  st = S.recordFocus(st, TODAY).state

  const s = S.summary(st, TODAY)
  // Under a minute doesn't make the list, and a tie goes to the earlier category.
  assert.deepEqual(s.today, {
    stretches: 1, focus: 1, activeMinutes: 175,
    top: [{ category: "coding", minutes: 120 }, { category: "browsing", minutes: 30 }, { category: "chat", minutes: 10 }]
  })
  assert.deepEqual(s.week, {
    stretches: 2, focus: 1, activeMinutes: 355, days: 2,
    top: [{ category: "terminal", minutes: 180 }, { category: "coding", minutes: 120 }, { category: "browsing", minutes: 30 }]
  })
  assert.deepEqual(s.total, { stretches: 2, focus: 1 })
  assert.deepEqual(s.streak, { cur: 2, best: 2 })
  assert.deepEqual(s.unlocked, [])
  assert.deepEqual(s.wear, { neck: "", eyes: "", head: "" })
  assert.equal(s.progress.length, 4)
  // A quiet day: nothing today, the week still counts.
  const quiet = S.summary(st, day(1))
  assert.deepEqual(quiet.today, { stretches: 0, focus: 0, activeMinutes: 0, top: [] })
  assert.equal(quiet.week.days, 2)
  assert.deepEqual(S.summary(null, TODAY).today, { stretches: 0, focus: 0, activeMinutes: 0, top: [] })
  // Days outside the week (stored before pruning, or from a clock that ran ahead) don't count in it.
  const odd = S.summary({ days: { [day(-9)]: { c: { gaming: 3600 }, s: 1 }, [day(2)]: { s: 1 } } }, TODAY)
  assert.deepEqual(odd.week, { stretches: 0, focus: 0, activeMinutes: 0, days: 0, top: [] })
  assert.deepEqual(odd.total, { stretches: 2, focus: 0 }, "totals are all-time")
})

test("stats: inputs are never changed", () => {
  const original = S.restore(fullState(), TODAY)
  original.wear = { neck: "", eyes: "sunglasses", head: "" }
  const snapshot = JSON.stringify(original)
  const input = deepFreeze(JSON.parse(snapshot))
  const results = [
    S.addActivity(input, TODAY, "coding", 30),
    S.addActivity(input, day(1), "chat", 30),
    S.recordStretch(input, TODAY).state,
    S.recordFocus(input, day(1)).state,
    S.prune(input, day(3)),
    S.restore(input, day(2)),
    S.wear(input, "scarf").state,
    S.wear(input, "none").state,
    S.takeOff(input, "sunglasses")
  ]
  S.streak(input, TODAY)
  S.progress(input, TODAY)
  S.summary(input, TODAY)
  S.worn(input)
  S.canWear(input, "crown")
  assert.equal(JSON.stringify(input), snapshot)
  for (const r of results) assert.notEqual(r, input, "a change comes back as a new object")
  // And what they return is theirs: changing it leaves the input alone.
  const r = S.recordStretch(input, TODAY).state
  r.days[TODAY].s = 0
  r.unlocked.push("x")
  assert.equal(JSON.stringify(input), snapshot)
})

test("stats: the stored stats stay small", () => {
  const full = S.restore(fullState(), TODAY)
  assert.equal(Object.keys(full.days).length, 7)
  assert.ok(JSON.stringify(full).length < 4096, "full state is " + JSON.stringify(full).length + " bytes")

  // A hand-edited file with 300 days of everything comes back pruned.
  const c = {}
  for (const cat of S.CATEGORIES) c[cat] = 86400
  const big = { days: {}, unlocked: [] }
  for (let i = 0; i < 300; i++) big.days[day(-i)] = { c: Object.assign({}, c), s: 999, f: 999, note: "x".repeat(100) }
  assert.ok(JSON.stringify(big).length > 100000)
  const st = S.restore(big, TODAY)
  assert.equal(Object.keys(st.days).length, 7)
  assert.ok(JSON.stringify(st).length < 4096, "restored state is " + JSON.stringify(st).length + " bytes")
  assert.deepEqual(st.total, { s: 299700, f: 299700 })
  assert.deepEqual(st.unlocked, ["scarf", "sunglasses"])
  // Without a usable today: the seven latest days.
  assert.deepEqual(Object.keys(S.restore(big).days), [day(-6), day(-5), day(-4), day(-3), day(-2), day(-1), day(0)])
})
