// The one sprite compositor. The live buddy (SpriteCanvas.qml) and the contact
// sheets (scripts/render-sheet.mjs) both draw what this returns, so the sheets
// are exactly what ships.
//
// compose() layers a character frame, the shared eyes/mouth glyphs, what it
// wears (scarf, sunglasses, a hat) and a prop on a padded grid, then applies
// on-grid pixel ops (squash, stretch, lean, flip, bob, clip, flash) so effects
// never break the pixel grid. Output is a list of row runs: [y, x, length,
// "#rrggbb"].

var PAD = 6

function blank(w, h) {
  var g = new Array(h)
  for (var y = 0; y < h; y++) {
    g[y] = new Array(w)
    for (var x = 0; x < w; x++) g[y][x] = null
  }
  return g
}

// Paints glyph rows onto the grid. `colorOf(ch)` maps a glyph char to a color
// (or null to skip). Out-of-bounds pixels are dropped.
function paint(grid, ox, oy, rows, colorOf) {
  var h = grid.length, w = h > 0 ? grid[0].length : 0
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r]
    var y = oy + r
    if (y < 0 || y >= h) continue
    for (var c = 0; c < row.length; c++) {
      var ch = row.charAt(c)
      if (ch === "." || ch === " ") continue
      var x = ox + c
      if (x < 0 || x >= w) continue
      var color = colorOf(ch)
      if (color) grid[y][x] = color
    }
  }
}

function mirrorRows(rows) {
  var out = []
  for (var i = 0; i < rows.length; i++) out.push(rows[i].split("").reverse().join(""))
  return out
}

function widthOf(rows) {
  var w = 0
  for (var i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length)
  return w
}

// Opaque bounding box of a grid, or null when empty.
function bbox(grid) {
  var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (var y = 0; y < grid.length; y++) {
    for (var x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === null) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 }
}

// Removes `n` rows at `at` and slides everything above down (squash).
function squashRows(grid, at, n) {
  for (var i = 0; i < n; i++) {
    for (var y = at; y > 0; y--) grid[y] = grid[y - 1].slice()
    grid[0] = grid[0].map(function () { return null })
  }
}

// Duplicates the row at `at` n times and slides everything above up (stretch).
function stretchRows(grid, at, n) {
  for (var i = 0; i < n; i++) {
    for (var y = 0; y < at; y++) grid[y] = grid[y + 1].slice()
  }
}

// Leans the sprite: each row shifts sideways in proportion to its height above
// the feet. Positive leans right.
function shear(grid, feetY, s) {
  var w = grid[0].length
  for (var y = 0; y < grid.length; y++) {
    var shift = Math.round((feetY - y) * s)
    if (shift === 0) continue
    var row = grid[y], out = new Array(w)
    for (var x = 0; x < w; x++) {
      var src = x - shift
      out[x] = src >= 0 && src < w ? row[src] : null
    }
    grid[y] = out
  }
}

function flipGrid(grid) {
  for (var y = 0; y < grid.length; y++) grid[y] = grid[y].slice().reverse()
}

function shiftY(grid, dy) {
  var h = grid.length, w = grid[0].length
  var out = blank(w, h)
  for (var y = 0; y < h; y++) {
    var sy = y - dy
    if (sy < 0 || sy >= h) continue
    out[y] = grid[sy].slice()
  }
  return out
}

function hexToRgb(hex) {
  var s = String(hex).replace("#", "")
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  var n = parseInt(s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r, g, b) {
  function h(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s }
  return "#" + h(r) + h(g) + h(b)
}

function mix(hexA, hexB, t) {
  var a = hexToRgb(hexA), b = hexToRgb(hexB)
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
}

function toRuns(grid) {
  var runs = []
  for (var y = 0; y < grid.length; y++) {
    var row = grid[y]
    var x = 0
    while (x < row.length) {
      var c = row[x]
      var n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (c !== null) runs.push([y, x, n, c])
      x += n
    }
  }
  return runs
}

function frameOf(character, pose, index) {
  var p = character.poses[pose] || character.poses.idle
  var frames = p.frames
  return frames[((index % frames.length) + frames.length) % frames.length]
}

// Which slot each built-in accessory takes, for fits() without the Glyphs
// module at hand (Glyphs.ACCESSORIES[id].slot is the source of truth).
var SLOT_OF = { nightcap: "head", partyhat: "head", crown: "head", sunglasses: "eyes", scarf: "neck" }

function slotOf(id, glyphs) {
  var acc = glyphs && glyphs.ACCESSORIES ? glyphs.ACCESSORIES[id] : null
  if (acc) return acc.slot || "head"
  return glyphs ? null : SLOT_OF[id] || null
}

// The accessories worn, one per slot: { neck, eyes, head } glyphs. The last id
// listed wins its slot; opts.accessory (one id) counts after opts.accessories.
// Unknown ids are skipped.
function wornBySlot(opts, glyphs) {
  var ids = Array.isArray(opts.accessories) ? opts.accessories.slice() : []
  if (opts.accessory) ids.push(opts.accessory)
  var out = {}
  var table = glyphs.ACCESSORIES || {}
  for (var i = 0; i < ids.length; i++) {
    var acc = table[ids[i]]
    if (acc) out[acc.slot || "head"] = acc
  }
  return out
}

// Where an accessory's pixels go on a frame: blocks of glyph rows at cell
// coordinates, [{ x, y, rows }], or [] when the frame lacks its anchor. Hats
// sit on anchors.head and the scarf on anchors.neck at the glyph's (ax, ay);
// sunglasses put a lens over each eye socket and join them with a bridge along
// the top when the lenses are at most `bridgeGap` pixels apart.
function placement(acc, anchors, eyeStyle) {
  if (!acc || !anchors) return []
  var slot = acc.slot || "head"
  if (slot !== "eyes") {
    var at = anchors[slot]
    return at ? [{ x: at[0] - acc.ax, y: at[1] - acc.ay, rows: acc.rows }] : []
  }
  var eyes = anchors.eyes
  if (!acc.lenses || eyeStyle === "none" || !eyes || eyes.length !== 2) return []
  var lens = acc.lenses[eyeStyle] || acc.lenses.dot
  var lw = widthOf(lens.rows)
  var left = eyes[0][0] <= eyes[1][0] ? eyes[0] : eyes[1]
  var right = left === eyes[0] ? eyes[1] : eyes[0]
  var lx = left[0] + lens.lx, ly = left[1] + lens.ly
  var rx = right[0] + lens.lx, ry = right[1] + lens.ly
  var blocks = [{ x: lx, y: ly, rows: lens.rows }, { x: rx, y: ry, rows: lens.rows }]
  var gap = rx - (lx + lw)
  if (gap > 0 && gap <= (acc.bridgeGap || 4)) {
    var bridge = ""
    for (var i = 0; i < gap; i++) bridge += "k"
    blocks.push({ x: lx + lw, y: Math.min(ly, ry), rows: [bridge] })
  }
  return blocks
}

// Can this character wear this accessory? Hats need anchors.head, the scarf
// anchors.neck (on idle frame 0), sunglasses eyes and their two anchors.
// `glyphs` (the Glyphs module) is optional for the built-in accessories.
function fits(character, id, glyphs) {
  var slot = slotOf(id, glyphs)
  if (!slot || !character || !character.poses || !character.poses.idle) return false
  var a = frameOf(character, "idle", 0).anchors || {}
  if (slot === "eyes") return !!(character.eyes && character.eyes.style !== "none" && Array.isArray(a.eyes) && a.eyes.length === 2)
  return Array.isArray(a[slot])
}

// opts: {
//   character   normalized character (CharacterSchema.normalize)
//   colors      palette char -> "#rrggbb" (CharacterSchema.resolveColors)
//   glyphs      the Glyphs module (eyes, mouths, props, accessories)
//   pose, frame, expression ("open"), look ([dx, dy]), facing (1 | -1)
//   prop        a prop glyph name or null
//   accessories accessory ids, one per slot: the last one listed wins its slot
//   accessory   one more accessory id (after the list), or null
//   ops: { squash, stretch, lean, bob, clip: {side, at}, flash, ghost }
// }
// Paint order: back prop, body, eyes, mouth, scarf, sunglasses, hat, front
// prop, then the ops, so everything worn moves with the body. Sunglasses hide
// the eyes (and aren't worn while asleep, expression "closed").
// Returns { w, h, ox, oy, runs, bbox, anchors } where (ox, oy) is the cell
// origin inside the padded grid and the feet sit on row oy + cellH - 1.
function compose(opts) {
  var ch = opts.character
  var glyphs = opts.glyphs
  var colors = opts.colors || {}
  var ops = opts.ops || {}
  var cw = ch.w, chh = ch.h
  var gw = cw + 2 * PAD, gh = chh + PAD
  var ox = PAD, oy = PAD
  var grid = blank(gw, gh)
  var frame = frameOf(ch, opts.pose || "idle", opts.frame || 0)
  var anchors = frame.anchors || {}
  var expression = opts.expression || "open"
  var look = opts.look || [0, 0]
  var colorOf = function (c) { return colors[c] || null }

  var prop = opts.prop && glyphs.PROPS[opts.prop] ? glyphs.PROPS[opts.prop] : null
  var hand = anchors.hand || [Math.floor(cw / 2), chh - 3]
  if (prop && prop.layer === "back")
    paint(grid, ox + hand[0] - prop.ax, oy + hand[1] - prop.ay, prop.rows, glyphs.colorFor(prop, colors))

  paint(grid, ox, oy, frame.rows, colorOf)

  var worn = wornBySlot(opts, glyphs)
  var eyeStyle = (ch.eyes && ch.eyes.style) || "dot"
  var glasses = worn.eyes && worn.eyes.lenses && eyeStyle !== "none" && anchors.eyes && anchors.eyes.length === 2 &&
    expression !== "closed" ? worn.eyes : null

  // Eyes: the frame leaves eye-free "sockets" of face color at anchors.eyes.
  if (eyeStyle !== "none" && anchors.eyes && !glasses) {
    var glyph = glyphs.eyeGlyph(eyeStyle, expression)
    if (glyph) {
      var eyeColors = glyphs.eyeColors(ch, colors)
      var lx = glyph.look ? look[0] : 0
      var ly = glyph.look ? look[1] : 0
      var gwid = widthOf(glyph.rows)
      for (var e = 0; e < anchors.eyes.length; e++) {
        var a = anchors.eyes[e]
        var right = e === 1
        var rows = right && glyph.mirror ? mirrorRows(glyph.rows) : glyph.rows
        var dx = right && glyph.mirror ? -((glyph.dx || 0) + gwid - glyphs.EYE_W[eyeStyle]) : (glyph.dx || 0)
        paint(grid, ox + a[0] + dx + lx, oy + a[1] + (glyph.dy || 0) + ly, rows, eyeColors)
      }
    }
  }

  if (anchors.mouth) {
    var mouth = glyphs.mouthGlyph(expression)
    if (mouth) paint(grid, ox + anchors.mouth[0] + (mouth.dx || 0), oy + anchors.mouth[1] + (mouth.dy || 0),
                     mouth.rows, glyphs.eyeColors(ch, colors))
  }

  // Squash and stretch pivot on the body itself, wherever a hat reaches.
  var box = bbox(grid)

  var wear = [worn.neck, glasses, worn.head]
  for (var wi = 0; wi < wear.length; wi++) {
    var blocks = placement(wear[wi], anchors, eyeStyle)
    for (var bi = 0; bi < blocks.length; bi++)
      paint(grid, ox + blocks[bi].x, oy + blocks[bi].y, blocks[bi].rows, glyphs.colorFor(wear[wi], colors))
  }

  if (prop && prop.layer !== "back")
    paint(grid, ox + hand[0] - prop.ax, oy + hand[1] - prop.ay, prop.rows, glyphs.colorFor(prop, colors))

  var feetY = oy + chh - 1
  var mid = box ? box.y0 + Math.floor((feetY - box.y0) * 0.45) : oy + Math.floor(chh / 2)
  if (ops.squash > 0) squashRows(grid, mid, Math.min(ops.squash, 6))
  if (ops.stretch > 0) stretchRows(grid, mid, Math.min(ops.stretch, 6))
  if (ops.lean) shear(grid, feetY, ops.lean)
  if ((opts.facing || 1) < 0) flipGrid(grid)
  if (ops.bob) grid = shiftY(grid, ops.bob)

  if (ops.clip) {
    var at = ops.clip.at
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < gw; x++) {
        var cx = x - ox, cy = y - oy
        if ((ops.clip.side === "right" && cx >= at) || (ops.clip.side === "left" && cx < at) ||
            (ops.clip.side === "bottom" && cy >= at) || (ops.clip.side === "top" && cy < at))
          grid[y][x] = null
      }
    }
  }

  if (ops.flash > 0) {
    var target = ops.flashColor || "#ffffff"
    for (var fy = 0; fy < gh; fy++)
      for (var fx = 0; fx < gw; fx++)
        if (grid[fy][fx] !== null) grid[fy][fx] = mix(grid[fy][fx], target, Math.min(1, ops.flash))
  }

  if (ops.ghost > 0) {
    // Dither every other pixel away, for fades that stay on the pixel grid.
    var level = Math.min(3, Math.round(ops.ghost * 3))
    for (var gy = 0; gy < gh; gy++)
      for (var gx = 0; gx < gw; gx++) {
        var keep = level === 1 ? (gx + gy) % 4 !== 0 : level === 2 ? (gx + gy) % 2 === 0 : (gx % 2 === 0 && gy % 2 === 0)
        if (!keep) grid[gy][gx] = null
      }
  }

  return { w: gw, h: gh, ox: ox, oy: oy, cellW: cw, cellH: chh, runs: toRuns(grid), bbox: bbox(grid), anchors: anchors }
}

// Opaque bounding box of one frame on its own (no glyphs), in cell coords.
function frameBox(character, pose, index) {
  var f = frameOf(character, pose, index)
  var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (var y = 0; y < f.rows.length; y++) {
    var row = f.rows[y]
    for (var x = 0; x < row.length; x++) {
      if (row.charAt(x) === "." || row.charAt(x) === " ") continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: character.w - 1, y1: character.h - 1 } : { x0: x0, y0: y0, x1: x1, y1: y1 }
}

// The opaque part of a composed sprite as runs relative to its bounding box,
// keeping at most the top `rows` rows (a face-sized icon for the bar).
function crop(comp, rows) {
  var b = comp.bbox
  if (!b) return { runs: [], w: 0, h: 0 }
  var h = Math.min(rows > 0 ? rows : Infinity, b.y1 - b.y0 + 1)
  var runs = []
  for (var i = 0; i < comp.runs.length; i++) {
    var r = comp.runs[i]
    if (r[0] < b.y0 || r[0] >= b.y0 + h) continue
    runs.push([r[0] - b.y0, r[1] - b.x0, r[2], r[3]])
  }
  return { runs: runs, w: b.x1 - b.x0 + 1, h: h }
}

if (typeof module !== "undefined") module.exports = {
  PAD: PAD, compose: compose, frameBox: frameBox, toRuns: toRuns, mix: mix, crop: crop, fits: fits, placement: placement,
  hexToRgb: hexToRgb, rgbToHex: rgbToHex, mirrorRows: mirrorRows
}
