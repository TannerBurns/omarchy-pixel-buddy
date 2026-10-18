import QtQuick
import "js/Wellbeing.js" as Wellbeing
import "js/Roster.js" as Roster

// Wellbeing nudges. Counts active time (idle stretches of 5+ minutes count as
// a break), and once a break is due waits for a natural pause before the buddy
// offers a guided stretch. Never during fullscreen, Do Not Disturb or screen
// sharing. Also the once-a-night bedtime nudge.
Item {
  id: coach

  property var settings: ({ wellbeing: true, breakMinutes: 45, stretches: Wellbeing.CATEGORIES, bedtime: "23:00" })
  property var senses: null
  property var controller: null
  property bool hidden: false
  property var session: Wellbeing.newSession(Date.now())
  property var moodSeconds: ({})

  // Bubble state
  property bool active: false
  property bool collapsed: false
  property string kind: ""            // "stretch" | "bedtime"
  property var stretch: null
  property int stepIndex: 0
  property int stepLeft: 0
  property int stepTotal: 0
  property bool stepsDone: false
  property real shownAt: 0
  property string title: ""
  property string body: ""
  property string footer: ""
  property var buttons: []

  property bool due: false
  readonly property bool waitingForPause: due && !active

  // Something worth saving changed (the session object is mutated in place).
  signal persist()
  property int revision: 0
  onPersist: coach.revision++

  function restore(stored) {
    coach.session = Wellbeing.restore(stored, Date.now())
  }

  function blockers() {
    return {
      hidden: coach.hidden,
      fullscreen: coach.senses ? coach.senses.fullscreen : false,
      dnd: coach.senses ? coach.senses.dnd : false,
      screencast: coach.senses ? coach.senses.screencast : false
    }
  }

  function dominantMood() {
    var best = "", n = -1
    for (var k in coach.moodSeconds) if (coach.moodSeconds[k] > n) { n = coach.moodSeconds[k]; best = k }
    return best
  }

  // Every 30 s: advance the session, check for a due break or bedtime.
  Timer {
    interval: 30000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: coach.check()
  }

  function check() {
    var now = Date.now()
    var s = coach.session
    var idle = coach.senses ? coach.senses.userIdle : false
    Wellbeing.tick(s, now, !idle)
    if (coach.senses && coach.senses.longIdle) Wellbeing.breakTaken(s)
    if (!idle && coach.senses) {
      var m = Object.assign({}, coach.moodSeconds)
      m[coach.senses.mood] = (m[coach.senses.mood] || 0) + 30
      coach.moodSeconds = m
    }
    if (s.activeMs === 0) coach.moodSeconds = ({})
    coach.persist()
    if (coach.active) return
    var st = Wellbeing.status(s, now, { enabled: coach.settings.wellbeing, breakMinutes: coach.settings.breakMinutes }, coach.blockers())
    coach.due = st.due
    if (!st.due && coach.settings.wellbeing && coach.settings.bedtime) {
      var date = new Date(now)
      var b = coach.blockers()
      if (!b.hidden && !b.fullscreen && !b.dnd && !b.screencast && Wellbeing.bedtimeNudgeDue(s, date, coach.settings.bedtime, Roster.dayKey(date)))
        coach.offerBedtime()
    }
  }

  // The 3 s "natural pause" idle monitor (in Senses) runs only while a break is
  // due; the nudge appears in that pause rather than mid-keystroke.
  Connections {
    target: coach.senses
    function onPauseChanged() { if (coach.senses.pause && coach.due && !coach.active) coach.offerStretch(false) }
  }

  function remainingText() {
    var st = Wellbeing.status(coach.session, Date.now(), { enabled: coach.settings.wellbeing, breakMinutes: coach.settings.breakMinutes }, coach.blockers())
    if (st.reason === "off") return "off"
    if (st.due) return "now"
    if (st.remainingMs !== undefined) return Math.ceil(st.remainingMs / 60000) + " min" + (st.reason === "snoozed" ? " (snoozed)" : "")
    return st.reason
  }

  function offerStretch(force) {
    if (coach.active) return false
    var b = coach.blockers()
    if (b.hidden) return false
    if (!force && (b.fullscreen || b.dnd || b.screencast)) return false
    var now = new Date()
    var night = Wellbeing.isNight(now, coach.settings.bedtime)
    var st = Wellbeing.pick(coach.session, coach.settings.stretches,
                            { mood: coach.dominantMood(), sessionMs: coach.session.activeMs, night: night }, Math.random)
    coach.kind = "stretch"
    coach.stretch = st
    coach.stepIndex = 0
    coach.stepsDone = false
    coach.due = false
    coach.collapsed = false
    coach.shownAt = Date.now()
    coach.active = true
    coach.startStep()
    expiry.restart()
    return true
  }

  function startStep() {
    var st = coach.stretch
    var step = st.steps[coach.stepIndex]
    coach.title = st.title
    coach.body = step.text
    coach.stepTotal = step.s
    coach.stepLeft = step.s
    coach.footer = st.steps.length > 1 ? (coach.stepIndex + 1) + " of " + st.steps.length : ""
    coach.buttons = [{ id: "done", label: "Done", primary: true }, { id: "later", label: "Later" }, { id: "skip", label: "Skip" }]
    if (coach.controller) coach.controller.setStretch(step.anim)
    stepTimer.restart()
  }

  Timer {
    id: stepTimer
    interval: 1000
    repeat: true
    onTriggered: {
      if (!coach.active || coach.kind !== "stretch" || coach.stepsDone) { stop(); return }
      coach.stepLeft = Math.max(0, coach.stepLeft - 1)
      if (coach.stepLeft > 0) return
      if (coach.stepIndex + 1 < coach.stretch.steps.length) {
        coach.stepIndex++
        coach.startStep()
      } else {
        stop()
        coach.stepsDone = true
        coach.body = "Nice. Did you do it?"
        coach.footer = ""
        coach.buttons = [{ id: "done", label: "Done", primary: true }, { id: "skip", label: "Not this time" }]
        if (coach.controller) { coach.controller.setStretch(null); coach.controller.react("cheer") }
      }
    }
  }

  // Unanswered nudges fold away quietly; the timer restarts without nagging.
  Timer {
    id: expiry
    interval: 180000
    onTriggered: if (coach.active) coach.answer(coach.kind === "bedtime" ? "ok" : "expired")
  }

  function offerBedtime() {
    var date = new Date()
    coach.session.lastBedtimeNudge = Roster.dayKey(date)
    coach.kind = "bedtime"
    coach.stretch = null
    coach.title = "It's getting late"
    coach.body = "Maybe start wrapping up for the night?"
    coach.footer = ""
    coach.stepTotal = 0
    coach.stepsDone = true
    coach.buttons = [{ id: "ok", label: "OK", primary: true }]
    coach.collapsed = false
    coach.shownAt = Date.now()
    coach.active = true
    if (coach.controller) coach.controller.react("yawn")
    expiry.restart()
    coach.persist()
  }

  function answer(id) {
    if (!coach.active) return
    stepTimer.stop()
    expiry.stop()
    var now = Date.now()
    if (coach.kind === "stretch") {
      var outcome = id === "done" ? "done" : id === "later" ? "later" : id === "expired" ? "expired" : "skip"
      Wellbeing.finish(coach.session, now, coach.stretch, outcome, Roster.dayKey(new Date(now)))
      if (coach.controller) {
        coach.controller.setStretch(null)
        if (outcome === "done") coach.controller.react("heart")
      }
    }
    coach.active = false
    coach.kind = ""
    coach.stretch = null
    coach.persist()
  }

  function snooze(minutes) {
    coach.session.snoozeUntil = Date.now() + minutes * 60000
    if (coach.active) coach.answer("later")
    coach.persist()
  }

  onHiddenChanged: if (coach.hidden && coach.active) coach.answer(coach.kind === "bedtime" ? "ok" : "later")
}
