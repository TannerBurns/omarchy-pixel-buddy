// Git celebrations: the watcher's tokens and the rules that pace reactions.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js } = require("./helpers.cjs")

const G = js("GitLog")

const T0 = 1792300000000
const DAY = "2026-10-18"
const seen = { visible: true, focus: false, dayKey: DAY }

// Feeds [kind, ms after T0] pairs; returns the actions and the final state.
function run(events, ctx, start) {
  let s = start || G.create()
  const actions = []
  for (const [kind, at] of events) {
    const r = G.decide(s, kind, T0 + at, ctx || seen)
    actions.push(r.action)
    s = r.state
  }
  return { actions, state: s }
}

test("gitlog: only the watcher's three tokens count", () => {
  assert.equal(G.parseLine("C commit"), "commit")
  assert.equal(G.parseLine("C amend"), "amend")
  assert.equal(G.parseLine("R push"), "push")
  assert.equal(G.parseLine("C commit\r"), "commit")
  assert.equal(G.parseLine("R push  \n"), "push")
  for (const other of ["# repos 3", "C commitx", "R push origin", " C commit", "c commit", "", null, undefined, "fix: secret subject"])
    assert.equal(G.parseLine(other), null, JSON.stringify(other))
})

test("gitlog: one celebration per 20 seconds, and decide never mutates its input", () => {
  const s = G.create()
  const before = JSON.stringify(s)
  const first = G.decide(s, "commit", T0, seen)
  assert.equal(first.action, "commit")
  assert.equal(JSON.stringify(s), before, "input state untouched")
  assert.equal(first.state.count, 1)
  const { actions } = run([["commit", 0], ["commit", 10000], ["commit", 19999], ["commit", 21000]])
  assert.deepEqual(actions, ["commit", null, null, "commit"])
  assert.equal(G.decide(null, "commit", T0, seen).action, "commit", "a missing state starts fresh")
})

test("gitlog: a push right after a commit upgrades it", () => {
  const { actions, state } = run([["commit", 0], ["push", 5000], ["push", 8000], ["push", 30000]])
  assert.deepEqual(actions, ["commit", "upgrade", null, "push"])
  assert.equal(state.count, 2, "the upgrade costs nothing from the daily allowance")
  // Too late for an upgrade: the gap applies.
  assert.deepEqual(run([["commit", 0], ["push", 11000], ["push", 25000]]).actions, ["commit", null, "push"])
  // An amend's sparkle doesn't upgrade.
  assert.deepEqual(run([["amend", 0], ["push", 3000]]).actions, ["sparkle", null])
})

test("gitlog: a burst of events mutes it for a minute", () => {
  const burst = [["commit", 0], ["commit", 1000], ["commit", 2000], ["commit", 3000], ["commit", 4000]]
  const { actions, state } = run(burst)
  assert.deepEqual(actions, ["commit", null, null, null, null])
  assert.equal(state.mutedUntil, T0 + 4000 + G.MUTE_MS)
  // Still muted 30 s later, even though the gap has passed; each event in a
  // continuing burst extends the mute.
  const later = run([["commit", 34000]], seen, state)
  assert.equal(later.actions[0], null)
  assert.equal(later.state.mutedUntil, T0 + 34000 + G.MUTE_MS)
  // Once the burst has drained out of the window and the mute is over: back.
  assert.equal(run([["commit", 120000]], seen, later.state).actions[0], "commit")
})

test("gitlog: at most 40 a day, counting again the next day", () => {
  const events = []
  for (let i = 0; i < 41; i++) events.push(["commit", i * 21000])
  const { actions, state } = run(events)
  assert.equal(actions.filter(a => a === "commit").length, G.DAILY_CAP)
  assert.equal(actions[40], null)
  const tomorrow = G.decide(state, "commit", T0 + 41 * 21000, { visible: true, focus: false, dayKey: "2026-10-19" })
  assert.equal(tomorrow.action, "commit")
  assert.equal(tomorrow.state.count, 1)
})

test("gitlog: nothing counts while the buddy isn't on screen", () => {
  const hidden = { visible: false, focus: false, dayKey: DAY }
  const s = G.create()
  const r = G.decide(s, "commit", T0, hidden)
  assert.equal(r.action, null)
  assert.deepEqual(r.state, s, "state unchanged")
  // Five hidden events don't trip the burst mute or the gap.
  let st = s
  for (let i = 0; i < 5; i++) st = G.decide(st, "commit", T0 + i * 1000, hidden).state
  assert.equal(G.decide(st, "commit", T0 + 6000, seen).action, "commit")
})

test("gitlog: during focus it only sparkles", () => {
  const focus = { visible: true, focus: true, dayKey: DAY }
  assert.deepEqual(run([["commit", 0], ["push", 4000], ["push", 30000], ["amend", 60000]], focus).actions,
    ["sparkle", null, "sparkle", "sparkle"])
  assert.equal(run([["amend", 0]]).actions[0], "sparkle", "an amend sparkles outside focus too")
  assert.equal(G.decide(G.create(), "fetch", T0, seen).action, null, "unknown kinds are ignored")
})

test("gitlog: a clock that jumps back doesn't block celebrations", () => {
  const { state } = run([["commit", 0]])
  assert.equal(G.decide(state, "commit", T0 - 3600000, seen).action, "commit")
})

test("gitlog: gitRoots parses to at most five absolute folders", () => {
  const home = "/home/tanner"
  assert.deepEqual(G.parseRoots("~/Work,~/Code,~/Projects,~/src", home),
    ["/home/tanner/Work", "/home/tanner/Code", "/home/tanner/Projects", "/home/tanner/src"])
  assert.deepEqual(G.parseRoots(" ~/Work/ , /srv/git//repos/ ,, ~ ", home + "/"),
    ["/home/tanner/Work", "/srv/git/repos", "/home/tanner"])
  assert.deepEqual(G.parseRoots("Work,./x,~tanner/x,../up,/a/../b,/,~/x/..", home), [])
  assert.deepEqual(G.parseRoots("/a,/a/,/a/./,/b", home), ["/a", "/b"])
  assert.deepEqual(G.parseRoots("/1,/2,/3,/4,/5,/6,/7", home), ["/1", "/2", "/3", "/4", "/5"])
  assert.deepEqual(G.parseRoots("~/Work", ""), [], "no home, no ~")
  assert.deepEqual(G.parseRoots("/ok,/bad\nline", home), ["/ok"])
  assert.deepEqual(G.parseRoots(null, home), [])
  assert.deepEqual(G.parseRoots(undefined, home), [])
})
