// Character files (characters/*.json and ~/.config/pixel-buddy/characters/*.json)
// are validated and normalized here. See docs/characters.md for the format.
//
// Frames are either full `rows`, or a patch of another frame:
//   { "base": "idle/0", "rows": { "14": "...." }, "shift": [dx, dy] }
// Anchors cascade character → pose → frame, and follow a frame's shift.
// Only `idle` is required; every other pose falls back along FALLBACK.

var FORMAT = "pixel-buddy-character"
var VERSION = 1
var MOTIONS = ["walk", "hop", "waddle", "scuttle", "float", "fly"]
var POSES = ["idle", "walk", "jump", "fall", "sit", "sleep", "carried", "hang", "cheer", "special", "stretch"]
var FALLBACK = {
  walk: "idle", jump: "idle", fall: "jump", sit: "idle", sleep: "sit", carried: "jump",
  hang: "carried", cheer: "jump", special: "cheer", stretch: "idle"
}
var DEFAULT_FPS = {
  idle: 1.25, walk: 8, jump: 1, fall: 1, sit: 1, sleep: 0.8, carried: 6, hang: 2,
  cheer: 6, special: 6, stretch: 2
}
var THEME_ROLES = ["accent", "accent-light", "accent-shade", "accent-dark", "foreground", "background", "keep"]
var EYE_STYLES = ["dot", "big", "bead", "none"]
var MAX_FRAMES = 12
var MAX_SIZE = 32
var MIN_SIZE = 8

function isHex(s) { return typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) }

function isPoint(p, w, h) {
  return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]) &&
    p[0] >= -8 && p[0] < w + 8 && p[1] >= -8 && p[1] < h + 8
}

function cloneAnchors(a) {
  var out = {}
  if (!a) return out
  for (var k in a) {
    var v = a[k]
    if (k === "eyes" && Array.isArray(v)) out.eyes = v.map(function (p) { return [p[0], p[1]] })
    else if (Array.isArray(v)) out[k] = [v[0], v[1]]
  }
  return out
}

function mergeAnchors(base, over) {
  var out = cloneAnchors(base)
  var o = cloneAnchors(over)
  for (var k in o) out[k] = o[k]
  return out
}

function shiftAnchors(a, dx, dy) {
  var out = {}
  for (var k in a) {
    if (k === "eyes") out.eyes = a.eyes.map(function (p) { return [p[0] + dx, p[1] + dy] })
    else out[k] = [a[k][0] + dx, a[k][1] + dy]
  }
  return out
}

function shiftRows(rows, dx, dy, w) {
  var h = rows.length
  var out = []
  for (var y = 0; y < h; y++) {
    var sy = y - dy
    var src = sy >= 0 && sy < h ? rows[sy] : ""
    var line = ""
    for (var x = 0; x < w; x++) {
      var sx = x - dx
      var c = sx >= 0 && sx < src.length ? src.charAt(sx) : "."
      line += c === " " ? "." : c
    }
    out.push(line)
  }
  return out
}

// Resolves every frame of every declared pose into { rows, anchors }.
// Returns { poses, errors }.
function resolveFrames(json, w, h) {
  var errors = []
  var resolved = {}
  var declared = json.poses || {}
  var charAnchors = json.anchors || {}
  var resolving = {}
  var partial = {}

  function frameRef(ref) {
    var m = typeof ref === "string" ? ref.match(/^([a-z]+)\/(\d+)$/) : null
    if (!m) { errors.push("bad frame reference '" + ref + "'"); return null }
    var poseName = m[1], idx = parseInt(m[2], 10)
    // Frames may build on earlier frames of their own pose.
    var frames = resolving[poseName] ? partial[poseName] : resolvePose(poseName)
    if (!frames || idx >= frames.length) { errors.push("frame reference '" + ref + "' does not exist"); return null }
    return frames[idx]
  }

  function resolvePose(name) {
    if (resolved[name]) return resolved[name]
    var pose = declared[name]
    if (!pose) return null
    if (resolving[name]) { errors.push("pose '" + name + "' references itself"); return null }
    resolving[name] = true
    var list = Array.isArray(pose) ? pose : pose.frames
    var poseAnchors = mergeAnchors(charAnchors, Array.isArray(pose) ? null : pose.anchors)
    var out = []
    partial[name] = out
    if (!Array.isArray(list) || list.length === 0) {
      errors.push("pose '" + name + "' has no frames")
    } else if (list.length > MAX_FRAMES) {
      errors.push("pose '" + name + "' has more than " + MAX_FRAMES + " frames")
    } else {
      for (var i = 0; i < list.length; i++) {
        var f = list[i]
        var where = name + "/" + i
        if (!f || typeof f !== "object") { errors.push(where + ": frame must be an object"); continue }
        var rows, anchors
        if (f.base !== undefined) {
          var base = frameRef(f.base)
          if (!base) continue
          rows = base.rows.slice()
          anchors = cloneAnchors(base.anchors)
          // Shift first, then patch rows, so patches can fix up the moved frame.
          if (f.shift) {
            var dx = parseInt(f.shift[0], 10) || 0, dy = parseInt(f.shift[1], 10) || 0
            rows = shiftRows(rows, dx, dy, w)
            anchors = shiftAnchors(anchors, dx, dy)
          }
          if (f.rows !== undefined) {
            if (typeof f.rows !== "object" || Array.isArray(f.rows)) { errors.push(where + ": patch rows must map row index to a string"); continue }
            for (var key in f.rows) {
              var ri = parseInt(key, 10)
              if (!(ri >= 0 && ri < h)) { errors.push(where + ": patch row " + key + " is outside the frame"); continue }
              rows[ri] = String(f.rows[key])
            }
          }
        } else if (Array.isArray(f.rows)) {
          rows = f.rows.map(function (r) { return String(r) })
          anchors = cloneAnchors(poseAnchors)
          if (f.shift) {
            var sx = parseInt(f.shift[0], 10) || 0, sy = parseInt(f.shift[1], 10) || 0
            rows = shiftRows(rows, sx, sy, w)
            anchors = shiftAnchors(anchors, sx, sy)
          }
        } else {
          errors.push(where + ": frame needs rows or a base")
          continue
        }
        if (rows.length !== h) { errors.push(where + ": has " + rows.length + " rows, expected " + h); continue }
        var bad = false
        for (var r = 0; r < rows.length; r++) {
          if (rows[r].length !== w) { errors.push(where + ": row " + r + " is " + rows[r].length + " wide, expected " + w); bad = true; break }
        }
        if (bad) continue
        if (f.anchors) anchors = mergeAnchors(anchors, f.anchors)
        out.push({ rows: rows, anchors: anchors })
      }
    }
    resolving[name] = false
    resolved[name] = out
    return out
  }

  for (var p in declared) {
    if (POSES.indexOf(p) < 0) { errors.push("unknown pose '" + p + "' (allowed: " + POSES.join(", ") + ")"); continue }
    resolvePose(p)
  }
  return { poses: resolved, errors: errors }
}

// Returns { ok, errors, warnings, character } — character is normalized when ok.
function validate(json) {
  var errors = [], warnings = []
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, errors: ["not a JSON object"], warnings: warnings }
  if (json.format !== FORMAT) errors.push("format must be \"" + FORMAT + "\"")
  if (json.version !== VERSION) errors.push("version must be " + VERSION)
  if (typeof json.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(json.id) || json.id === "daily")
    errors.push("id must be lowercase letters, digits, - or _ (max 40), and not 'daily'")
  if (typeof json.name !== "string" || json.name.trim().length === 0 || json.name.length > 32)
    errors.push("name must be 1-32 characters")
  var size = json.size
  if (!Array.isArray(size) || size.length !== 2 || !(size[0] >= MIN_SIZE && size[0] <= MAX_SIZE) || !(size[1] >= MIN_SIZE && size[1] <= MAX_SIZE) ||
      Math.round(size[0]) !== size[0] || Math.round(size[1]) !== size[1])
    errors.push("size must be [width, height] between " + MIN_SIZE + " and " + MAX_SIZE)
  var motion = json.motion === undefined ? "walk" : json.motion
  if (MOTIONS.indexOf(motion) < 0) errors.push("motion must be one of " + MOTIONS.join(", "))
  var speed = json.speed === undefined ? 1 : Number(json.speed)
  if (!(speed >= 0.25 && speed <= 3)) errors.push("speed must be between 0.25 and 3")

  var palette = {}
  if (!json.palette || typeof json.palette !== "object" || Array.isArray(json.palette)) {
    errors.push("palette must map single characters to colors")
  } else {
    for (var key in json.palette) {
      var v = json.palette[key]
      if (key.length !== 1 || key === "." || key === " ") { errors.push("palette key '" + key + "' must be one character other than '.'"); continue }
      if (isHex(v)) palette[key] = { natural: v, theme: null }
      else if (v && typeof v === "object" && isHex(v.natural) && (v.theme === undefined || THEME_ROLES.indexOf(v.theme) >= 0))
        palette[key] = { natural: v.natural, theme: v.theme && v.theme !== "keep" ? v.theme : null }
      else errors.push("palette '" + key + "' must be \"#rrggbb\" or { natural: \"#rrggbb\", theme: role }")
    }
    if (Object.keys(palette).length > 12) warnings.push("more than 12 palette colors")
  }

  var eyes = json.eyes || { style: "dot" }
  var eyeStyle = eyes.style || "dot"
  if (EYE_STYLES.indexOf(eyeStyle) < 0) errors.push("eyes.style must be one of " + EYE_STYLES.join(", "))
  if (eyes.color !== undefined && !isHex(eyes.color) && !(typeof eyes.color === "string" && palette[eyes.color]))
    errors.push("eyes.color must be a hex color or a palette key")

  if (!json.poses || typeof json.poses !== "object" || !json.poses.idle) errors.push("poses.idle is required")
  if (errors.length > 0) return { ok: false, errors: errors, warnings: warnings }

  var w = size[0], h = size[1]
  var res = resolveFrames(json, w, h)
  for (var i = 0; i < res.errors.length; i++) errors.push(res.errors[i])
  if (!res.poses.idle || res.poses.idle.length === 0) errors.push("poses.idle needs at least one valid frame")

  // Every char used in a frame must be in the palette.
  for (var pn in res.poses) {
    var frames = res.poses[pn]
    for (var fi = 0; fi < frames.length; fi++) {
      var rows = frames[fi].rows, an = frames[fi].anchors
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
          var chr = rows[r].charAt(c)
          if (chr !== "." && !palette[chr]) { errors.push(pn + "/" + fi + ": '" + chr + "' is not in the palette"); r = rows.length; break }
        }
      }
      if (eyeStyle !== "none") {
        if (!an.eyes || !Array.isArray(an.eyes) || an.eyes.length !== 2 || !isPoint(an.eyes[0], w, h) || !isPoint(an.eyes[1], w, h))
          errors.push(pn + "/" + fi + ": anchors.eyes must be two [x, y] points")
      }
      var named = ["mouth", "hand", "head"]
      for (var ni = 0; ni < named.length; ni++) {
        if (an[named[ni]] !== undefined && !isPoint(an[named[ni]], w, h)) errors.push(pn + "/" + fi + ": anchors." + named[ni] + " must be an [x, y] point")
      }
    }
  }
  // Optional pose fields (object-form poses only): travel, emote, duration.
  var fpsIn = json.fps && typeof json.fps === "object" ? json.fps : {}
  for (var dp in json.poses) {
    var pv = json.poses[dp]
    if (!pv || Array.isArray(pv) || typeof pv !== "object") continue
    var pfps = pv.fps !== undefined ? Number(pv.fps) : fpsIn[dp] !== undefined ? Number(fpsIn[dp]) : (DEFAULT_FPS[dp] || 1)
    if (pv.travel !== undefined) {
      var tv = Number(pv.travel)
      if (!(tv >= -4 && tv <= 4)) errors.push(dp + ": travel must be between -4 and 4 art pixels per frame")
      else if (Math.abs(tv * pfps) > 40) errors.push(dp + ": travel x fps must stay within 40 art pixels per second")
    }
    if (pv.duration !== undefined && !(Number(pv.duration) >= 0.3 && Number(pv.duration) <= 4))
      errors.push(dp + ": duration must be between 0.3 and 4 seconds")
    if (pv.emote !== undefined && !(typeof pv.emote === "string" && /^[a-z]{1,20}$/.test(pv.emote)))
      errors.push(dp + ": emote must be a lowercase emote id")
  }
  if (errors.length > 0) return { ok: false, errors: errors, warnings: warnings }

  // Fill missing poses from the fallback chain. Extra pose fields come from the
  // pose that actually supplies the frames.
  var poses = {}
  for (var pi = 0; pi < POSES.length; pi++) {
    var name = POSES[pi]
    var src = name
    var guard = 0
    while (!res.poses[src] || res.poses[src].length === 0) { src = FALLBACK[src] || "idle"; if (++guard > 10) { src = "idle"; break } }
    var declaredPose = json.poses[name]
    var fps = declaredPose && !Array.isArray(declaredPose) && declaredPose.fps !== undefined ? Number(declaredPose.fps)
      : fpsIn[name] !== undefined ? Number(fpsIn[name]) : DEFAULT_FPS[name]
    if (!(fps >= 0.25 && fps <= 20)) fps = DEFAULT_FPS[name]
    var srcPose = json.poses[src]
    var extra = srcPose && !Array.isArray(srcPose) && typeof srcPose === "object" ? srcPose : {}
    poses[name] = {
      fps: fps, frames: res.poses[src], from: src,
      travel: extra.travel !== undefined ? Number(extra.travel) : 0,
      emote: typeof extra.emote === "string" ? extra.emote : null,
      duration: extra.duration !== undefined ? Number(extra.duration) : null
    }
  }

  var character = {
    id: json.id,
    name: json.name.trim(),
    credit: typeof json.credit === "string" ? json.credit.slice(0, 80) : "",
    w: w, h: h,
    motion: motion,
    speed: speed,
    floats: motion === "float",
    flies: motion === "fly",
    palette: palette,
    eyes: { style: eyeStyle, color: eyes.color || "#", glint: eyes.glint || null },
    poses: poses
  }
  return { ok: true, errors: [], warnings: warnings, character: character }
}

// ---- color helpers (theme tinting)

function hexToRgb(hex) {
  var s = String(hex).replace("#", "")
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  var n = parseInt(s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  var max = Math.max(r, g, b), min = Math.min(r, g, b)
  var l = (max + min) / 2, h = 0, s = 0
  if (max !== min) {
    var d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hslToHex(h, s, l) {
  function f(p, q, t) {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  var r, g, b
  if (s === 0) { r = g = b = l } else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s
    var p = 2 * l - q
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3)
  }
  function hx(v) { var t = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return t.length < 2 ? "0" + t : t }
  return "#" + hx(r) + hx(g) + hx(b)
}

function themeColor(role, theme) {
  var accent = theme && isHex(theme.accent) ? theme.accent : "#7aa2f7"
  var rgb = hexToRgb(accent)
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2])
  var s = Math.max(0.35, hsl[1])
  var l = Math.max(0.35, Math.min(0.75, hsl[2]))
  if (role === "accent") return hslToHex(hsl[0], s, l)
  if (role === "accent-light") return hslToHex(hsl[0], s, Math.min(0.9, l + 0.18))
  if (role === "accent-shade") return hslToHex(hsl[0], s, Math.max(0.2, l - 0.14))
  if (role === "accent-dark") return hslToHex(hsl[0], Math.min(1, s + 0.05), Math.max(0.1, l - 0.32))
  if (role === "foreground") return theme && isHex(theme.foreground) ? theme.foreground : "#cdd6f4"
  if (role === "background") return theme && isHex(theme.background) ? theme.background : "#101315"
  return null
}

// Palette char → "#rrggbb" for this character in the given color mode.
function resolveColors(character, mode, theme) {
  var out = {}
  for (var k in character.palette) {
    var p = character.palette[k]
    var hex = mode === "theme" && p.theme ? themeColor(p.theme, theme) : null
    out[k] = (hex || p.natural).toLowerCase()
    if (out[k].length === 4) out[k] = "#" + out[k][1] + out[k][1] + out[k][2] + out[k][2] + out[k][3] + out[k][3]
  }
  return out
}

if (typeof module !== "undefined") module.exports = {
  FORMAT: FORMAT, VERSION: VERSION, MOTIONS: MOTIONS, POSES: POSES, FALLBACK: FALLBACK,
  DEFAULT_FPS: DEFAULT_FPS, THEME_ROLES: THEME_ROLES, EYE_STYLES: EYE_STYLES,
  validate: validate, resolveColors: resolveColors, themeColor: themeColor,
  rgbToHsl: rgbToHsl, hslToHex: hslToHex, hexToRgb: hexToRgb
}
