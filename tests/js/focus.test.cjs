// Focus timer: rounds, breaks, catching up after a suspend, and the Do Not
// Disturb bookkeeping that keeps the user's own DND untouched.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js } = require("./helpers.cjs")

const F = js("Focus")

const MIN = 60000
const T0 = Date.UTC(2026, 9, 18, 14, 0, 0)
const CFG = { focusMinutes: 25, breakMinutes: 5, dnd: true }

// A focus round started at T0 that switched DND on (it was off).
const focusing = () => F.start(F.create(), T0, CFG, false).state

test("focus: a full round goes focus, break, another round?, again, stop", () => {
  const idle = F.create()
  assert.equal(idle.phase, "idle")
  assert.equal(F.isRunning(idle), false)
  assert.equal(F.label(idle, T0), "")

  const started = F.start(idle, T0, CFG, false)
  assert.deepEqual(started.effects, ["dnd-on"])
  let s = started.state
  assert.equal(s.phase, "focus")
  assert.equal(s.round, 1)
  assert.equal(s.endsAt, T0 + 25 * MIN)
  assert.equal(s.dnd, "ours")
  assert.equal(s.dndSetAt, T0)
  assert.equal(F.isRunning(s), true)

  let r = F.advance(s, T0 + 10 * MIN, true)
  assert.deepEqual([r.events, r.effects], [[], []])
  assert.equal(r.state.phase, "focus")
  assert.equal(F.label(r.state, T0 + 10 * MIN), "Focus · 15 min left")

  r = F.advance(s, T0 + 25 * MIN, true)
  assert.deepEqual(r.events, ["focus-done"])
  assert.deepEqual(r.effects, ["dnd-off"])
  s = r.state
  assert.equal(s.phase, "break")
  assert.equal(s.startedAt, T0 + 25 * MIN)
  assert.equal(s.endsAt, T0 + 30 * MIN)
  assert.equal(s.dnd, "none")
  assert.equal(F.label(s, T0 + 26 * MIN), "Break · 4 min left")

  r = F.advance(s, T0 + 30 * MIN, false)
  assert.deepEqual([r.events, r.effects], [["break-done"], []])
  s = r.state
  assert.equal(s.phase, "ask")
  assert.equal(s.askedAt, T0 + 30 * MIN)
  assert.equal(s.endsAt, 0)
  assert.equal(F.label(s, T0 + 31 * MIN), "Another round?")
  assert.equal(F.minutesLeft(s, T0 + 31 * MIN), 0)

  const next = F.again(s, T0 + 31 * MIN, CFG, false)
  assert.deepEqual(next.effects, ["dnd-on"])
  assert.equal(next.state.phase, "focus")
  assert.equal(next.state.round, 2)
  assert.equal(next.state.endsAt, T0 + 56 * MIN)

  const stopped = F.stop(next.state, T0 + 40 * MIN)
  assert.deepEqual(stopped.effects, ["dnd-off"])
  assert.equal(stopped.state.phase, "idle")
  assert.equal(stopped.state.round, 0)
  assert.equal(F.isRunning(stopped.state), false)
  // Stopping outside focus has nothing of ours to switch off.
  assert.deepEqual(F.stop(s, T0 + 31 * MIN).effects, [])
  // A new start from a break begins the next round right away.
  const brk = F.advance(focusing(), T0 + 26 * MIN).state
  const cut = F.start(brk, T0 + 26 * MIN, CFG, false)
  assert.equal(cut.state.round, 2)
  assert.deepEqual(cut.effects, ["dnd-on"])
})

test("focus: one advance catches up across focus and break after a suspend", () => {
  const s = focusing()
  const r = F.advance(s, T0 + 31 * MIN, false)
  assert.deepEqual(r.events, ["focus-done", "break-done"])
  assert.deepEqual(r.effects, ["dnd-off"])
  assert.equal(r.state.phase, "ask")
  assert.equal(r.state.askedAt, T0 + 30 * MIN)
  const long = F.advance(s, T0 + 2 * 60 * MIN, false)
  assert.deepEqual(long.events, ["focus-done", "break-done", "ask-expired"])
  assert.deepEqual(long.effects, ["dnd-off"])
  assert.equal(long.state.phase, "idle")
})

test("focus: an unanswered \"another round?\" expires", () => {
  const ask = F.advance(focusing(), T0 + 30 * MIN).state
  assert.equal(ask.phase, "ask")
  assert.equal(F.nextEventIn(ask, T0 + 30 * MIN), F.ASK_MS)
  const early = F.advance(ask, T0 + 30 * MIN + F.ASK_MS - 1)
  assert.deepEqual(early.events, [])
  assert.equal(early.state.phase, "ask")
  const late = F.advance(ask, T0 + 30 * MIN + F.ASK_MS)
  assert.deepEqual(late.events, ["ask-expired"])
  assert.deepEqual(late.effects, [])
  assert.equal(late.state.phase, "idle")
  assert.equal(late.state.round, 0)
  // The last durations are kept for next time.
  assert.equal(late.state.focusMs, 25 * MIN)
})

test("focus: a restart mid-focus resumes, and an overdue one catches up with DND off", () => {
  const s = focusing()
  const saved = JSON.parse(JSON.stringify(F.serialize(s)))
  const back = F.restore(saved, T0 + 5 * MIN)
  assert.deepEqual(back, s)
  assert.equal(back.dnd, "ours")
  const r = F.advance(back, T0 + 5 * MIN, true)
  assert.deepEqual([r.events, r.effects, r.state.phase], [[], [], "focus"])

  const overdue = F.restore(saved, T0 + 27 * MIN)
  assert.equal(overdue.phase, "focus", "restore doesn't advance by itself")
  const caught = F.advance(overdue, T0 + 27 * MIN, true)
  assert.deepEqual(caught.events, ["focus-done"])
  assert.deepEqual(caught.effects, ["dnd-off"])
  assert.equal(caught.state.phase, "break")
  assert.equal(caught.state.endsAt, T0 + 30 * MIN)

  // A saved break or ask comes back too.
  const brk = F.advance(s, T0 + 26 * MIN).state
  assert.deepEqual(F.restore(JSON.parse(JSON.stringify(brk)), T0 + 27 * MIN), brk)
  const ask = F.advance(s, T0 + 31 * MIN).state
  assert.deepEqual(F.restore(JSON.parse(JSON.stringify(ask)), T0 + 32 * MIN), ask)
})

test("focus: DND that was already on is left alone", () => {
  const r = F.start(F.create(), T0, CFG, true)
  assert.deepEqual(r.effects, [])
  assert.equal(r.state.dnd, "none")
  const end = F.advance(r.state, T0 + 25 * MIN, true)
  assert.deepEqual(end.events, ["focus-done"])
  assert.deepEqual(end.effects, [])
  assert.deepEqual(F.stop(r.state, T0 + MIN).effects, [])
  // focusDnd off: never touches DND.
  const off = F.start(F.create(), T0, { focusMinutes: 25, breakMinutes: 5, dnd: false }, false)
  assert.deepEqual(off.effects, [])
  assert.equal(off.state.dnd, "none")
  assert.deepEqual(F.advance(off.state, T0 + 25 * MIN, false).effects, [])
})

test("focus: turning DND off by hand mid-focus releases it", () => {
  const s = focusing()
  assert.equal(F.observeDnd(s, T0 + 1000, false).dnd, "ours", "inside the grace window the switch is still landing")
  assert.equal(F.observeDnd(s, T0 + F.DND_GRACE_MS - 1, false).dnd, "ours")
  assert.equal(F.observeDnd(s, T0 + 5 * MIN, true).dnd, "ours")
  const released = F.observeDnd(s, T0 + F.DND_GRACE_MS, false)
  assert.equal(released.dnd, "released")
  // Turning it back on later makes it the user's: still not ours.
  assert.equal(F.observeDnd(released, T0 + 6 * MIN, true).dnd, "released")
  const end = F.advance(released, T0 + 25 * MIN, true)
  assert.deepEqual(end.events, ["focus-done"])
  assert.deepEqual(end.effects, [], "no dnd-off for a DND we let go of")
  assert.equal(end.state.dnd, "none")
  assert.deepEqual(F.stop(released, T0 + 7 * MIN).effects, [])
  // Outside focus, or with DND not ours, readings change nothing.
  const brk = end.state
  assert.deepEqual(F.observeDnd(brk, T0 + 26 * MIN, false), brk)
  const theirs = F.start(F.create(), T0, CFG, true).state
  assert.equal(F.observeDnd(theirs, T0 + 5 * MIN, false).dnd, "none")
})

test("focus: restarting mid-focus keeps DND ours without switching it again", () => {
  const s = focusing()
  const r = F.start(s, T0 + 5 * MIN, CFG, true)
  assert.deepEqual(r.effects, [])
  assert.equal(r.state.dnd, "ours")
  assert.equal(r.state.dndSetAt, T0)
  assert.equal(r.state.round, 1, "a restart is the same round")
  assert.equal(r.state.endsAt, T0 + 30 * MIN)
  // Even a DND-off reading (the switch still landing) doesn't re-send it.
  assert.deepEqual(F.start(s, T0 + 1000, CFG, false).effects, [])
  // After the user released it, a restart is a fresh start for DND too.
  const released = F.observeDnd(s, T0 + 4 * MIN, false)
  const fresh = F.start(released, T0 + 5 * MIN, CFG, false)
  assert.deepEqual(fresh.effects, ["dnd-on"])
  assert.equal(fresh.state.dnd, "ours")
  assert.equal(fresh.state.dndSetAt, T0 + 5 * MIN)
})

test("focus: minutes round up and the minute timer lands on the boundaries", () => {
  const s = focusing()
  assert.equal(F.minutesLeft(s, T0), 25)
  assert.equal(F.minutesLeft(s, T0 + 100), 25, "24:59.9 shows 25")
  assert.equal(F.minutesLeft(s, T0 + MIN), 24)
  assert.equal(F.minutesLeft(s, T0 + 25 * MIN - 100), 1, "0:00.1 shows 1")
  assert.equal(F.minutesLeft(s, T0 + 25 * MIN), 0)
  assert.equal(F.minutesLeft(s, T0 + 26 * MIN), 0)
  assert.equal(F.msToNextMinute(s, T0), MIN)
  assert.equal(F.msToNextMinute(s, T0 + 100), MIN - 100)
  assert.equal(F.msToNextMinute(s, T0 + 25 * MIN - 100), 100)
  assert.equal(F.msToNextMinute(s, T0 + 25 * MIN), 1, "overdue: check again right away")
  for (const t of [T0, T0 + 1, T0 + 59999, T0 + 60000, T0 + 61234, T0 + 24 * MIN + 1, T0 + 25 * MIN - 1]) {
    const m = F.minutesLeft(s, t)
    const d = F.msToNextMinute(s, t)
    assert.equal(F.minutesLeft(s, t + d - 1), m, "unchanged just before the tick at " + (t - T0))
    assert.equal(F.minutesLeft(s, t + d), m - 1, "changed at the tick at " + (t - T0))
  }
  assert.equal(F.msToNextMinute(F.create(), T0), -1)
  const ask = F.advance(s, T0 + 31 * MIN).state
  assert.equal(F.msToNextMinute(ask, T0 + 31 * MIN), -1)

  assert.equal(F.nextEventIn(s, T0 + 10 * MIN), 15 * MIN)
  assert.equal(F.nextEventIn(s, T0 + 30 * MIN), 0)
  const brk = F.advance(s, T0 + 25 * MIN).state
  assert.equal(F.nextEventIn(brk, T0 + 27 * MIN), 3 * MIN)
  assert.equal(F.nextEventIn(F.create(), T0), -1)

  // Durations are clamped to 1..180 and 1..60 minutes; garbage uses 25 and 5.
  const big = F.start(F.create(), T0, { focusMinutes: 999, breakMinutes: 99 }, false).state
  assert.deepEqual([big.focusMs, big.breakMs], [180 * MIN, 60 * MIN])
  const small = F.start(F.create(), T0, { focusMinutes: 0, breakMinutes: -3 }, false).state
  assert.deepEqual([small.focusMs, small.breakMs], [MIN, MIN])
  const junk = F.start(F.create(), T0, { focusMinutes: "lots" }, false).state
  assert.deepEqual([junk.focusMs, junk.breakMs], [25 * MIN, 5 * MIN])
  assert.equal(F.start(F.create(), T0, { focusMinutes: "30" }, false).state.focusMs, 30 * MIN)
  assert.deepEqual(F.start(F.create(), T0, null, false).effects, [], "no cfg: no DND")
})

test("focus: a malformed saved state restores to idle", () => {
  const good = F.serialize(focusing())
  const idle = F.create()
  const bad = [
    null, undefined, "focus", 42, [], {},
    { ...good, v: 2 },
    { ...good, phase: "nap" },
    { ...good, endsAt: NaN },
    { ...good, endsAt: "soon" },
    { ...good, startedAt: -5 },
    { ...good, focusMs: -25 * MIN },
    { ...good, focusMs: 0 },
    { ...good, breakMs: 2 * 60 * MIN },
    { ...good, endsAt: T0 + 5 * 60 * MIN },
    { ...good, startedAt: T0 + 30 * MIN },
    { ...good, phase: "ask", askedAt: 0 }
  ]
  for (const raw of bad) assert.deepEqual(F.restore(raw, T0 + MIN), idle, JSON.stringify(raw))
  assert.equal(F.restore({ ...good, dnd: "mine" }, T0 + MIN).dnd, "none")
  const brk = F.serialize(F.advance(focusing(), T0 + 26 * MIN).state)
  assert.equal(F.restore({ ...brk, dnd: "ours" }, T0 + 27 * MIN).dnd, "none", "only focus can own DND")
  const keep = F.restore({ ...F.create(), focusMs: 50 * MIN }, T0)
  assert.equal(keep.phase, "idle")
  assert.equal(keep.focusMs, 50 * MIN, "idle keeps the last durations")
})

test("focus: inputs are never changed", () => {
  const cfg = { focusMinutes: 25, breakMinutes: 5, dnd: true }
  const s = F.start(F.create(), T0, cfg, false).state
  const snap = JSON.stringify(s)
  const cfgSnap = JSON.stringify(cfg)
  const results = [
    F.advance(s, T0 + 31 * MIN, false).state,
    F.observeDnd(s, T0 + 5 * MIN, false),
    F.stop(s, T0 + MIN).state,
    F.start(s, T0 + MIN, cfg, true).state,
    F.again(s, T0 + MIN, cfg, false).state,
    F.serialize(s),
    F.restore(s, T0 + MIN)
  ]
  F.minutesLeft(s, T0 + MIN)
  F.msToNextMinute(s, T0 + MIN)
  F.nextEventIn(s, T0 + MIN)
  F.label(s, T0 + MIN)
  assert.equal(JSON.stringify(s), snap)
  assert.equal(JSON.stringify(cfg), cfgSnap)
  for (const r of results) assert.notEqual(r, s, "a new object every time")
})
