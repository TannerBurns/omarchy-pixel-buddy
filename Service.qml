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
import "js/Power.js" as Power
import "js/Sprite.js" as Sprite
import "js/Glyphs.js" as Glyphs
import "js/Stats.js" as Stats

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

  readonly property string version: "0.4.0"
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

  // "bar" or "plugins": where Omarchy keeps this plugin's entry. A bar entry
  // (once the plugin has a bar widget) wins, the way the shell writes it.
  property string entryHome: ""
  property string barSection: ""     // "left" | "center" | "right" while the icon is on the bar

  function readEntry(text) {
    if (root.pendingEntry) return
    try {
      var found = SettingsJs.findEntry(JSON.parse(text), root.pluginId)
      root.entryHome = found.home
      root.barSection = found.section
      root.rawEntry = found.entry
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
    root.stats = Stats.restore(s.stats, Roster.dayKey(new Date()))
    visit.restore(s.visit)
    root.stateLoaded = true
    focusTimer.restore(s.focus)
    root.pickDaily()
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
    s.focus = focusTimer.state
    s.stats = root.stats
    s.visit = visit.state
    root.store = s
    stateFile.setText(JSON.stringify(s, null, 2) + "\n")
  }

  // ---------------------------------------------------------------- characters

  Characters { id: characters; customDir: root.customDir }
  // Exposed for the menu (ids aren't visible outside this file).
  readonly property var registry: characters
  readonly property var coachRef: coach

  function hex(c) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? "0" + s : s }
    return "#" + h(c.r) + h(c.g) + h(c.b)
  }
  readonly property var themeColors: ({ accent: root.hex(Color.accent), foreground: root.hex(Color.foreground), background: root.hex(Color.background) })

  property string dailyId: ""

  readonly property string characterId: {
    var want = root.settings.character
    if (want !== "daily" && characters.byId[want]) return want
    if (root.dailyId && characters.byId[root.dailyId]) return root.dailyId
    var ids = characters.ids
    return ids.length > 0 && characters.byId[ids[0]] ? ids[0] : ""
  }
  readonly property var character: root.characterId ? characters.byId[root.characterId] || null : null

  // What is on screen. It follows characterId through a portal handoff: the
  // old character walks into a portal and the new one steps out (requestSwap,
  // applied on the world's "gap" event). Keyed on the id, so saving a custom
  // character file still updates its art live.
  property string shownId: ""
  readonly property var shownCharacter: (root.shownId && characters.byId[root.shownId]) || root.character
  readonly property var skin: root.shownCharacter
    ? ({ character: root.shownCharacter, colors: Schema.resolveColors(root.shownCharacter, root.settings.colors, root.themeColors) })
    : null
  property real placedAt: 0

  onCharacterIdChanged: root.requestSwap()

  function requestSwap() {
    var want = root.characterId
    if (!want || want === root.shownId) { controller.clearSwap(); swapDeadline.stop(); return }
    visit.abort("swap")
    var animate = root.placed && Date.now() - root.placedAt > 3000 && controller.active && !root.hidden
      && !senses.userIdle && root.settings.warp !== "none" && controller.worldState !== "carried" && controller.worldState !== "away"
      && !!characters.byId[root.shownId]
    if (!animate) { root.applySwap(); return }
    controller.requestSwap()
    swapDeadline.restart()
  }

  function applySwap() {
    if (root.characterId && root.shownId !== root.characterId) root.shownId = root.characterId
    controller.clearSwap()
    swapDeadline.stop()
  }

  // Safety net: a swap that never found a calm moment happens in place.
  Timer { id: swapDeadline; interval: 8000; onTriggered: root.applySwap() }

  // Picks today's surprise; a change mid-session plays the portal handoff.
  function pickDaily() {
    if (!root.stateLoaded || !characters.ready) return
    var ids = characters.ids.filter(function (id) { return !!characters.byId[id] })
    if (ids.length === 0) return
    var t = Roster.today(ids, new Date(), root.store.daily)
    if (t.id === root.dailyId) return
    var s = Object.assign({}, root.store)
    s.daily = { date: t.date, id: t.id }
    root.store = s
    root.dailyId = t.id
    root.saveState()
  }

  Connections {
    target: characters
    function onReadyChanged() { root.pickDaily(); root.tryPlace() }
    function onRevisionChanged() { if (characters.ready) root.pickDaily() }
  }

  // Today (days turn at 04:00) and whether it's past bedtime, kept current.
  property string todayKey: Roster.dayKey(new Date())
  property bool night: false

  SystemClock {
    precision: SystemClock.Minutes
    onDateChanged: {
      root.todayKey = Roster.dayKey(new Date())
      root.pickDaily()
      focusTimer.advance()
      root.night = Wellbeing.isNight(new Date(), root.settings.bedtime)
      controller.setFlags({ night: root.night })
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
    root.goToScreen(f)
  }

  // Portals over to another monitor (instantly while hidden or covered).
  function goToScreen(name) {
    if (name === root.screenName) return
    var from = root.screen, to = null
    for (var i = 0; i < Quickshell.screens.length; i++) if (Quickshell.screens[i].name === name) to = Quickshell.screens[i]
    if (!to) return
    var dir = from && to.x < from.x ? -1 : 1
    visit.abort("monitor")
    if (root.hidden || !controller.active) { root.screenName = name; return }
    controller.monitorSwitch(dir, name)
  }

  // ---------------------------------------------------------------- the buddy

  property bool animationsOn: true
  readonly property bool screencastHide: senses.screencast && root.settings.screencast === "hide"
  readonly property bool covered: senses.fullscreen && !root.settings.overFullscreen
  readonly property bool saver: Power.isSaver(root.settings.batterySaver, senses.batteryPowered)
  readonly property var policy: Power.policy(root.saver)

  Senses {
    id: senses
    screen: root.screen
    sprite: controller.spriteSize
    learned: root.store.perches || ({})
    followCursor: root.settings.followCursor
    awake: !root.hidden && !root.covered && !senses.userIdle && !root.focusAway
    napPending: coach.waitingForPause
    policy: root.policy

    onEnvChanged: { controller.setEnv(senses.env); visit.syncEnv(); root.tryPlace() }
    onWorkspaceSwitched: function (dir, kind) { visit.abort("workspace"); controller.workspaceSwitch(dir, kind) }
    onWindowFocused: controller.focusMoved()
    onFocusSettled: controller.focusMoved()
    onWindowOpened: function (at) { controller.notify("open", at) }
    onUrgentWindow: controller.notify("urgent", senses.env.mon ? { x: senses.env.mon.left + 120, y: senses.env.mon.top } : null)
    onNotificationArrived: controller.notify("notification", senses.env.mon ? { x: senses.env.mon.right - 120, y: senses.env.mon.top + 40 } : null)
    onCursorMoved: function (x, y) { controller.setCursor(x, y) }
    onUserIdleChanged: controller.userIdle(senses.userIdle)
    onMoodChanged: controller.setMood(senses.mood, Activity.MOOD_PROP[senses.mood], Activity.MOOD_EMOTE[senses.mood])
    onBatteryEvent: function (kind) {
      if (!root.settings.battery) return
      controller.react(kind === "critical" ? "flop" : kind === "charging" ? "charging" : "battery")
    }
    onBatteryLowChanged: controller.setFlags({ tired: senses.batteryLow && root.settings.battery })
  }

  Controller {
    id: controller
    skin: root.skin
    policy: root.policy
    portalColors: Portal.themeColors(root.themeColors.accent, Schema.hslToHex, function (h) { var c = Schema.hexToRgb(h); return Schema.rgbToHsl(c[0], c[1], c[2]) })
    px: root.settings.scale
    mode: root.settings.mode
    calm: root.settings.motion === "calm" || !root.animationsOn || (senses.screencast && root.settings.screencast === "calm")
    warp: root.settings.warp
    personality: root.settings.personality
    active: !root.hidden && !root.covered && !root.screencastHide
    onWorldEvent: function (ev) { root.worldEvent(ev) }
  }

  // ---------------------------------------------------------------- friends

  // A visiting friend: its own scripted Controller, with no world (and so
  // nothing running) between visits. Its events go to the visit only.
  Controller {
    id: friendCtl
    scripted: true
    personality: false
    skin: visit.friendSkin
    policy: root.policy
    portalColors: controller.portalColors
    px: root.settings.scale
    mode: root.settings.mode
    calm: controller.calm
    warp: root.settings.warp
    active: visit.running && !root.hidden && !root.covered && !root.screencastHide
  }

  Visit {
    id: visit
    settings: root.settings
    host: controller
    friend: friendCtl
    registry: characters
    themeColors: root.themeColors
    shownId: root.shownId
    night: root.night
    env: senses.env
    startedAt: root.startedAt
    conditions: ({
      placed: root.placed, hidden: root.hidden || root.screencastHide, covered: root.covered,
      screencast: senses.screencast && root.settings.screencast !== "normal", focusing: focusTimer.focusing,
      idle: senses.userIdle, bubble: coach.active
    })
    onPersist: root.saveState()
  }

  // IPC and the menu: a friend comes over now ("random" or a character id),
  // even with automatic visits off.
  function inviteFriend(id) {
    var a = String(id || "random").trim().toLowerCase()
    if (root.hidden) return "hidden"
    return visit.start(a)
  }

  property bool placed: false

  Connections {
    target: controller
    function onWorldChanged() { root.tryPlace() }
  }

  // Waits for the characters so a pinned character doesn't appear as another
  // and then swap at login (a pinned custom file gets 3 s to show up).
  Timer { id: placeRetry; interval: 3100; onTriggered: root.tryPlace() }

  function tryPlace() {
    if (root.placed || !root.stateLoaded || !characters.ready || !root.skin || !senses.env.mon || !controller.world) return
    var want = root.settings.character
    if (want !== "daily" && !characters.byId[want] && Date.now() - root.startedAt < 3000) { placeRetry.restart(); return }
    var saved = root.store.positions ? root.store.positions[root.screenName] : null
    var pos = saved && saved.mode === root.settings.mode ? { x: saved.x, y: saved.y } : null
    controller.setEnv(senses.env)
    controller.setMood(senses.mood, Activity.MOOD_PROP[senses.mood], Activity.MOOD_EMOTE[senses.mood])
    root.night = Wellbeing.isNight(new Date(), root.settings.bedtime)
    controller.setFlags({ night: root.night, tired: senses.batteryLow && root.settings.battery })
    root.shownId = root.characterId
    controller.setFlags({ focusing: focusTimer.focusing })
    controller.place(pos)
    controller.setWear(root.worn)
    controller.setHidden(root.hidden || root.screencastHide)
    root.placedAt = Date.now()
    root.placed = true
  }

  function worldEvent(ev) {
    switch (ev.type) {
    case "gap":
      root.applySwap()
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
    case "arrived":
      root.runPendingSummon()
      root.saveState()
      break
    case "dropped":
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

  // Theme changes: a spin (theme-tinted buddies recolor mid-spin). Color's
  // shellValues is reassigned exactly when the shell applies a theme; only a
  // real color change counts, and never in the first seconds after startup.
  property string themeKey: ""
  Timer { id: themeDebounce; interval: 400; onTriggered: root.themeChanged() }
  Connections {
    target: Color
    function onShellValuesChanged() { themeDebounce.restart() }
  }
  function themeChanged() {
    var key = root.themeColors.accent + root.themeColors.foreground + root.themeColors.background
    var changed = root.themeKey !== "" && key !== root.themeKey
    root.themeKey = key
    if (changed && Date.now() - root.startedAt > 10000) controller.react("spin")
  }

  onSettingsChanged: {
    root.night = Wellbeing.isNight(new Date(), root.settings.bedtime)
    controller.setFlags({ night: root.night, tired: senses.batteryLow && root.settings.battery })
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
    focusing: focusTimer.focusing
    onPersist: root.saveState()
    onAnswered: function (kind, id) {
      if (kind === "focus-break" && id === "stretch") coach.offerStretch(true)
      else if (kind === "focus-again" && id === "again") focusTimer.again()
      else if (kind === "focus-again" && id === "stop") focusTimer.stop()
      else if (kind === "unlock" && id === "wear") root.wear(root.offeredUnlock)
    }
    onActiveTick: function (seconds) {
      if (root.settings.stats) root.stats = Stats.addActivity(root.stats, Roster.dayKey(new Date()), senses.category, seconds)
    }
    onStretchDone: root.recordStat("stretch")
  }

  // ---------------------------------------------------------------- stats

  // Counts and the wardrobe (js/Stats.js): what kind of work your active time
  // went to (categories only, for the last 7 days), Done stretches, finished
  // focus rounds, the day streak and the accessories they unlock. Local only.
  property var stats: Stats.create()
  readonly property var worn: Stats.worn(root.stats)
  onWornChanged: controller.setWear(root.worn)

  function recordStat(kind) {
    if (!root.settings.stats) return
    var r = kind === "focus" ? Stats.recordFocus(root.stats, Roster.dayKey(new Date())) : Stats.recordStretch(root.stats, Roster.dayKey(new Date()))
    root.stats = r.state
    if (r.unlocked.length > 0) root.pendingUnlocks = root.pendingUnlocks.concat(r.unlocked)
    root.saveState()
  }

  // A new accessory gets its own bubble once the buddy is free (after the
  // stretch or the focus break that earned it).
  property var pendingUnlocks: []
  property string offeredUnlock: ""
  Timer {
    interval: 4000
    repeat: true
    running: root.pendingUnlocks.length > 0
    onTriggered: root.offerUnlock()
  }
  function offerUnlock() {
    if (coach.active || !root.placed || root.hidden || root.covered || root.screencastHide || root.focusAway || visit.running) return
    var id = root.pendingUnlocks[0]
    var m = Stats.milestone(id)
    if (!m) { root.pendingUnlocks = root.pendingUnlocks.slice(1); return }
    if (!coach.offer("unlock", {
      title: "Unlocked: " + m.name,
      body: "For " + m.label + ". Want to wear it?",
      buttons: [{ id: "wear", label: "Wear it", primary: true }, { id: "later", label: "Not now" }],
      react: "celebrate"
    })) return
    root.offeredUnlock = id
    root.pendingUnlocks = root.pendingUnlocks.slice(1)
  }

  // id: an unlocked accessory, or "none" to take everything off.
  function wear(id) {
    var r = Stats.wear(root.stats, String(id || "").trim().toLowerCase())
    if (!r.ok) return r.error
    root.stats = r.state
    root.saveState()
    return "ok"
  }
  // The menu's wardrobe tiles put things on and take them off.
  function toggleWear(id) {
    if (root.worn.indexOf(id) >= 0) { root.stats = Stats.takeOff(root.stats, id); root.saveState(); return "ok" }
    return root.wear(id)
  }
  // Any accessory for ten seconds, unlocked or not.
  function previewAccessory(id) {
    var a = String(id || "").trim().toLowerCase()
    if (!Glyphs.ACCESSORIES[a]) return "unknown accessory '" + a + "' (" + Object.keys(Glyphs.ACCESSORIES).join(", ") + ")"
    if (root.hidden) return "hidden"
    controller.preview(a, 10)
    return "ok"
  }
  function resetStats() { root.stats = Stats.reset(); root.pendingUnlocks = []; root.saveState(); return "ok" }

  // For the menu and the bar.
  readonly property var statsSummary: Stats.summary(root.stats, root.todayKey)
  function minutesText(m) { return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m" }
  readonly property string statsLine: {
    if (!root.settings.stats) return ""
    var t = root.statsSummary.today
    var parts = []
    if (t.activeMinutes > 0) parts.push(root.minutesText(t.activeMinutes) + (t.top.length > 0 ? ", mostly " + t.top[0].category : ""))
    parts.push(t.stretches + (t.stretches === 1 ? " stretch" : " stretches"))
    if (t.focus > 0) parts.push(t.focus + (t.focus === 1 ? " focus round" : " focus rounds"))
    if (root.statsSummary.streak.cur > 1) parts.push(root.statsSummary.streak.cur + "-day streak")
    return "Today: " + parts.join(" · ")
  }
  // The wardrobe, in menu order: { id, name, unlocked, worn, text, fits }.
  readonly property var wardrobe: Stats.progress(root.stats, root.todayKey).map(function (p) {
    var m = Stats.milestone(p.id)
    return { id: p.id, name: m ? m.name : p.id, unlocked: p.unlocked, worn: root.worn.indexOf(p.id) >= 0, text: p.text,
             fits: !root.shownCharacter || Sprite.fits(root.shownCharacter, p.id, Glyphs) }
  })

  // ---------------------------------------------------------------- focus

  FocusTimer {
    id: focusTimer
    settings: root.settings
    dndOn: senses.dnd
    // Every transition is saved right away (a restart mid-focus resumes it).
    onPersist: if (root.stateLoaded) root.flushState()
    onEvent: function (name) { root.focusEvent(name) }
    onFocusingChanged: {
      controller.setFlags({ focusing: focusTimer.focusing })
      if (!focusTimer.focusing || !coach.active) return
      // Starting a round puts away an open stretch (for later) or focus bubble.
      if (coach.kind === "stretch") coach.answer("later")
      else if (coach.kind === "focus-break" || coach.kind === "focus-again") coach.answer("replaced")
    }
  }

  // During focus the buddy waits up on the bar (when this monitor's bar has its
  // icon) and draws nothing on your windows; the icon shows its face and the
  // minutes left. Without an icon it stays down, sitting with its tomato timer.
  readonly property bool focusAway: focusTimer.focusing && root.barPresent && root.placed
  property real backAt: 0
  onFocusAwayChanged: root.syncAway()
  function syncAway() {
    // Straight up without the jump while it's just appearing (a restart in
    // the middle of a round).
    if (root.focusAway) controller.goAway(Date.now() - root.placedAt < 1500)
    else if (controller.comeBack(root.barAnchorX())) root.backAt = Date.now()
  }

  // The break bubble waits for the buddy to land after dropping back down.
  Timer { id: breakOffer; interval: 1600; onTriggered: root.offerFocusBreak() }
  function offerFocusBreak() {
    if (!coach.offer("focus-break", {
      title: "Focus round done!",
      body: "Time for a " + root.settings.focusBreakMinutes + "-minute break. Stretch with me?",
      buttons: [{ id: "stretch", label: "Stretch", primary: true }, { id: "skip", label: "Skip" }],
      react: "celebrate", force: true
    })) controller.react("celebrate")
  }

  function focusEvent(name) {
    if (name === "focus-done") {
      root.recordStat("focus")
      // Before the buddy is placed (catching up after a restart) a bubble has
      // nowhere to point; the timer moves on regardless.
      if (!root.placed) return
      if (Date.now() - root.backAt < 1000) breakOffer.restart()
      else root.offerFocusBreak()
    } else if (name === "break-done") {
      if (root.placed) coach.offer("focus-again", {
        title: "Break's over",
        body: "Another round?",
        buttons: [{ id: "again", label: "Another round", primary: true }, { id: "stop", label: "Done for now" }],
        react: "wake", force: true
      })
    } else if (name === "ask-expired") {
      if (coach.active && coach.kind === "focus-again") coach.answer("expired")
    }
  }

  // ---------------------------------------------------------------- git

  GitWatcher {
    id: gitWatcher
    watching: root.settings.gitCelebrate
    roots: root.settings.gitRoots
    buddyVisible: root.placed && !root.hidden && !root.covered && !root.screencastHide && !root.focusAway
    focusing: focusTimer.focusing
    controller: controller
  }

  function gitAction(action) {
    var a = String(action || "").trim().toLowerCase()
    if (a === "status") return JSON.stringify(gitWatcher.status())
    if (a === "rescan") { gitWatcher.rescan(); return "ok" }
    return "unknown action '" + a + "' (status or rescan)"
  }

  // IPC and menu: start | stop | toggle | status | a number of minutes.
  function focusAction(action) {
    var a = String(action || "").trim().toLowerCase()
    if (a === "status") return JSON.stringify(root.focusStatus())
    if (a === "stop") { focusTimer.stop(); return "stopped" }
    if (a === "start") { focusTimer.start(); return focusTimer.label }
    if (a === "toggle") { focusTimer.toggle(); return focusTimer.running ? focusTimer.label : "stopped" }
    if (/^[0-9]+$/.test(a)) {
      var n = parseInt(a, 10)
      if (n < 1 || n > 180) return "minutes must be 1-180"
      focusTimer.start(n)
      return focusTimer.label
    }
    return "unknown action '" + a + "' (start, stop, toggle, status or minutes)"
  }

  // For the menus and the bar icon.
  readonly property bool focusRunning: focusTimer.running
  readonly property string focusLabel: focusTimer.label

  function focusStatus() {
    var f = focusTimer.state
    return { phase: f.phase, minutesLeft: focusTimer.minutesLeft, round: f.round, dnd: f.dnd, label: focusTimer.label }
  }

  BuddyWindow {
    id: buddyWindow
    controller: controller
    friend: friendCtl
    coach: coach
    targetScreen: root.screen
    overFullscreen: root.settings.overFullscreen
    onMenuRequested: function (x, y) { menu.fromClick = true; menu.anchorRect = Qt.rect(x, y, 1, 1); menu.open = true }
    onPetted: if (coach.active && coach.collapsed) coach.collapsed = false
  }

  BuddyMenu {
    id: menu
    service: root
    anchorWindow: buddyWindow
  }

  // ---------------------------------------------------------------- bar widget

  // BarWidget.qml finds this service through bar.shell.serviceFor() and checks
  // apiVersion first: after an update the shell keeps this (older) service
  // loaded until it restarts, while the widget reloads at once. 2: the menu
  // reads the friends, stats and wardrobe properties.
  readonly property int apiVersion: 2
  readonly property bool barIcon: root.settings.barIcon
  readonly property string barText: focusTimer.focusing || focusTimer.phase === "break" ? focusTimer.minutesLeft + "m" : ""

  // The face on the bar: the character on screen, its expression following
  // what the buddy is up to (coarse signals only, never window titles).
  readonly property string barExpression: senses.userIdle || controller.worldState === "sleep" ? "closed"
    : focusTimer.focusing ? "focused" : senses.batteryLow && root.settings.battery ? "sleepy" : "open"
  readonly property var barFace: {
    if (!root.skin) return null
    var opts = { character: root.skin.character, colors: root.skin.colors, glyphs: Glyphs, expression: root.barExpression }
    var bare = Sprite.compose(opts)
    var dressed = Sprite.compose(Object.assign({}, opts, { accessories: root.worn }))
    // A hat adds rows on top: keep the whole face under it.
    var extra = bare.bbox && dressed.bbox ? Math.max(0, bare.bbox.y0 - dressed.bbox.y0) : 0
    return Sprite.crop(dressed, 12 + extra)
  }

  readonly property string barTooltip: {
    void coach.revision
    var lines = [(root.character ? root.character.name : "Pixel Buddy") + (root.hidden ? " (hidden)" : "")]
    if (focusTimer.running) lines.push(focusTimer.label)
    if (root.settings.wellbeing) lines.push("Next stretch: " + coach.remainingText())
    if (root.statsLine) lines.push(root.statsLine)
    lines.push(root.focusAway ? "Middle-click: stop focus · Right: menu" : "Click: call over · Middle: focus · Right: menu")
    return lines.join("\n")
  }

  // Each bar's icon (one per monitor) registers itself: focus then knows
  // there's a place up on the bar to go, and where to come back down from.
  property var barIcons: []
  function registerBarIcon(item) { if (root.barIcons.indexOf(item) < 0) root.barIcons = root.barIcons.concat([item]) }
  function unregisterBarIcon(item) { root.barIcons = root.barIcons.filter(function (i) { return i !== item }) }
  function barIconOn(name) {
    for (var i = 0; i < root.barIcons.length; i++) {
      var it = root.barIcons[i]
      if (it && it.shown && it.screenName() === name) return it
    }
    return null
  }
  readonly property bool barPresent: root.settings.barIcon && root.barIconOn(root.screenName) !== null
  function barAnchorX() { var it = root.barIconOn(root.screenName); return it ? it.iconX() : -1 }

  // Moves the icon to another bar section (Omarchy's `omarchy bar move`).
  function moveBar(section) {
    if (["left", "center", "right"].indexOf(section) < 0) return "section must be left, center or right"
    if (root.entryHome !== "bar") return "the icon isn't on the bar (see scripts/add-to-bar.sh)"
    if (section === root.barSection) return "ok"
    barMove.command = ["omarchy-bar", "move", root.pluginId, "--section", section]
    barMove.running = true
    return "ok"
  }
  Process { id: barMove }

  // name: "summon" | "focus". `screenName` and `x` say where the icon was
  // clicked; a bar on another monitor first brings the buddy over there.
  property var pendingSummon: null
  function barAction(name, screenName, x) {
    if (name === "focus") return root.focusAction("toggle")
    if (name !== "summon") return "unknown"
    if (root.focusAway) return "focusing"
    if (root.hidden) root.setHidden(false)
    if (!root.placed) return "busy"
    if (screenName && screenName !== root.screenName) {
      root.pendingSummon = { screen: screenName, x: x, until: Date.now() + 6000 }
      root.goToScreen(screenName)
      return "ok"
    }
    return controller.summon(x >= 0 ? x : controller.position().x) ? "ok" : "busy"
  }

  function runPendingSummon() {
    var p = root.pendingSummon
    if (!p || p.screen !== root.screenName) return
    root.pendingSummon = null
    if (Date.now() < p.until) controller.summon(p.x)
  }

  // ---------------------------------------------------------------- status

  readonly property string statusLine: {
    var m = root.settings.mode
    return m.charAt(0).toUpperCase() + m.slice(1) + " · " + senses.mood
  }
  readonly property string wellbeingLine: {
    void coach.revision
    if (!root.settings.wellbeing) return "Stretch reminders are off."
    var s = coach.session
    var parts = ["Next stretch: " + coach.remainingText()]
    if (s.doneDay === Roster.dayKey(new Date()) && s.doneToday > 0) parts.push(s.doneToday + " today")
    if (s.streak > 1) parts.push(s.streak + " in a row")
    return parts.join(" · ")
  }

  function status() {
    var s = coach.session
    return {
      version: root.version, instanceId: root.instanceId, startedAt: root.startedAt,
      character: root.characterId, shown: root.shownId, name: root.character ? root.character.name : "",
      saver: root.saver, entryHome: root.entryHome,
      daily: root.settings.character === "daily", mode: root.settings.mode, hidden: root.hidden,
      state: controller.worldState, mood: senses.mood, category: senses.category,
      screen: root.screenName, size: root.settings.size, covered: root.covered,
      characters: characters.ids.length, problems: Object.keys(characters.problems).length,
      wellbeing: { enabled: root.settings.wellbeing, next: coach.remainingText(), activeMinutes: Math.round(s.activeMs / 60000),
                   doneToday: s.doneDay === Roster.dayKey(new Date()) ? s.doneToday : 0, streak: s.streak, offering: coach.active },
      focus: root.focusStatus(),
      git: gitWatcher.status(),
      personality: root.settings.personality ? (controller.describe().personality || "generic") : "off",
      friends: visit.status(),
      stats: { enabled: root.settings.stats, today: root.statsSummary.today, streak: root.statsSummary.streak,
               unlocked: root.stats.unlocked, wearing: root.worn }
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
      idle: senses.userIdle, battery: senses.battery,
      friend: visit.running ? { id: visit.friendId, world: friendCtl.describe(), at: visit.where } : null
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
      visit.abort("reset")
      var s = Object.assign({}, root.store)
      s.positions = {}
      s.perches = {}
      root.store = s
      controller.place(null)
      if (root.focusAway) controller.goAway(true)
      root.saveState()
      return "ok"
    }
    function warp(dir: string): string {
      controller.workspaceSwitch(dir === "left" ? -1 : 1, dir === "down" ? "floor" : "side")
      return "ok"
    }
    function react(name: string): string { return controller.reactChecked(name) ? "ok" : "unknown" }
    function focus(action: string): string { return root.focusAction(action) }
    function git(action: string): string { return root.gitAction(action) }
    function bar(section: string): string { return root.moveBar(section) }
    function friend(id: string): string { return root.inviteFriend(id) }
    function stats(): string { return JSON.stringify(Stats.summary(root.stats, root.todayKey)) }
    function wear(id: string): string { return root.wear(id) }
    function preview(id: string): string { return root.previewAccessory(id) }
    function resetStats(): string { return root.resetStats() }
    function answer(id: string): string { if (!coach.active) return "none"; coach.answer(id); return "ok" }
    function menu(): string {
      var h = controller.hitbox
      menu.fromClick = false
      menu.anchorRect = Qt.rect(h.x + h.width / 2, h.y, 1, 1)
      menu.open = !menu.open
      return menu.open ? "open" : "closed"
    }
  }

  Process {
    command: ["hyprctl", "getoption", "animations:enabled", "-j"]
    running: true
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: { try { var j = JSON.parse(text); root.animationsOn = (j.int !== undefined ? j.int : 1) !== 0 } catch (e) {} }
    }
  }

  Component.onCompleted: {
    root.followFocusedMonitor()
    root.themeKey = root.themeColors.accent + root.themeColors.foreground + root.themeColors.background
  }
}
