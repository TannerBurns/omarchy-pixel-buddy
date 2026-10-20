import QtQuick
import "js/Visit.js" as VisitJs
import "js/CharacterSchema.js" as Schema

// Visiting friends (js/Visit.js): every `friendEvery` minutes or so another
// character portals in beside the buddy for a ten-second scene, then heads
// home. The friend is drawn by its own scripted Controller (`friend`), which
// has no world between visits, so nothing runs for it the rest of the time.
// Anything that needs the buddy (a drag, a portal, hiding, fullscreen, screen
// sharing, focus, a character swap, you stepping away, a bubble) sends the
// friend home early: through its portal, or at once when it can't be seen.
Item {
  id: visit

  property var settings: ({ friends: true, friendEvery: 45, colors: "natural" })
  property var host: null            // the buddy's Controller
  property var friend: null          // the friend's Controller
  property var registry: null        // Characters
  property var themeColors: ({})
  property string shownId: ""        // the buddy's character (never its own visitor)
  property bool night: false
  property var env: null             // Senses.env
  property real startedAt: Date.now()
  // What keeps a friend away (Visit.blocker): placed, hidden, covered,
  // screencast, focusing, idle, bubble.
  property var conditions: ({})

  property var state: VisitJs.restore(null, Date.now(), 45)
  property bool running: false
  property bool leaving: false
  property string friendId: ""
  property var friendSkin: null      // { character, colors } while a friend is over
  property var steps: []
  property int stepIndex: 0
  property var where: null           // the friend's spot { x, y, side, facing }
  property real sceneStart: 0
  property real retryAt: 0

  signal persist()

  function restore(raw) { visit.state = VisitJs.restore(raw, Date.now(), visit.settings.friendEvery) }

  // Calm enough to have company.
  readonly property bool hostCalm: !!visit.host && ["idle", "sit", "land", "walk"].indexOf(visit.host.worldState) >= 0
  readonly property string blocker: VisitJs.blocker(visit.conditions)
  onBlockerChanged: if (visit.running && visit.blocker) visit.abort(visit.blocker)

  // Picked up, through a portal, falling or off to the bar: the friend goes.
  Connections {
    target: visit.host
    function onWorldStateChanged() {
      if (!visit.running || visit.leaving) return
      var s = visit.host.worldState
      if (["carried", "portal", "fall", "thrown", "hop", "fly", "away"].indexOf(s) >= 0) visit.abort(s)
    }
  }

  Connections {
    target: visit.friend
    function onWorldEvent(ev) { if (ev.type === "gone") visit.finish() }
  }

  Timer {
    interval: 30000
    repeat: true
    running: visit.settings.friends && !visit.running
    onTriggered: visit.check()
  }

  function check() {
    var now = Date.now()
    var ctx = Object.assign({}, visit.conditions, { busy: !visit.hostCalm, uptimeMs: now - visit.startedAt, retryAt: visit.retryAt })
    if (VisitJs.due(visit.state, now, { enabled: visit.settings.friends, everyMinutes: visit.settings.friendEvery }, ctx).due) {
      var r = visit.start("")
      if (r !== "ok") visit.retryAt = now + VisitJs.RETRY_MS
    }
  }

  // When the next visit is due, for status.
  function status() {
    var now = Date.now()
    var ctx = Object.assign({}, visit.conditions, { busy: !visit.hostCalm, uptimeMs: now - visit.startedAt, retryAt: visit.retryAt })
    var d = VisitJs.due(visit.state, now, { enabled: visit.settings.friends, everyMinutes: visit.settings.friendEvery }, ctx)
    return { enabled: visit.settings.friends, visiting: visit.running ? visit.friendId : "", next: d.reason,
             inMinutes: d.inMs > 0 ? Math.ceil(d.inMs / 60000) : 0 }
  }

  function friendEnv() {
    var e = visit.env || {}
    return { mon: e.mon || null, ledges: e.ledges || [], perch: null, focused: null, rects: e.rects || [], floating: !!e.floating }
  }
  function syncEnv() { if (visit.running && visit.friend) visit.friend.setEnv(visit.friendEnv()) }

  // id: a character id, or "" / "random" for anyone. Returns "ok" or why not.
  function start(id) {
    if (visit.running) return "a friend is already over"
    var b = VisitJs.blocker(visit.conditions)
    if (b) return "busy (" + b + ")"
    if (!visit.hostCalm) return "busy"
    var reg = visit.registry
    var ids = reg.ids.filter(function (x) { return !!reg.byId[x] })
    var want = id && id !== "random" ? id : VisitJs.pickFriend(ids, visit.shownId, visit.state.recent, Math.random)
    if (!want) return "no one else to invite"
    if (!reg.byId[want]) return "unknown character '" + want + "'"
    if (want === visit.shownId) return "that's the buddy itself"
    var e = visit.env
    if (!e || !e.mon) return "busy"

    visit.host.setVisit(true)
    var h = visit.host.spot()
    var ch = reg.byId[want]
    visit.friendSkin = { character: ch, colors: Schema.resolveColors(ch, visit.settings.colors, visit.themeColors) }
    var fw = visit.friend.halfW()
    var k = visit.friend.px
    // Room beyond its spot for the portal it steps out of.
    var room = fw + Math.max(7, Math.round(ch.w * 0.72)) * k * 0.92
    var at = h && fw > 0 ? VisitJs.spot(h, fw, e.mon, k, room) : null
    if (!at) {
      visit.host.setVisit(false)
      visit.friend.reset()
      visit.friendSkin = null
      return "no room next to the buddy"
    }
    visit.friend.setEnv(visit.friendEnv())
    visit.friend.setFlags({ night: visit.night })
    visit.friendId = want
    visit.where = at
    visit.steps = VisitJs.timeline(Math.random)
    visit.stepIndex = 0
    visit.sceneStart = Date.now()
    visit.leaving = false
    visit.running = true
    visit.friend.portalIn({ x: at.x, y: at.y, ledge: h.support, facing: at.facing }, at.facing)
    visit.runSteps()
    return "ok"
  }

  Timer { id: stepTimer; onTriggered: visit.runSteps() }
  // A friend on its way out is gone by then, whatever its portal is doing.
  Timer { id: leaveTimeout; interval: VisitJs.LEAVE_TIMEOUT_MS; onTriggered: { if (visit.friend) visit.friend.vanish(); visit.finish() } }

  function runSteps() {
    if (!visit.running || visit.leaving) return
    var t = (Date.now() - visit.sceneStart) / 1000
    while (visit.running && !visit.leaving && visit.stepIndex < visit.steps.length && visit.steps[visit.stepIndex].at <= t) {
      var s = visit.steps[visit.stepIndex]
      visit.stepIndex++
      visit.act(s)
    }
    if (visit.running && !visit.leaving && visit.stepIndex < visit.steps.length) {
      stepTimer.interval = Math.max(20, Math.round((visit.steps[visit.stepIndex].at - t) * 1000))
      stepTimer.restart()
    }
  }

  function act(s) {
    var host = visit.host, friend = visit.friend, at = visit.where
    var h = host.spot()
    switch (s.act) {
    case "notice":
      // The buddy turns toward the portal with a "!".
      host.face(at.side)
      host.express("bang", "wide", 0.9)
      host.glance(at.x, at.y - 20, 9)
      break
    case "greet":
      host.face(at.side)
      friend.face(-at.side)
      if (h) friend.glance(h.x, h.y - 20, 8)
      host.express(s.emote, "happy", 1.3)
      friend.express(s.emote, "happy", 1.3)
      break
    case "special":
      (s.who === "host" ? host : friend).specialOrCheer()
      break
    case "cheer":
      host.react("cheer")
      friend.react("cheer")
      break
    case "bye":
      host.express("heart", "happy", 1.2)
      friend.express("heart", "happy", 1.2)
      break
    case "leave":
      visit.leave()
      break
    }
  }

  // The friend turns away and steps into a portal; the visit ends when it's gone.
  function leave() {
    if (!visit.running || visit.leaving) return
    visit.leaving = true
    stepTimer.stop()
    visit.host.setVisit(false)
    if (visit.where) visit.friend.face(visit.where.side)
    visit.friend.portalOut()
    leaveTimeout.restart()
  }

  // Ends a visit early. Out of sight (hidden, fullscreen, screen sharing, a
  // monitor switch) the friend just vanishes; otherwise it startles and leaves.
  function abort(reason) {
    if (!visit.running) return
    var instant = ["hidden", "fullscreen", "screencast", "monitor", "not placed"].indexOf(reason) >= 0 || !visit.friend.active
    if (instant) {
      visit.leaving = true
      visit.friend.vanish()
      visit.finish()
      return
    }
    if (visit.leaving) return
    visit.friend.express("bang", "wide", 0.6)
    visit.leave()
  }

  function finish() {
    if (!visit.running) return
    stepTimer.stop()
    leaveTimeout.stop()
    visit.running = false
    visit.leaving = false
    visit.host.setVisit(false)
    visit.state = VisitJs.visited(visit.state, Date.now(), visit.friendId, Math.random)
    visit.retryAt = 0
    visit.friend.reset()
    visit.friendSkin = null
    visit.friendId = ""
    visit.where = null
    visit.persist()
  }
}
