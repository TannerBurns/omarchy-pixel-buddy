import QtQuick
import "js/World.js" as World
import "js/Motion.js" as Motion
import "js/Platforms.js" as Platforms
import "js/Sprite.js" as Sprite
import "js/Glyphs.js" as Glyphs
import "js/Portal.js" as Portal
import "js/Personality.js" as Personality
import "js/CharacterSchema.js" as Schema

// Drives the world simulation and turns its render state into pixels. It ticks
// only when the world says something will change (`wait`), runs per-frame only
// while something moves, and repaints the sprite only when its composition
// actually changes. A second, scripted one draws a visiting friend: it has no
// world until a visit starts and drops it again (reset) when the friend leaves.
Item {
  id: ctl

  // What is drawn: a character and its resolved palette, always together (the
  // palette keys differ per character, so they must swap at the same moment).
  property var skin: null            // { character, colors }
  readonly property var character: ctl.skin ? ctl.skin.character : null
  readonly property var colors: ctl.skin ? ctl.skin.colors : ({})
  property var portalColors: Portal.DEFAULT_COLORS
  property var policy: null          // battery-saver policy (js/Power.js)
  property int px: 3
  property string mode: "hopper"
  property bool calm: false
  property string warp: "portal"
  property bool active: true         // false while hidden or covered
  property bool personality: true    // the character's personality (the `personality` setting)
  property bool scripted: false      // a visiting friend: never decides by itself

  // Render outputs
  property var view: ({ visible: false, x: 0, y: 0 })
  property var sprite: ({ runs: [], w: 0, h: 0, ox: 0, oy: 0, bbox: null })
  property var portals: []           // [{ x, y, runs, w, h }] top-left in logical px
  property var emote: null           // { runs, w, h, x, y }
  property rect hitbox: Qt.rect(0, 0, 0, 0)
  property rect bounds: Qt.rect(0, 0, 0, 0)   // everything visible (for visibleMask)
  property string worldState: "idle"

  signal worldEvent(var ev)

  property var world: null
  property bool fast: false
  property real lastMs: 0
  property string composeKey: ""

  readonly property var metrics: ctl.character ? ctl.metricsFor(ctl.character, ctl.px) : null

  function metricsFor(ch, k) {
    var body = Sprite.frameBox(ch, "idle", 0)
    var hang = Sprite.frameBox(ch, "hang", 0)
    var fps = {}, frames = {}
    for (var p in ch.poses) { fps[p] = ch.poses[p].fps; frames[p] = ch.poses[p].frames.length }
    var sp = ch.poses.special || {}
    return { k: k, w: ch.w, h: ch.h, body: body, hangTop: hang.y0, motion: ch.motion, floats: ch.floats,
             flies: ch.flies, speed: ch.speed, fps: fps, frames: frames,
             special: { travel: sp.travel || 0, emote: sp.emote || null, duration: sp.duration || null },
             personality: ctl.personality && !ctl.scripted ? Personality.normalize(ch.personality).personality : null }
  }

  // Logical size of the body (for ledges/perches).
  readonly property var spriteSize: ctl.metrics
    ? { w: (ctl.metrics.body.x1 - ctl.metrics.body.x0 + 1) * ctl.px, h: (ctl.metrics.h - ctl.metrics.body.y0) * ctl.px }
    : { w: 42, h: 39 }

  function ensureWorld() {
    if (ctl.world || !ctl.metrics) return
    ctl.world = World.create({ motion: Motion, platforms: Platforms, personalities: Personality, metrics: ctl.metrics,
                               mode: ctl.mode, calm: ctl.calm, warp: ctl.warp, scripted: ctl.scripted })
    World.setFlags(ctl.world, { saver: !!(ctl.policy && ctl.policy.saver), policy: ctl.policy })
  }

  onMetricsChanged: {
    if (!ctl.metrics) return
    if (!ctl.world) ensureWorld()
    else World.setMetrics(ctl.world, ctl.metrics)
    ctl.composeKey = ""
    kick()
  }
  onModeChanged: if (ctl.world) { World.setMode(ctl.world, ctl.mode); kick() }
  onCalmChanged: if (ctl.world) { World.setFlags(ctl.world, { calm: ctl.calm }); kick() }
  onWarpChanged: if (ctl.world) World.setFlags(ctl.world, { warp: ctl.warp })
  onColorsChanged: { ctl.composeKey = ""; publish() }
  onPolicyChanged: if (ctl.world) { World.setFlags(ctl.world, { saver: !!(ctl.policy && ctl.policy.saver), policy: ctl.policy }); kick() }
  onActiveChanged: {
    if (ctl.active) { ctl.lastMs = Date.now(); kick() }
    else { tickTimer.stop(); frames.running = false }
  }

  // ---------------------------------------------------------------- ticking

  Timer {
    id: tickTimer
    repeat: false
    onTriggered: ctl.step()
  }

  FrameAnimation {
    id: frames
    running: false
    onTriggered: ctl.step()
  }

  function kick() {
    if (!ctl.world || !ctl.active) { publish(); return }
    tickTimer.interval = 0
    tickTimer.restart()
  }

  function step() {
    if (!ctl.world) return
    var now = Date.now()
    var dt = ctl.lastMs > 0 ? (now - ctl.lastMs) / 1000 : 0
    ctl.lastMs = now
    var r = World.tick(ctl.world, dt)
    var evs = World.drain(ctl.world)
    for (var i = 0; i < evs.length; i++) ctl.worldEvent(evs[i])
    publish()
    if (!ctl.active) { frames.running = false; return }
    if (r.fast) {
      var hz = ctl.policy && ctl.policy.fastHz ? ctl.policy.fastHz : 0
      if (hz > 0) {
        // Battery saver: smooth moves at a capped rate instead of every display frame.
        frames.running = false
        tickTimer.interval = Math.round(1000 / hz)
        tickTimer.restart()
      } else {
        tickTimer.stop()
        frames.running = true
      }
    } else {
      frames.running = false
      tickTimer.interval = Math.max(30, Math.round(r.wait * 1000))
      tickTimer.restart()
    }
  }

  // ---------------------------------------------------------------- render

  function publish() {
    if (!ctl.world || !ctl.character) return
    var r = World.render(ctl.world)
    if (ctl.worldState !== r.state) ctl.worldState = r.state
    var key = JSON.stringify([ctl.character.id, r.pose, r.frame, r.expr, r.look, r.facing, r.prop, r.accessories, r.ops])
    if (key !== ctl.composeKey) {
      ctl.composeKey = key
      ctl.sprite = Sprite.compose({
        character: ctl.character, colors: ctl.colors, glyphs: Glyphs,
        pose: r.pose, frame: r.frame, expression: r.expr, look: r.look, facing: r.facing,
        prop: r.prop, accessories: r.accessories, ops: r.ops
      })
    }
    var s = ctl.sprite
    var k = ctl.px
    var left = r.x - (Sprite.PAD + ctl.character.w / 2) * k
    var top = r.y - (Sprite.PAD + ctl.character.h) * k
    var v = { visible: r.visible, x: Math.round(left), y: Math.round(top), feetX: r.x, feetY: r.y, state: r.state }
    // Assign only what changed: every reassignment re-renders the window.
    var ov = ctl.view
    if (!ov || ov.visible !== v.visible || ov.x !== v.x || ov.y !== v.y || ov.state !== v.state) ctl.view = v
    var hb = s.bbox && r.visible
      ? Qt.rect(v.x + s.bbox.x0 * k, v.y + s.bbox.y0 * k, (s.bbox.x1 - s.bbox.x0 + 1) * k, (s.bbox.y1 - s.bbox.y0 + 1) * k)
      : Qt.rect(0, 0, 0, 0)
    if (hb.x !== ctl.hitbox.x || hb.y !== ctl.hitbox.y || hb.width !== ctl.hitbox.width || hb.height !== ctl.hitbox.height) ctl.hitbox = hb

    // Portals: generated on the art grid, centered on their world position.
    var ps = []
    for (var i = 0; i < r.portals.length; i++) {
      var q = r.portals[i]
      var g = Portal.portal({ kind: q.kind, w: q.w, h: q.h, open: q.open, step: q.step, flash: q.flash, colors: ctl.portalColors })
      ps.push({ runs: g.runs, w: g.w, h: g.h, x: Math.round(q.x - g.cx * k), y: Math.round(q.y - g.cy * k) })
    }
    if (ps.length > 0 || ctl.portals.length > 0) ctl.portals = ps

    // Emote above the head, bobbing on whole pixels.
    if (r.emote && Glyphs.EMOTES[r.emote.id]) {
      var em = Glyphs.EMOTES[r.emote.id]
      var runs = []
      var colorOf = function (c) { return em.colors[c] || null }
      for (var y = 0; y < em.rows.length; y++) {
        var row = em.rows[y]
        for (var x = 0; x < row.length; x++) {
          var c = row.charAt(x)
          if (c === ".") continue
          var col = colorOf(c)
          if (col) runs.push([y, x, 1, col])
        }
      }
      var ew = 0
      for (var e = 0; e < em.rows.length; e++) ew = Math.max(ew, em.rows[e].length)
      var headTop = s.bbox ? v.y + s.bbox.y0 * k : r.y - 16 * k
      var rise = r.emote.id === "zzz" ? (Math.floor(r.emote.age) % 3) * k : 0
      var side = r.facing > 0 ? 1 : -1
      var ne = { id: r.emote.id, runs: runs, w: ew, h: em.rows.length, x: Math.round(r.x + side * 4 * k - ew * k / 2), y: Math.round(headTop - (em.rows.length + 2) * k - rise) }
      if (!ctl.emote || ctl.emote.id !== ne.id || ctl.emote.x !== ne.x || ctl.emote.y !== ne.y) ctl.emote = ne
    } else if (ctl.emote) {
      ctl.emote = null
    }

    // Everything drawn, padded, for the compositor's visible-region hint.
    var x0 = v.x, y0 = v.y, x1 = v.x + s.w * k, y1 = v.y + s.h * k
    for (var j = 0; j < ps.length; j++) {
      x0 = Math.min(x0, ps[j].x); y0 = Math.min(y0, ps[j].y)
      x1 = Math.max(x1, ps[j].x + ps[j].w * k); y1 = Math.max(y1, ps[j].y + ps[j].h * k)
    }
    if (ctl.emote) { y0 = Math.min(y0, ctl.emote.y); x0 = Math.min(x0, ctl.emote.x); x1 = Math.max(x1, ctl.emote.x + ctl.emote.w * k) }
    var nb = Qt.rect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16)
    if (nb.x !== ctl.bounds.x || nb.y !== ctl.bounds.y || nb.width !== ctl.bounds.width || nb.height !== ctl.bounds.height) ctl.bounds = nb
  }

  // ---------------------------------------------------------------- events in

  function setEnv(env) { if (ctl.world) { World.setEnv(ctl.world, env); kick() } }
  function place(pos) { if (ctl.world) { World.place(ctl.world, pos); kick() } }
  function setMood(mood, prop, emoteId) { if (ctl.world) World.setMood(ctl.world, mood, prop, emoteId) }
  function setFlags(f) { if (ctl.world) { World.setFlags(ctl.world, f); kick() } }
  function focusMoved() { if (ctl.world) { World.focusChanged(ctl.world); kick() } }
  function workspaceSwitch(dir, kind) { if (ctl.world) { World.workspaceSwitch(ctl.world, dir, kind); kick() } }
  function monitorSwitch(dir, screenName) { if (ctl.world) { World.monitorSwitch(ctl.world, dir, screenName); kick() } }
  function portalOnNewScreen() { if (ctl.world) World.portalOnNewScreen(ctl.world) }
  function dragStart(x, y) { if (ctl.world) { World.dragStart(ctl.world, x, y, Date.now() / 1000); kick() } }
  function dragMove(x, y) { if (ctl.world) { World.dragMove(ctl.world, x, y, Date.now() / 1000); publish() } }
  function dragEnd() { if (ctl.world) { World.dragEnd(ctl.world, Date.now() / 1000); kick() } }
  function pet() { if (ctl.world) { World.pet(ctl.world); kick() } }
  function hover(on) { if (ctl.world) { World.hover(ctl.world, on); kick() } }
  function notify(kind, at) { if (ctl.world) { World.notify(ctl.world, kind, at); kick() } }
  function react(name) { if (ctl.world) { World.react(ctl.world, name); kick() } }
  function summon(x) { if (ctl.world) { var ok = World.summon(ctl.world, x); kick(); return ok } return false }
  function goAway(instant) { if (ctl.world) { World.goAway(ctl.world, !!instant); kick() } }
  function comeBack(x) { if (ctl.world) { var ok = World.comeBack(ctl.world, x); kick(); return ok } return false }
  function userIdle(idle) { if (ctl.world) { World.userIdle(ctl.world, idle); kick() } }
  function setHidden(h) { if (ctl.world) { World.setHidden(ctl.world, h); publish() } }
  function setStretch(anim) { if (ctl.world) { World.setStretch(ctl.world, anim); kick() } }
  function special() { if (ctl.world) { World.special(ctl.world); kick() } }
  function requestSwap() { if (ctl.world) { World.requestSwap(ctl.world); kick() } }
  function clearSwap() { if (ctl.world) World.clearSwap(ctl.world) }
  // Returns false for an unknown reaction name.
  function reactChecked(name) {
    if (!ctl.world) return false
    var known = World.react(ctl.world, name)
    kick()
    return known
  }

  function setCursor(x, y) {
    if (!ctl.world) return
    World.setCursor(ctl.world, x, y)
    // Re-render only if the gaze changed; publish() skips identical frames.
    publish()
  }

  // ---- visits
  function setVisit(on) { if (ctl.world) { World.setVisit(ctl.world, on); kick() } }
  function portalIn(dest, dir) { if (ctl.world) { var ok = World.portalIn(ctl.world, dest, dir); kick(); return ok } return false }
  function portalOut() { if (ctl.world) { World.portalOut(ctl.world); kick() } }
  function vanish() { if (ctl.world) { World.vanish(ctl.world); step() } }
  function face(dir) { if (ctl.world) { World.face(ctl.world, dir); publish() } }
  function glance(x, y, secs) { if (ctl.world) { World.glance(ctl.world, x, y, secs); kick() } }
  function express(emoteId, expr, secs) { if (ctl.world) { World.express(ctl.world, emoteId, expr, secs); kick() } }
  function specialOrCheer() {
    if (!ctl.world) return
    if (!World.special(ctl.world)) World.react(ctl.world, "cheer")
    kick()
  }
  // Where it stands, for placing a visitor next to it.
  function spot() {
    var w = ctl.world
    if (!w || !w.placed) return null
    return { x: w.x, y: w.y, halfW: World.halfW(w), ledge: w.support ? { x1: w.support.x1, x2: w.support.x2, kind: w.support.kind } : null,
             support: w.support, state: w.st, facing: w.facing }
  }
  function halfW() { return ctl.world ? World.halfW(ctl.world) : 0 }

  // Drops the world and everything drawn (a friend who went home).
  function reset() {
    tickTimer.stop()
    frames.running = false
    ctl.world = null
    ctl.composeKey = ""
    ctl.lastMs = 0
    ctl.view = { visible: false, x: 0, y: 0 }
    ctl.sprite = { runs: [], w: 0, h: 0, ox: 0, oy: 0, bbox: null }
    ctl.portals = []
    ctl.emote = null
    ctl.hitbox = Qt.rect(0, 0, 0, 0)
    ctl.bounds = Qt.rect(0, 0, 0, 0)
    ctl.worldState = "idle"
  }

  // ---- wardrobe
  function setWear(list) { if (ctl.world) { World.setWear(ctl.world, list); publish() } }
  function preview(id, secs) { if (ctl.world) { World.preview(ctl.world, id, secs); kick() } }

  function describe() { return ctl.world ? World.describe(ctl.world) : {} }
  function position() { return ctl.world && ctl.world.placed ? { x: ctl.world.x, y: ctl.world.y } : null }
  function home() { return ctl.world && ctl.world.home ? ctl.world.home : null }
}
