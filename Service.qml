import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons
import "js/Settings.js" as SettingsJs
import "js/CharacterSchema.js" as Schema
import "js/Roster.js" as Roster
import "js/Portal.js" as Portal
import "js/Activity.js" as Activity
import "js/Wellbeing.js" as Wellbeing

// Pixel Buddy: a pixel-art desktop buddy for the Omarchy shell.
//
// Omarchy mounts this service at startup once the plugin is enabled. Settings
// are read from this plugin's entry in ~/.config/omarchy/shell.json (services
// get no settings injected) and written back through the shell facade. Runtime
// state (where it sits, learned perches, the daily pick, the wellbeing
// session) lives in ~/.local/state/pixel-buddy/state.json, never inside the
// plugin folder, because any write there reloads every plugin.
Item {
  id: root

  // Injected by omarchy-shell after creation (null in Component.onCompleted).
  property var shell: null
  property var manifest: null

  readonly property string version: "0.1.0"
  readonly property string pluginId: "tannerburns.pixel-buddy"
  readonly property string home: Quickshell.env("HOME")
  property string settingsPath: root.home + "/.config/omarchy/shell.json"
  property string stateDir: root.home + "/.local/state/pixel-buddy"
  property string customDir: root.home + "/.config/pixel-buddy/characters"
  readonly property string instanceId: Math.random().toString(36).slice(2, 10)
  readonly property real startedAt: Date.now()

  // ---------------------------------------------------------------- settings

  property var rawEntry: ({})
  readonly property var settings: SettingsJs.coerce(root.rawEntry)
  property var pendingEntry: null

  FileView {
    path: root.settingsPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.readEntry(text())
  }

  function readEntry(text) {
    if (root.pendingEntry) return
    try {
      var cfg = JSON.parse(text)
      var list = Array.isArray(cfg.plugins) ? cfg.plugins : []
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === root.pluginId) { root.rawEntry = list[i]; return }
      }
      root.rawEntry = ({})
    } catch (e) {
      // Mid-write or hand-edited into invalid JSON: keep the last good settings.
    }
  }

  Timer { id: settingsWrite; interval: 500; onTriggered: root.flushSettings() }

  // Validates, applies immediately, persists (debounced) via the shell facade.
  function setSetting(key, value) {
    var parsed = SettingsJs.parseValue(String(key), String(value))
    if (!parsed.ok) return parsed.error
    var entry = SettingsJs.entryWith(root.pendingEntry || root.rawEntry, root.pluginId, key, parsed.value)
    root.pendingEntry = entry
    root.rawEntry = entry
    settingsWrite.restart()
    return "ok"
  }

  function flushSettings() {
    var entry = root.pendingEntry
    root.pendingEntry = null
    if (!entry) return
    if (root.shell && typeof root.shell.updateEntryInline === "function") root.shell.updateEntryInline(root.pluginId, entry)
  }

  // ---------------------------------------------------------------- state

  property var store: ({})
  property bool stateLoaded: false
  property bool hidden: false

  Process {
    id: mkdirs
    command: ["mkdir", "-p", root.stateDir, root.customDir]
    running: true
    onExited: characters.customDirReady = true
  }

  FileView {
    id: stateFile
    path: root.stateDir + "/state.json"
    printErrors: false
    atomicWrites: true
    onLoaded: root.loadState(text())
    onLoadFailed: root.loadState("")
  }

  function loadState(text) {
    if (root.stateLoaded) return
    var s = {}
    try { s = text ? JSON.parse(text) : {} } catch (e) { s = {} }
    if (!s || typeof s !== "object") s = {}
    if (!s.positions || typeof s.positions !== "object") s.positions = {}
    if (!s.perches || typeof s.perches !== "object") s.perches = {}
    root.store = s
    root.hidden = s.hidden === true
    coach.restore(s.wellbeing)
    root.stateLoaded = true
    root.pickDaily(true)
    root.tryPlace()
  }

  Timer { id: stateWrite; interval: 1200; onTriggered: root.flushState() }
  function saveState() { if (root.stateLoaded) stateWrite.restart() }

  function flushState() {
    var s = Object.assign({}, root.store)
    s.version = 1
    s.hidden = root.hidden
    var pos = controller.position()
    if (pos && root.screenName) {
      var p = Object.assign({}, s.positions || {})
      p[root.screenName] = { x: Math.round(pos.x), y: Math.round(pos.y), mode: root.settings.mode }
      s.positions = p
    }
    s.wellbeing = coach.session
    root.store = s
    stateFile.setText(JSON.stringify(s, null, 2) + "\n")
  }

  // ---------------------------------------------------------------- characters

  Characters { id: characters; customDir: root.customDir }

  function hex(c) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? "0" + s : s }
    return "#" + h(c.r) + h(c.g) + h(c.b)
  }
  readonly property var themeColors: ({ accent: root.hex(Color.accent), foreground: root.hex(Color.foreground), background: root.hex(Color.background) })

  property string dailyId: ""
  property string pendingDailyId: ""

  readonly property string characterId: {
    var want = root.settings.character
    if (want !== "daily" && characters.byId[want]) return want
    if (root.dailyId && characters.byId[root.dailyId]) return root.dailyId
    var ids = characters.ids
    return ids.length > 0 && characters.byId[ids[0]] ? ids[0] : ""
  }
  readonly property var character: root.characterId ? characters.byId[root.characterId] || null : null
  readonly property var colors: root.character ? Schema.resolveColors(root.character, root.settings.colors, root.themeColors) : ({})

  // Picks today's surprise. At startup it applies at once; when the day turns
  // mid-session it waits for the next portal or nap so nobody sees the swap.
  function pickDaily(immediate) {
    if (!root.stateLoaded || !characters.ready) return
    var ids = characters.ids.filter(function (id) { return !!characters.byId[id] })
    if (ids.length === 0) return
    var t = Roster.today(ids, new Date(), root.store.daily)
    if (t.id === root.dailyId) return
    var s = Object.assign({}, root.store)
    s.daily = { date: t.date, id: t.id }
    root.store = s
    if (immediate || !root.dailyId) root.dailyId = t.id
    else root.pendingDailyId = t.id
    root.saveState()
  }

  function applyPendingDaily() {
    if (root.pendingDailyId) { root.dailyId = root.pendingDailyId; root.pendingDailyId = "" }
  }

  Connections {
    target: characters
    function onReadyChanged() { root.pickDaily(true); root.tryPlace() }
    function onRevisionChanged() { if (characters.ready) root.pickDaily(false) }
  }

  SystemClock {
    precision: SystemClock.Minutes
    onDateChanged: {
      root.pickDaily(false)
      controller.setFlags({ night: Wellbeing.isNight(new Date(), root.settings.bedtime) })
    }
  }

  // ---------------------------------------------------------------- screens

  // The buddy lives on the focused monitor and portals over when focus moves.
  property string screenName: ""
  readonly property var screen: {
    var list = Quickshell.screens
    for (var i = 0; i < list.length; i++) if (list[i].name === root.screenName) return list[i]
    var f = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    for (var j = 0; j < list.length; j++) if (list[j].name === f) return list[j]
    return list.length > 0 ? list[0] : null
  }

  Connections {
    target: Hyprland
    function onFocusedMonitorChanged() { root.followFocusedMonitor() }
  }

  function followFocusedMonitor() {
    var f = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    if (!f) return
    if (!root.screenName || !root.placed) { root.screenName = f; return }
    if (f === root.screenName) return
    var from = root.screen, to = null
    for (var i = 0; i < Quickshell.screens.length; i++) if (Quickshell.screens[i].name === f) to = Quickshell.screens[i]
    if (!to) return
    var dir = from && to.x < from.x ? -1 : 1
    if (root.hidden || !controller.active) { root.screenName = f; return }
    controller.monitorSwitch(dir, f)
  }

  // ---------------------------------------------------------------- the buddy

  property bool animationsOn: true
  readonly property bool screencastHide: senses.screencast && root.settings.screencast === "hide"
  readonly property bool covered: senses.fullscreen && !root.settings.overFullscreen

  Senses {
    id: senses
    screen: root.screen
    sprite: controller.spriteSize
    learned: root.store.perches || ({})
    followCursor: root.settings.followCursor
    awake: !root.hidden && !root.covered && !senses.userIdle
    napPending: coach.waitingForPause

    onEnvChanged: { controller.setEnv(senses.env); root.tryPlace() }
    onWorkspaceSwitched: function (dir, kind) { root.applyPendingDaily(); controller.workspaceSwitch(dir, kind) }
    onWindowFocused: controller.focusMoved()
    onFocusSettled: controller.focusMoved()
    onWindowOpened: function (at) { controller.notify("open", at) }
    onUrgentWindow: controller.notify("urgent", senses.env.mon ? { x: senses.env.mon.left + 120, y: senses.env.mon.top } : null)
    onNotificationArrived: controller.notify("notification", senses.env.mon ? { x: senses.env.mon.right - 120, y: senses.env.mon.top + 40 } : null)
    onCursorMoved: function (x, y) { controller.setCursor(x, y) }
    onUserIdleChanged: { if (!senses.userIdle) root.applyPendingDaily(); controller.userIdle(senses.userIdle) }
    onMoodChanged: controller.setMood(senses.mood, Activity.MOOD_PROP[senses.mood], Activity.MOOD_EMOTE[senses.mood])
    onBatteryEvent: function (kind) {
      if (!root.settings.battery) return
      controller.react(kind === "critical" ? "flop" : kind === "charging" ? "charging" : "battery")
    }
    onBatteryLowChanged: controller.setFlags({ tired: senses.batteryLow && root.settings.battery })
  }

  Controller {
    id: controller
    character: root.character
    colors: root.colors
    portalColors: Portal.themeColors(root.themeColors.accent, Schema.hslToHex, function (h) { var c = Schema.hexToRgb(h); return Schema.rgbToHsl(c[0], c[1], c[2]) })
    px: root.settings.scale
    mode: root.settings.mode
    calm: root.settings.motion === "calm" || !root.animationsOn || (senses.screencast && root.settings.screencast === "calm")
    warp: root.settings.warp
    active: !root.hidden && !root.covered && !root.screencastHide
    onWorldEvent: function (ev) { root.worldEvent(ev) }
  }

  property bool placed: false

  Connections {
    target: controller
    function onWorldChanged() { root.tryPlace() }
  }

  function tryPlace() {
    if (root.placed || !root.stateLoaded || !root.character || !senses.env.mon || !controller.world) return
    var saved = root.store.positions ? root.store.positions[root.screenName] : null
    var pos = saved && saved.mode === root.settings.mode ? { x: saved.x, y: saved.y } : null
    controller.setEnv(senses.env)
    controller.setMood(senses.mood, Activity.MOOD_PROP[senses.mood], Activity.MOOD_EMOTE[senses.mood])
    controller.setFlags({ night: Wellbeing.isNight(new Date(), root.settings.bedtime), tired: senses.batteryLow && root.settings.battery })
    controller.place(pos)
    controller.setHidden(root.hidden || root.screencastHide)
    root.placed = true
  }

  function worldEvent(ev) {
    switch (ev.type) {
    case "gap":
      root.applyPendingDaily()
      break
    case "screen":
      root.screenName = ev.screen
      senses.rebuild()
      controller.setEnv(senses.env)
      controller.portalOnNewScreen()
      break
    case "landed":
      root.learnPerch(ev)
      root.saveState()
      break
    case "dropped": case "arrived":
      root.saveState()
      break
    }
  }

  // Where Tanner drops the buddy on (or under) the focused window becomes its
  // perch for that app.
  function learnPerch(ev) {
    if (root.settings.mode !== "hopper") return
    var f = senses.env.focused
    var sup = ev.support
    if (!f || !sup || !f.cls) return
    var kind = sup.kind === "floor" ? "floor" : sup.address === f.address ? sup.kind : ""
    if (!kind) return
    var fx = Math.max(0, Math.min(1, (ev.x - f.x) / Math.max(1, f.w)))
    var s = Object.assign({}, root.store)
    var p = Object.assign({}, s.perches || {})
    p[f.cls] = { kind: kind, fx: Math.round(fx * 1000) / 1000 }
    s.perches = p
    root.store = s
  }

  onSettingsChanged: {
    controller.setFlags({ night: Wellbeing.isNight(new Date(), root.settings.bedtime), tired: senses.batteryLow && root.settings.battery })
  }
  onScreencastHideChanged: controller.setHidden(root.hidden || root.screencastHide)

  function setHidden(h) {
    root.hidden = !!h
    controller.setHidden(root.hidden || root.screencastHide)
    if (root.hidden) buddyWindow.cancelDrag()
    root.saveState()
  }

  function stretchNow() {
    if (root.hidden) root.setHidden(false)
    return coach.offerStretch(true)
  }

  WellbeingCoach {
    id: coach
    settings: root.settings
    senses: senses
    controller: controller
    hidden: root.hidden || root.covered || root.screencastHide
    onPersist: root.saveState()
  }

  BuddyWindow {
    id: buddyWindow
    controller: controller
    coach: coach
    targetScreen: root.screen
    overFullscreen: root.settings.overFullscreen
    onMenuRequested: function (x, y) { menu.anchorRect = Qt.rect(x, y, 1, 1); menu.open = true }
    onPetted: if (coach.active && coach.collapsed) coach.collapsed = false
  }

  BuddyMenu {
    id: menu
    service: root
    anchorWindow: buddyWindow
  }

  // ---------------------------------------------------------------- status

  readonly property string statusLine: {
    var m = root.settings.mode
    return m.charAt(0).toUpperCase() + m.slice(1) + " · " + senses.mood
  }
  readonly property string wellbeingLine: {
    void coach.revision
    if (!root.settings.wellbeing) return "Stretch nudges are off."
    var s = coach.session
    var parts = ["Next stretch: " + coach.remainingText()]
    if (s.doneDay === Roster.dayKey(new Date()) && s.doneToday > 0) parts.push(s.doneToday + " today")
    if (s.streak > 1) parts.push("streak " + s.streak)
    return parts.join(" · ")
  }

  function status() {
    var s = coach.session
    return {
      version: root.version, instanceId: root.instanceId, startedAt: root.startedAt,
      character: root.characterId, name: root.character ? root.character.name : "",
      daily: root.settings.character === "daily", mode: root.settings.mode, hidden: root.hidden,
      state: controller.worldState, mood: senses.mood, category: senses.category,
      screen: root.screenName, size: root.settings.size, covered: root.covered,
      characters: characters.ids.length, problems: Object.keys(characters.problems).length,
      wellbeing: { enabled: root.settings.wellbeing, next: coach.remainingText(), activeMinutes: Math.round(s.activeMs / 60000),
                   doneToday: s.doneDay === Roster.dayKey(new Date()) ? s.doneToday : 0, streak: s.streak, offering: coach.active }
    }
  }

  function debugInfo() {
    var env = senses.env
    return {
      world: controller.describe(),
      perch: env.perch,
      focused: env.focused ? { cls: env.focused.cls, x: env.focused.x, y: env.focused.y, w: env.focused.w, h: env.focused.h } : null,
      ledges: (env.ledges || []).map(function (l) { return { id: l.id, kind: l.kind, x1: l.x1, x2: l.x2, y: l.y, cls: l.cls } }),
      mon: env.mon, perches: root.store.perches || {}, problems: characters.problems,
      cursor: [senses._cx, senses._cy], fullscreen: senses.fullscreen, dnd: senses.dnd, screencast: senses.screencast,
      idle: senses.userIdle, battery: senses.battery
    }
  }

  IpcHandler {
    target: "pixel-buddy"
    function toggle(): string { root.setHidden(!root.hidden); return root.hidden ? "hidden" : "shown" }
    function show(): string { root.setHidden(false); return "shown" }
    function hide(): string { root.setHidden(true); return "hidden" }
    function status(): string { return JSON.stringify(root.status()) }
    function debug(): string { return JSON.stringify(root.debugInfo()) }
    function character(id: string): string { return root.setSetting("character", id) }
    function mode(m: string): string { return root.setSetting("mode", m) }
    function set(key: string, value: string): string { return root.setSetting(key, value) }
    function stretch(): string { return root.stretchNow() ? "ok" : "busy" }
    function reloadCharacters(): string { characters.reloadAll(); return "ok" }
    function reset(): string {
      var s = Object.assign({}, root.store)
      s.positions = {}
      s.perches = {}
      root.store = s
      controller.place(null)
      root.saveState()
      return "ok"
    }
    function warp(dir: string): string {
      controller.workspaceSwitch(dir === "left" ? -1 : 1, dir === "down" ? "floor" : "side")
      return "ok"
    }
    function react(name: string): string { controller.react(name); return "ok" }
  }

  Process {
    command: ["hyprctl", "getoption", "animations:enabled", "-j"]
    running: true
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: { try { var j = JSON.parse(text); root.animationsOn = (j.int !== undefined ? j.int : 1) !== 0 } catch (e) {} }
    }
  }

  Component.onCompleted: root.followFocusedMonitor()
}
