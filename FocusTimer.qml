import QtQuick
import Quickshell
import Quickshell.Io
import "js/Focus.js" as Focus

// The focus timer (Pomodoro): focus with Do Not Disturb on, then a break, then
// "another round?". The rules live in js/Focus.js and run on wall-clock time,
// so a suspend or shell restart just catches up: the single timer below is
// never armed more than a minute ahead, and the Service's minute clock also
// calls advance(). The Service saves `state` on every `persist`.
Item {
  id: timer

  property var settings: ({ focusMinutes: 25, focusBreakMinutes: 5, focusDnd: true })
  property bool dndOn: false                 // the current DND state (Senses)
  property var state: Focus.create()

  readonly property string phase: timer.state.phase
  readonly property bool running: timer.phase !== "idle"
  readonly property bool focusing: timer.phase === "focus"
  property int minutesLeft: 0
  property string label: ""

  signal event(string name)                  // "focus-done" | "break-done" | "ask-expired"
  signal persist()

  function cfg() {
    return { focusMinutes: timer.settings.focusMinutes, breakMinutes: timer.settings.focusBreakMinutes, dnd: timer.settings.focusDnd }
  }

  // `minutes` (optional) overrides focusMinutes for this round.
  function start(minutes) {
    var c = timer.cfg()
    if (minutes > 0) c.focusMinutes = minutes
    timer.apply(Focus.start(timer.state, Date.now(), c, timer.dndOn))
  }
  function again() { timer.apply(Focus.again(timer.state, Date.now(), timer.cfg(), timer.dndOn)) }
  function stop() { timer.apply(Focus.stop(timer.state, Date.now())) }
  function toggle() { if (timer.running) timer.stop(); else timer.start() }

  // After a shell restart: pick up where it was (DND that was ours stays ours,
  // so the end of focus still switches it off), then catch up.
  function restore(raw) {
    timer.state = Focus.restore(raw, Date.now())
    timer.advance()
  }

  function apply(res) {
    timer.state = res.state
    timer.runEffects(res.effects)
    timer.refresh()
    timer.persist()
  }

  function advance() {
    var res = Focus.advance(timer.state, Date.now(), timer.dndOn)
    var changed = res.events.length > 0 || res.effects.length > 0
    timer.state = res.state
    timer.runEffects(res.effects)
    timer.refresh()
    if (changed) timer.persist()
    for (var i = 0; i < res.events.length; i++) timer.event(res.events[i])
  }

  function refresh() {
    var now = Date.now()
    timer.minutesLeft = Focus.minutesLeft(timer.state, now)
    timer.label = Focus.label(timer.state, now)
    var waits = [Focus.nextEventIn(timer.state, now), Focus.msToNextMinute(timer.state, now)].filter(function (v) { return v >= 0 })
    if (waits.length === 0) { tick.stop(); return }
    tick.interval = Math.max(200, Math.min(60000, Math.min.apply(null, waits) + 50))
    tick.restart()
  }

  Timer { id: tick; repeat: false; onTriggered: timer.advance() }

  // Turning DND off by hand mid-focus hands it back to you for this round.
  onDndOnChanged: {
    var s = Focus.observeDnd(timer.state, Date.now(), timer.dndOn)
    if (s.dnd !== timer.state.dnd) { timer.state = s; timer.persist() }
  }

  // ---------------------------------------------------------------- DND

  // Through the notifications service's IPC, which answers with the state it
  // ends up in; a call that doesn't land is retried a few times. Never undone
  // on unload: a shell restart mid-focus keeps your DND until focus ends.
  property bool dndWant: false
  property int dndTries: 0

  function runEffects(effects) {
    for (var i = 0; i < (effects || []).length; i++) {
      if (effects[i] === "dnd-on") timer.setDnd(true)
      else if (effects[i] === "dnd-off") timer.setDnd(false)
    }
  }

  function setDnd(on) {
    timer.dndWant = on
    timer.dndTries = 0
    dndRetry.stop()
    timer.callDnd()
  }

  function callDnd() {
    dndProc.running = false
    dndProc.command = ["omarchy-shell", "notifications", "setDnd", timer.dndWant ? "on" : "off"]
    dndProc.running = true
  }

  Process {
    id: dndProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (String(text).trim() === (timer.dndWant ? "on" : "off")) return
        if (++timer.dndTries < 3) dndRetry.restart()
        else console.warn("pixel-buddy: couldn't switch Do Not Disturb " + (timer.dndWant ? "on" : "off"))
      }
    }
  }

  Timer { id: dndRetry; interval: 2000; onTriggered: timer.callDnd() }
}
