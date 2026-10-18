import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import Quickshell.Services.UPower
import Qt.labs.folderlistmodel
import "js/Platforms.js" as Platforms
import "js/Activity.js" as Activity

// Everything the buddy perceives: Hyprland (workspaces, focus, window
// geometry), idle, battery, the cursor, new notifications, Do Not Disturb,
// fullscreen and screen sharing. It turns them into an `env` for the world and
// a handful of signals. Window titles are classified and dropped, never kept.
Item {
  id: senses

  // Inputs
  property var screen: null                // the ShellScreen the buddy lives on
  property var sprite: ({ w: 42, h: 39 })  // body size in logical px
  property var learned: ({})               // class -> { kind, fx }
  property bool followCursor: true
  property bool awake: true                // false while hidden/covered/napping
  property bool napPending: false          // wellbeing wants a natural pause

  // Outputs
  property var env: ({ mon: null, ledges: [], perch: null, focused: null })
  property string category: "desktop"
  property string mood: "playful"
  property bool fullscreen: false
  property bool screencast: false
  property bool dnd: false
  property bool userIdle: idleNap.isIdle
  property bool longIdle: idleBreak.isIdle
  property bool pause: pauseMonitor.isIdle
  property bool batteryPowered: UPower.onBattery
  property real battery: UPower.displayDevice && UPower.displayDevice.isPresent ? UPower.displayDevice.percentage : -1
  property bool discharging: !!(UPower.displayDevice && UPower.displayDevice.isPresent && UPower.onBattery
                                && UPower.displayDevice.state === UPowerDeviceState.Discharging)
  property bool batteryLow: discharging && battery >= 0 && battery < 0.2
  property int border: 2
  property int activeWorkspace: 0
  property string focusedMonitorName: Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""

  signal workspaceSwitched(int dir, string kind)
  signal focusSettled()
  signal windowFocused()
  signal windowOpened(var at)
  signal urgentWindow()
  signal notificationArrived()
  signal cursorMoved(real x, real y)
  signal batteryEvent(string kind)       // "low" | "critical" | "charging"

  readonly property var hyprMonitor: senses.screen ? Hyprland.monitorFor(senses.screen) : null
  readonly property real startedAt: Date.now()

  function norm(addr) { return String(addr || "").replace(/^0x/i, "").toLowerCase() }

  // ---------------------------------------------------------------- env

  function rebuild() {
    var scr = senses.screen
    if (!scr) return
    var hm = senses.hyprMonitor
    var mobj = hm && hm.lastIpcObject ? hm.lastIpcObject : null
    var reserved = mobj && Array.isArray(mobj.reserved) ? mobj.reserved : [0, 0, 0, 0]
    var mon = Platforms.monitorRect({ x: scr.x, y: scr.y, width: scr.width, height: scr.height }, reserved)
    var ws = hm && hm.activeWorkspace ? hm.activeWorkspace.id : (mobj && mobj.activeWorkspace ? mobj.activeWorkspace.id : 0)
    senses.activeWorkspace = ws
    var ids = [ws]
    var special = mobj && mobj.specialWorkspace ? mobj.specialWorkspace.id : 0
    if (special) ids.push(special)
    var clients = []
    var tops = Hyprland.toplevels.values
    for (var i = 0; i < tops.length; i++) {
      var o = tops[i].lastIpcObject
      if (o && o.at && o.size) clients.push(o)
    }
    var rects = Platforms.clientRects(clients, mon, { monitorId: hm ? hm.id : undefined, workspaceIds: ids, border: senses.border })
    var ledges = Platforms.ledges(rects, mon, senses.sprite)
    var act = Hyprland.activeToplevel
    var addr = act ? senses.norm(act.address) : ""
    var focused = null
    for (var j = 0; j < rects.length; j++) if (senses.norm(rects[j].address) === addr) focused = rects[j]
    var perch = Platforms.perchFor(focused, ledges, senses.learned, senses.sprite, mon)
    var floating = false
    for (var f = 0; f < rects.length; f++) if (rects[f].floating) floating = true
    senses.fullscreen = !!(hm && hm.activeWorkspace && hm.activeWorkspace.hasFullscreen)
    senses.env = { mon: mon, ledges: ledges, perch: perch, focused: focused, rects: rects, floating: floating }
  }

  // Window geometry lives in HyprlandToplevel.lastIpcObject, which only updates
  // when someone asks Hyprland for clients. Omarchy doesn't, so we do: shortly
  // after anything that moves windows (and again once animations settle), plus
  // a slow poll for floating drags and tiled resizes that emit no event.
  function refreshSoon() {
    refreshA.restart()
    refreshB.restart()
  }

  Timer { id: refreshA; interval: 50; onTriggered: { Hyprland.refreshToplevels(); rebuildA.restart() } }
  Timer { id: refreshB; interval: 450; onTriggered: { Hyprland.refreshToplevels(); Hyprland.refreshMonitors(); rebuildB.restart() } }
  Timer { id: rebuildA; interval: 60; onTriggered: senses.rebuild() }
  Timer { id: rebuildB; interval: 60; onTriggered: senses.rebuild() }
  Timer {
    id: poll
    interval: senses.env.floating ? 2000 : 5000
    repeat: true
    running: senses.awake
    onTriggered: { Hyprland.refreshToplevels(); rebuildA.restart() }
  }

  onScreenChanged: { Hyprland.refreshMonitors(); refreshSoon(); senses.rebuild() }
  onSpriteChanged: senses.rebuild()
  onLearnedChanged: senses.rebuild()

  // ---------------------------------------------------------------- Hyprland events

  property int lastWorkspace: 0

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var n = event.name
      var d = String(event.data || "")
      switch (n) {
      case "workspacev2": {
        var id = parseInt(d.split(",")[0], 10)
        var hm = senses.hyprMonitor
        var mine = !hm || !Hyprland.focusedMonitor || Hyprland.focusedMonitor.name === hm.name
        if (!mine || !isFinite(id)) break
        var prev = senses.lastWorkspace
        senses.lastWorkspace = id
        if (prev === id) break
        Hyprland.refreshMonitors()
        senses.rebuild()
        var kind = id > 0 && prev > 0 ? "side" : "floor"
        senses.workspaceSwitched(id > prev ? 1 : -1, kind)
        senses.refreshSoon()
        break
      }
      case "activespecialv2": case "activespecial": {
        var parts = d.split(",")
        var monName = parts[parts.length - 1]
        if (senses.hyprMonitor && monName !== senses.hyprMonitor.name) break
        Hyprland.refreshMonitors()
        senses.refreshSoon()
        senses.workspaceSwitched(0, "floor")
        break
      }
      case "activewindow":
        senses.classifyNow(d.substring(0, d.indexOf(",") >= 0 ? d.indexOf(",") : d.length),
                           d.indexOf(",") >= 0 ? d.substring(d.indexOf(",") + 1) : "")
        break
      case "activewindowv2":
        senses.rebuild()
        senses.windowFocused()
        focusTimer.restart()
        break
      case "windowtitlev2": {
        var addr = senses.norm(d.substring(0, d.indexOf(",")))
        if (Hyprland.activeToplevel && senses.norm(Hyprland.activeToplevel.address) === addr) titleTimer.restart()
        break
      }
      case "openwindow":
        senses.refreshSoon()
        openTimer.restart()
        break
      case "closewindow": case "movewindowv2": case "changefloatingmode": case "fullscreen":
      case "moveworkspacev2": case "focusedmonv2": case "monitoraddedv2": case "monitorremovedv2":
        senses.refreshSoon()
        break
      case "configreloaded":
        borderProc.running = true
        Hyprland.refreshMonitors()
        senses.refreshSoon()
        break
      case "urgent":
        senses.urgentWindow()
        break
      case "screencast": {
        var on = d.split(",")[0] === "1"
        senses.screencast = on
        break
      }
      default:
        break
      }
    }
  }

  // Focus has to settle before the buddy hops (focus follows the mouse here).
  Timer { id: focusTimer; interval: 1500; onTriggered: senses.focusSettled() }
  Timer { id: openTimer; interval: 520; onTriggered: senses.windowOpened(senses.env.focused ? { x: senses.env.focused.x + senses.env.focused.w / 2, y: senses.env.focused.y + 40 } : null) }
  Timer {
    id: titleTimer
    interval: 1000
    onTriggered: {
      var t = Hyprland.activeToplevel
      if (t) senses.classifyNow(t.lastIpcObject && t.lastIpcObject["class"] ? t.lastIpcObject["class"] : (t.wayland ? t.wayland.appId : ""), t.title)
    }
  }

  function classifyNow(cls, title) {
    var c = Activity.classify(cls, title)
    if (c !== senses.category) senses.category = c
    var m = Activity.moodOf(c)
    if (m !== senses.mood) senses.mood = m
  }

  // ---------------------------------------------------------------- idle

  IdleMonitor { id: idleNap; enabled: true; timeout: 90; respectInhibitors: true }
  IdleMonitor { id: idleBreak; enabled: true; timeout: 300; respectInhibitors: true }
  IdleMonitor { id: pauseMonitor; enabled: senses.napPending; timeout: 3; respectInhibitors: false }

  // ---------------------------------------------------------------- battery

  property bool _wasCharging: false
  property bool _flopped: false
  onBatteryChanged: {
    if (senses.discharging && senses.battery >= 0 && senses.battery <= 0.1 && !senses._flopped) { senses._flopped = true; senses.batteryEvent("critical") }
    if (!senses.discharging) senses._flopped = false
  }
  onDischargingChanged: {
    var charging = !senses.discharging && senses.battery >= 0 && UPower.displayDevice
      && UPower.displayDevice.state === UPowerDeviceState.Charging
    if (charging && !senses._wasCharging) senses.batteryEvent("charging")
    senses._wasCharging = charging
  }

  // ---------------------------------------------------------------- cursor

  // Hyprland answers one request per connection. Hanging up ourselves right
  // after the reply avoids a PeerClosedError warning per poll in the shell log.
  property real _lastCursorMove: 0
  property real _cx: -1
  property real _cy: -1

  Socket {
    id: cursorSock
    path: Hyprland.requestSocketPath
    parser: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        var m = String(data).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
        cursorSock.connected = false
        if (!m || !senses.screen) return
        var gx = Number(m[1]), gy = Number(m[2])
        var x = gx - senses.screen.x, y = gy - senses.screen.y
        if (Math.abs(x - senses._cx) > 1 || Math.abs(y - senses._cy) > 1) {
          senses._lastCursorMove = Date.now()
          senses._cx = x
          senses._cy = y
          senses.cursorMoved(x, y)
        }
      }
    }
    onConnectionStateChanged: if (connected) { write("cursorpos"); flush() }
  }

  // Adaptive: 4 Hz while the pointer moves (2 Hz on battery), 1 Hz otherwise.
  Timer {
    id: cursorPoll
    repeat: true
    running: senses.followCursor && senses.awake
    interval: Date.now() - senses._lastCursorMove < 3000 ? (senses.batteryPowered ? 500 : 250) : 1000
    onTriggered: {
      if (!cursorSock.connected) cursorSock.connected = true
      interval = Date.now() - senses._lastCursorMove < 3000 ? (senses.batteryPowered ? 500 : 250) : 1000
    }
  }

  // ---------------------------------------------------------------- notifications

  // Omarchy writes one file per visible toast (<ms>-<id>.json). Only the
  // arrival matters; contents are never read. DND toasts skip this folder.
  readonly property string home: Quickshell.env("HOME")

  FolderListModel {
    id: toasts
    folder: "file://" + senses.home + "/.local/state/omarchy/notifications"
    nameFilters: ["*.json"]
    showDirs: false
  }

  Connections {
    target: toasts
    function onRowsInserted(parent, first, last) {
      for (var i = first; i <= last; i++) {
        var name = String(toasts.get(i, "fileName") || "")
        var ms = parseInt(name.split("-")[0], 10)
        if (isFinite(ms) && ms > senses.startedAt) { senses.notificationArrived(); break }
      }
    }
  }

  FileView {
    path: senses.home + "/.local/state/omarchy/notifications.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try {
        var v = JSON.parse(text()).dnd
        senses.dnd = v === true || (v && typeof v === "object" && (!v.until || v.until > Date.now()))
      } catch (e) { senses.dnd = false }
    }
    onLoadFailed: senses.dnd = false
  }

  // ---------------------------------------------------------------- startup

  Process {
    id: borderProc
    command: ["hyprctl", "getoption", "general:border_size", "-j"]
    running: true
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var j = JSON.parse(text)
          var v = j.int !== undefined ? j.int : j.value
          if (isFinite(v)) { senses.border = Math.max(0, Math.min(20, Number(v))); senses.rebuild() }
        } catch (e) {}
      }
    }
  }

  Component.onCompleted: {
    Hyprland.refreshMonitors()
    Hyprland.refreshToplevels()
    var t = Hyprland.activeToplevel
    if (t) senses.classifyNow(t.lastIpcObject && t.lastIpcObject["class"] ? t.lastIpcObject["class"] : (t.wayland ? t.wayland.appId : ""), t.title)
    senses.lastWorkspace = senses.hyprMonitor && senses.hyprMonitor.activeWorkspace ? senses.hyprMonitor.activeWorkspace.id : 0
    refreshSoon()
  }
}
