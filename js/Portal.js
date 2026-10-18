// Procedural pixel portals for the workspace-switch effect. Everything is
// generated on the art grid (no textures), so the portal stays crisp at any
// size and recolors with the theme.
//
//   portal({ kind: "side" | "floor", h, w, open: 0..1, step, flash, colors })
//
// "side" is an upright oval doorway the buddy walks into; "floor" is a flat
// oval it dives into. `open` animates a bright seam that stretches open (side:
// height first, then width; floor: the reverse). `step` turns the ring swirl
// and moves the sparks. Returns { w, h, cx, cy, runs } in grid pixels.

var DEFAULT_COLORS = {
  edge: "#140b24",
  dark: "#5b2bb5",
  mid: "#9b5cff",
  bright: "#d7b8ff",
  spark: "#ffffff",
  inner: "#2a1450",
  core: "#0c0618"
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

function easeOutBack(t) {
  var c1 = 1.4, c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function inEllipse(px, py, cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) return false
  var nx = (px - cx) / rx, ny = (py - cy) / ry
  return nx * nx + ny * ny <= 1
}

function portal(opts) {
  var kind = opts.kind === "floor" ? "floor" : "side"
  var c = {}
  var k
  for (k in DEFAULT_COLORS) c[k] = (opts.colors && opts.colors[k]) || DEFAULT_COLORS[k]
  var W = kind === "side" ? (opts.w || 12) : (opts.w || 18)
  var H = kind === "side" ? (opts.h || 22) : (opts.h || 6)
  var gw = W + 2, gh = H + 2
  var cx = gw / 2, cy = gh / 2
  var open = clamp(opts.open === undefined ? 1 : opts.open, 0, 1)
  var step = opts.step || 0

  // Stretch open: the long axis first, then the short axis with a little overshoot.
  var longT = clamp(open * 2, 0, 1)
  var shortT = clamp(open * 2 - 1, 0, 1)
  var longR = (kind === "side" ? H : W) / 2 * (longT >= 1 ? 1 : easeOutBack(longT))
  var shortR = (kind === "side" ? W : H) / 2 * (shortT <= 0 ? 0 : Math.min(1.08, easeOutBack(shortT)))
  var rx = kind === "side" ? shortR : longR
  var ry = kind === "side" ? longR : shortR
  var thick = kind === "side" ? 2 : 1.6

  var grid = []
  for (var y = 0; y < gh; y++) {
    var row = []
    for (var x = 0; x < gw; x++) row.push(null)
    grid.push(row)
  }

  var seam = (kind === "side" ? rx : ry) < 1.2
  if (seam) {
    // A thin bright seam while the portal is still tearing open (or closing).
    var len = Math.max(0, Math.round(kind === "side" ? ry : rx))
    for (var i = -len; i <= len; i++) {
      var sx = kind === "side" ? Math.floor(cx) : Math.floor(cx + i)
      var sy = kind === "side" ? Math.floor(cy + i) : Math.floor(cy)
      if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue
      grid[sy][sx] = Math.abs(i) === len ? c.spark : (Math.abs(i) % 3 === step % 3 ? c.spark : c.bright)
    }
  } else {
    var ix = Math.max(0, rx - thick), iy = Math.max(0, ry - thick)
    for (var py = 0; py < gh; py++) {
      for (var px = 0; px < gw; px++) {
        var X = px + 0.5, Y = py + 0.5
        if (inEllipse(X, Y, cx, cy, ix, iy)) {
          // Interior: a darker core with a lighter rim just inside the ring.
          var nx = (X - cx) / Math.max(ix, 0.5), ny = (Y - cy) / Math.max(iy, 0.5)
          grid[py][px] = nx * nx + ny * ny > 0.55 ? c.inner : c.core
        } else if (inEllipse(X, Y, cx, cy, rx, ry)) {
          // Ring: rotating swirl bands.
          var ang = Math.atan2((Y - cy) / ry, (X - cx) / rx)
          var band = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 10 + step) % 4
          grid[py][px] = opts.flash ? c.spark : [c.bright, c.mid, c.dark, c.mid][(band + 4) % 4]
        } else if (inEllipse(X, Y, cx, cy, rx + 1, ry + 1)) {
          grid[py][px] = c.edge
        }
      }
    }
    // Sparks spiral inward through the interior.
    if (ix >= 1.5 && iy >= 1.5) {
      var sparks = kind === "side" ? 5 : 4
      for (var s = 0; s < sparks; s++) {
        var phase = ((step * 0.11 + s / sparks) % 1 + 1) % 1
        var r = (1 - phase) * 0.9
        var a = phase * Math.PI * 3 + s * (2 * Math.PI / sparks) + step * 0.35
        var spx = Math.floor(cx + Math.cos(a) * r * ix)
        var spy = Math.floor(cy + Math.sin(a) * r * iy)
        if (spy >= 0 && spy < gh && spx >= 0 && spx < gw && grid[spy][spx] !== null)
          grid[spy][spx] = phase < 0.5 ? c.bright : c.spark
      }
    }
  }

  var runs = []
  for (var ry2 = 0; ry2 < gh; ry2++) {
    var line = grid[ry2]
    var x2 = 0
    while (x2 < gw) {
      var col = line[x2]
      var n = 1
      while (x2 + n < gw && line[x2 + n] === col) n++
      if (col !== null) runs.push([ry2, x2, n, col])
      x2 += n
    }
  }
  return { w: gw, h: gh, cx: cx, cy: cy, runs: runs, kind: kind }
}

// Portal colors from the theme accent (hex). Keeps the hue, forces enough
// saturation and spreads lightness into ring bands.
function themeColors(accent, hslToHex, hexToHsl) {
  if (!accent || !hslToHex || !hexToHsl) return DEFAULT_COLORS
  var hsl = hexToHsl(accent)
  var h = hsl[0], s = Math.max(0.55, hsl[1])
  return {
    edge: hslToHex(h, 0.6, 0.08),
    dark: hslToHex(h, s, 0.38),
    mid: hslToHex(h, s, 0.6),
    bright: hslToHex(h, Math.min(1, s + 0.1), 0.82),
    spark: "#ffffff",
    inner: hslToHex(h, 0.55, 0.17),
    core: hslToHex(h, 0.6, 0.06)
  }
}

if (typeof module !== "undefined") module.exports = {
  DEFAULT_COLORS: DEFAULT_COLORS, portal: portal, themeColors: themeColors, easeOutBack: easeOutBack
}
