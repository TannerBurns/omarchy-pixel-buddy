// Settings live inline on the plugin's shell.json `plugins[]` entry. The shell
// stores whatever the entry holds and never applies defaults, and hand edits
// can put anything there, so every value is coerced with its own fallback.
// Plain JS (no .pragma, no .import) so node tests can require() it.

var DEFAULTS = {
  character: "daily",
  mode: "hopper",
  size: "medium",
  colors: "natural",
  motion: "full",
  warp: "portal",
  overFullscreen: false,
  followCursor: true,
  screencast: "calm",
  wellbeing: true,
  breakMinutes: 45,
  stretches: "all",
  bedtime: "23:00",
  battery: true
}

var MODES = ["hopper", "patrol", "roam", "stay"]
var SIZES = { small: 2, medium: 3, large: 4 }
var COLORS = ["natural", "theme"]
var MOTIONS = ["full", "calm"]
var WARPS = ["portal", "fade", "none"]
var SCREENCAST = ["calm", "hide", "normal"]
var CATEGORIES = ["neck", "shoulders", "wrists", "back", "eyes", "legs", "breathing", "water"]
var KEYS = Object.keys(DEFAULTS)

function toBool(v, fallback) {
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  var s = String(v === undefined || v === null ? "" : v).trim().toLowerCase()
  if (["true", "1", "yes", "on"].indexOf(s) >= 0) return true
  if (["false", "0", "no", "off"].indexOf(s) >= 0) return false
  return fallback
}

function toInt(v, fallback, min, max) {
  var n = typeof v === "number" ? v : parseInt(String(v === undefined || v === null ? "" : v).trim(), 10)
  if (!isFinite(n)) return fallback
  n = Math.round(n)
  if (n < min || n > max) return fallback
  return n
}

function oneOf(v, options, fallback) {
  var s = String(v === undefined || v === null ? "" : v).trim().toLowerCase()
  return options.indexOf(s) >= 0 ? s : fallback
}

function toCharacter(v, fallback) {
  var s = String(v === undefined || v === null ? "" : v).trim().toLowerCase()
  if (s === "daily" || s === "random") return "daily"
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(s) ? s : fallback
}

// "HH:MM" (24h) or "" to switch bedtime off. "off" and "none" also mean off.
function toBedtime(v, fallback) {
  if (v === "" || v === false) return ""
  var s = String(v === undefined || v === null ? "" : v).trim().toLowerCase()
  if (s === "off" || s === "none" || s === "false") return ""
  var m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return fallback
  var h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  if (h > 23 || mi > 59) return fallback
  return (h < 10 ? "0" : "") + h + ":" + m[2]
}

// "all" or a comma/space separated list of categories → array of categories.
function toCategories(v) {
  if (Array.isArray(v)) v = v.join(",")
  var s = String(v === undefined || v === null ? "" : v).trim().toLowerCase()
  if (s === "" || s === "all") return CATEGORIES.slice()
  var out = []
  var parts = s.split(/[\s,]+/)
  for (var i = 0; i < parts.length; i++) {
    if (CATEGORIES.indexOf(parts[i]) >= 0 && out.indexOf(parts[i]) < 0) out.push(parts[i])
  }
  return out.length > 0 ? out : CATEGORIES.slice()
}

function coerce(raw) {
  var r = raw && typeof raw === "object" ? raw : {}
  var size = oneOf(r.size, Object.keys(SIZES), DEFAULTS.size)
  var stretches = toCategories(r.stretches === undefined ? DEFAULTS.stretches : r.stretches)
  return {
    character: toCharacter(r.character, DEFAULTS.character),
    mode: oneOf(r.mode, MODES, DEFAULTS.mode),
    size: size,
    scale: SIZES[size],
    colors: oneOf(r.colors, COLORS, DEFAULTS.colors),
    motion: oneOf(r.motion, MOTIONS, DEFAULTS.motion),
    warp: oneOf(r.warp, WARPS, DEFAULTS.warp),
    overFullscreen: toBool(r.overFullscreen, DEFAULTS.overFullscreen),
    followCursor: toBool(r.followCursor, DEFAULTS.followCursor),
    screencast: oneOf(r.screencast, SCREENCAST, DEFAULTS.screencast),
    wellbeing: toBool(r.wellbeing, DEFAULTS.wellbeing),
    breakMinutes: toInt(r.breakMinutes, DEFAULTS.breakMinutes, 1, 480),
    stretches: stretches,
    stretchesAll: stretches.length === CATEGORIES.length,
    bedtime: toBedtime(r.bedtime === undefined ? DEFAULTS.bedtime : r.bedtime, DEFAULTS.bedtime),
    battery: toBool(r.battery, DEFAULTS.battery)
  }
}

// Turns an IPC/menu value (always a string from IPC) into the JSON value we
// store, after validating it the same way coerce() reads it back.
function parseValue(key, value) {
  if (KEYS.indexOf(key) < 0) return { ok: false, error: "unknown setting '" + key + "'" }
  var probe = {}
  probe[key] = value
  var sentinel = {}
  switch (key) {
  case "overFullscreen": case "followCursor": case "wellbeing": case "battery": {
    var b = toBool(value, sentinel)
    return b === sentinel ? { ok: false, error: key + " must be true or false" } : { ok: true, value: b }
  }
  case "breakMinutes": {
    var n = toInt(value, sentinel, 1, 480)
    return n === sentinel ? { ok: false, error: "breakMinutes must be 1-480" } : { ok: true, value: n }
  }
  case "bedtime": {
    var t = toBedtime(value, sentinel)
    return t === sentinel ? { ok: false, error: "bedtime must be HH:MM or off" } : { ok: true, value: t }
  }
  case "stretches": {
    var s = String(value).trim().toLowerCase()
    if (s === "all") return { ok: true, value: "all" }
    var cats = toCategories(s)
    var parts = s.split(/[\s,]+/).filter(function (p) { return p.length > 0 })
    for (var i = 0; i < parts.length; i++) {
      if (CATEGORIES.indexOf(parts[i]) < 0) return { ok: false, error: "unknown stretch category '" + parts[i] + "'" }
    }
    return { ok: true, value: cats.join(",") }
  }
  case "character": {
    var c = toCharacter(value, sentinel)
    return c === sentinel ? { ok: false, error: "invalid character id" } : { ok: true, value: c }
  }
  default: {
    var options = { mode: MODES, size: Object.keys(SIZES), colors: COLORS, motion: MOTIONS,
                    warp: WARPS, screencast: SCREENCAST }[key]
    var o = oneOf(value, options, sentinel)
    return o === sentinel ? { ok: false, error: key + " must be one of " + options.join(", ") } : { ok: true, value: o }
  }
  }
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

if (typeof module !== "undefined") module.exports = {
  DEFAULTS: DEFAULTS, MODES: MODES, SIZES: SIZES, COLORS: COLORS, MOTIONS: MOTIONS, WARPS: WARPS,
  SCREENCAST: SCREENCAST, CATEGORIES: CATEGORIES, KEYS: KEYS,
  toBool: toBool, toInt: toInt, oneOf: oneOf, toCharacter: toCharacter, toBedtime: toBedtime,
  toCategories: toCategories, coerce: coerce, parseValue: parseValue, entryWith: entryWith
}
