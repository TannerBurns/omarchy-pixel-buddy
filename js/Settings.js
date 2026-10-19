// Settings live inline on the plugin's shell.json entry. The shell stores
// whatever the entry holds and never applies defaults, and hand edits can put
// anything there, so every value is coerced with its own fallback.
//
// One table (SPEC) drives both reading (coerce) and validating new values from
// the menu or IPC (parseValue), so a new setting is a single row.
// Plain JS (no .pragma, no .import) so node tests can require() it.

var SIZES = { small: 2, medium: 3, large: 4 }
var CATEGORIES = ["neck", "shoulders", "wrists", "back", "eyes", "legs", "breathing", "water"]
var MODES = ["hopper", "patrol", "roam", "stay"]
var COLORS = ["natural", "theme"]
var MOTIONS = ["full", "calm"]
var WARPS = ["portal", "fade", "none"]
var SCREENCAST = ["calm", "hide", "normal"]
var SAVER = ["auto", "on", "off"]

var SPEC = [
  { key: "character", type: "character", def: "daily" },
  { key: "mode", type: "enum", def: "hopper", options: MODES },
  { key: "size", type: "enum", def: "medium", options: ["small", "medium", "large"] },
  { key: "colors", type: "enum", def: "natural", options: COLORS },
  { key: "motion", type: "enum", def: "full", options: MOTIONS },
  { key: "warp", type: "enum", def: "portal", options: WARPS },
  { key: "overFullscreen", type: "bool", def: false },
  { key: "followCursor", type: "bool", def: true },
  { key: "screencast", type: "enum", def: "calm", options: SCREENCAST },
  { key: "batterySaver", type: "enum", def: "auto", options: SAVER },
  { key: "wellbeing", type: "bool", def: true },
  { key: "breakMinutes", type: "int", def: 45, min: 1, max: 480 },
  { key: "stretches", type: "categories", def: "all" },
  { key: "bedtime", type: "bedtime", def: "23:00" },
  { key: "battery", type: "bool", def: true },
  { key: "focusMinutes", type: "int", def: 25, min: 1, max: 180 },
  { key: "focusBreakMinutes", type: "int", def: 5, min: 1, max: 60 },
  { key: "focusDnd", type: "bool", def: true },
  { key: "barIcon", type: "bool", def: true },
  { key: "gitCelebrate", type: "bool", def: true },
  { key: "gitRoots", type: "roots", def: "~/Work,~/Code,~/Projects,~/src" }
]

var DEFAULTS = {}
var KEYS = []
for (var si = 0; si < SPEC.length; si++) { DEFAULTS[SPEC[si].key] = SPEC[si].def; KEYS.push(SPEC[si].key) }

function specFor(key) {
  for (var i = 0; i < SPEC.length; i++) if (SPEC[i].key === key) return SPEC[i]
  return null
}

function str(v) { return String(v === undefined || v === null ? "" : v).trim() }

function toBool(v, fallback) {
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  var s = str(v).toLowerCase()
  if (["true", "1", "yes", "on"].indexOf(s) >= 0) return true
  if (["false", "0", "no", "off"].indexOf(s) >= 0) return false
  return fallback
}

function toInt(v, fallback, min, max) {
  var n = typeof v === "number" ? v : parseInt(str(v), 10)
  if (!isFinite(n)) return fallback
  n = Math.round(n)
  if (n < min || n > max) return fallback
  return n
}

function oneOf(v, options, fallback) {
  var s = str(v).toLowerCase()
  return options.indexOf(s) >= 0 ? s : fallback
}

function toCharacter(v, fallback) {
  var s = str(v).toLowerCase()
  if (s === "daily" || s === "random") return "daily"
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(s) ? s : fallback
}

// "HH:MM" (24h) or "" to switch bedtime off. "off" and "none" also mean off.
function toBedtime(v, fallback) {
  if (v === "" || v === false) return ""
  var s = str(v).toLowerCase()
  if (s === "off" || s === "none" || s === "false") return ""
  var m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return fallback
  var h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  if (h > 23 || mi > 59) return fallback
  return (h < 10 ? "0" : "") + h + ":" + m[2]
}

// Folders to look for git repositories in: up to five comma-separated paths,
// each absolute or under ~, never climbing with "..". Returns the normalized
// "a,b" string, or `fallback` when anything is off.
var MAX_ROOTS = 5
function toRoots(v, fallback) {
  if (Array.isArray(v)) v = v.join(",")
  var parts = str(v).split(",").map(function (p) { return p.trim().replace(/\/+$/, "") }).filter(function (p) { return p.length > 0 })
  if (parts.length === 0 || parts.length > MAX_ROOTS) return fallback
  var out = []
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i]
    if (!(p === "~" || p.indexOf("~/") === 0 || p.indexOf("/") === 0)) return fallback
    if (p.split("/").indexOf("..") >= 0 || /[\n\0]/.test(p)) return fallback
    if (out.indexOf(p) < 0) out.push(p)
  }
  return out.join(",")
}

// "all" or a comma/space separated list of categories → array of categories.
function toCategories(v) {
  if (Array.isArray(v)) v = v.join(",")
  var s = str(v).toLowerCase()
  if (s === "" || s === "all") return CATEGORIES.slice()
  var out = []
  var parts = s.split(/[\s,]+/)
  for (var i = 0; i < parts.length; i++) {
    if (CATEGORIES.indexOf(parts[i]) >= 0 && out.indexOf(parts[i]) < 0) out.push(parts[i])
  }
  return out.length > 0 ? out : CATEGORIES.slice()
}

// How each type reads a stored value (always succeeds, falling back to the
// default) and validates a new one (returns {ok, value} or {ok: false, error}).
var NONE = {}
var TYPES = {
  bool: {
    read: function (v, s) { return toBool(v, s.def) },
    parse: function (v, s) { var b = toBool(v, NONE); return b === NONE ? fail(s.key + " must be true or false") : ok(b) }
  },
  int: {
    read: function (v, s) { return toInt(v, s.def, s.min, s.max) },
    parse: function (v, s) { var n = toInt(v, NONE, s.min, s.max); return n === NONE ? fail(s.key + " must be " + s.min + "-" + s.max) : ok(n) }
  },
  enum: {
    read: function (v, s) { return oneOf(v, s.options, s.def) },
    parse: function (v, s) { var o = oneOf(v, s.options, NONE); return o === NONE ? fail(s.key + " must be one of " + s.options.join(", ")) : ok(o) }
  },
  character: {
    read: function (v, s) { return toCharacter(v, s.def) },
    parse: function (v, s) { var c = toCharacter(v, NONE); return c === NONE ? fail("invalid character id") : ok(c) }
  },
  bedtime: {
    read: function (v, s) { return toBedtime(v === undefined ? s.def : v, s.def) },
    parse: function (v, s) { var t = toBedtime(v, NONE); return t === NONE ? fail("bedtime must be HH:MM or off") : ok(t) }
  },
  roots: {
    read: function (v, s) { return toRoots(v === undefined ? s.def : v, s.def) },
    parse: function (v, s) {
      var r = toRoots(v, NONE)
      return r === NONE ? fail(s.key + " must be up to " + MAX_ROOTS + " comma-separated folders, each absolute or under ~") : ok(r)
    }
  },
  categories: {
    read: function (v, s) { return toCategories(v === undefined ? s.def : v) },
    parse: function (v) {
      var x = str(v).toLowerCase()
      if (x === "all") return ok("all")
      var parts = x.split(/[\s,]+/).filter(function (p) { return p.length > 0 })
      for (var i = 0; i < parts.length; i++) {
        if (CATEGORIES.indexOf(parts[i]) < 0) return fail("unknown stretch category '" + parts[i] + "'")
      }
      return ok(toCategories(x).join(","))
    }
  }
}

function ok(value) { return { ok: true, value: value } }
function fail(error) { return { ok: false, error: error } }

function coerce(raw) {
  var r = raw && typeof raw === "object" ? raw : {}
  var out = {}
  for (var i = 0; i < SPEC.length; i++) {
    var s = SPEC[i]
    out[s.key] = TYPES[s.type].read(r[s.key], s)
  }
  out.scale = SIZES[out.size]
  out.stretchesAll = out.stretches.length === CATEGORIES.length
  return out
}

// Turns an IPC/menu value (always a string from IPC) into the JSON value we
// store, validated the same way coerce() reads it back.
function parseValue(key, value) {
  var s = specFor(key)
  if (!s) return fail("unknown setting '" + key + "'")
  return TYPES[s.type].parse(value, s)
}

// The full entry to hand to shell.updateEntryInline: the raw entry (unknown
// keys preserved, so hand-added notes survive) with one key changed.
function entryWith(raw, id, key, value) {
  var entry = { id: id }
  var r = raw && typeof raw === "object" ? raw : {}
  for (var k in r) if (k !== "id") entry[k] = r[k]
  entry[key] = value
  return entry
}

// Where the plugin's settings live in shell.json. Once the plugin has a bar
// widget, Omarchy writes settings to the bar entry (shell.qml updateEntryInline
// looks there first), so a bar entry wins and is merged over plugins[].
// `section` is the bar section the icon is in ("" when it isn't on the bar).
function findEntry(cfg, id) {
  var layout = cfg && cfg.bar && cfg.bar.layout && typeof cfg.bar.layout === "object" ? cfg.bar.layout : {}
  var bar = null, plug = null, section = ""
  var sections = ["left", "center", "right"]
  for (var s = 0; s < sections.length; s++) {
    var list = Array.isArray(layout[sections[s]]) ? layout[sections[s]] : []
    for (var i = 0; i < list.length; i++) {
      if (bar || !list[i]) continue
      if (list[i] === id) { bar = {}; section = sections[s] }
      else if (list[i].id === id) { bar = list[i]; section = sections[s] }
    }
  }
  var plugins = cfg && Array.isArray(cfg.plugins) ? cfg.plugins : []
  for (var j = 0; j < plugins.length; j++) if (plugins[j] && plugins[j].id === id) plug = plugins[j]
  var entry = {}
  var k
  if (plug) for (k in plug) entry[k] = plug[k]
  if (bar) for (k in bar) entry[k] = bar[k]
  return { entry: entry, home: bar ? "bar" : plug ? "plugins" : "", section: section }
}

if (typeof module !== "undefined") module.exports = {
  SPEC: SPEC, DEFAULTS: DEFAULTS, KEYS: KEYS, SIZES: SIZES, CATEGORIES: CATEGORIES, MODES: MODES,
  COLORS: COLORS, MOTIONS: MOTIONS, WARPS: WARPS, SCREENCAST: SCREENCAST, SAVER: SAVER,
  specFor: specFor, toBool: toBool, toInt: toInt, oneOf: oneOf, toCharacter: toCharacter,
  toBedtime: toBedtime, toCategories: toCategories, toRoots: toRoots, coerce: coerce, parseValue: parseValue,
  entryWith: entryWith, findEntry: findEntry
}
