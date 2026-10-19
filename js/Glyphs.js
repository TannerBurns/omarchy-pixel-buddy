// Shared pixel glyphs: eyes, mouths, props, accessories and emotes. Characters
// draw eye-free faces and mark "sockets" with anchors; these glyphs are layered
// on top, so every character gets every expression and gaze direction.
//
// Glyph chars: '.' transparent, 'e' eye ink, 'w' glint, 'r' heart red,
// 'p' blush, '#' the character's outline color. Props and emotes carry their
// own color tables.

// Nominal eye width per style (glyphs mirror around it for the right eye).
var EYE_W = { dot: 2, big: 2, bead: 1 }

var EXPRESSIONS = ["open", "blink", "happy", "sleepy", "closed", "wide", "heart", "dizzy", "sad", "focused"]

// look: the glyph follows the gaze offset (±1 px). mirror: the right eye uses
// the mirrored glyph, placed symmetrically.
var EYES = {
  dot: {
    open:    { look: true, rows: ["ee", "ee"] },
    blink:   { dy: 1, rows: ["ee"] },
    closed:  { dy: 1, rows: ["ee"] },
    sleepy:  { dy: 1, rows: ["ee"] },
    happy:   { mirror: true, rows: [".e.", "e.e"] },
    wide:    { dy: -1, rows: ["we", "ee", "ee"] },
    heart:   { mirror: true, dy: -1, rows: ["r.r", "rrr", ".r."] },
    dizzy:   { mirror: true, dy: -1, rows: ["e.e", ".e.", "e.e"] },
    sad:     { mirror: true, rows: [".e", "ee"] },
    focused: { look: true, rows: ["ee"] }
  },
  big: {
    open:    { look: true, rows: ["we", "ee", "ee"] },
    blink:   { dy: 2, rows: ["ee"] },
    closed:  { dy: 2, rows: ["ee"] },
    sleepy:  { dy: 1, rows: ["ee", "ee"] },
    happy:   { mirror: true, dy: 1, rows: [".e.", "e.e"] },
    wide:    { dy: -1, rows: ["we", "ee", "ee", "ee"] },
    heart:   { mirror: true, rows: ["r.r", "rrr", ".r."] },
    dizzy:   { mirror: true, rows: ["e.e", ".e.", "e.e"] },
    sad:     { mirror: true, rows: [".e", "we", "ee"] },
    focused: { look: true, dy: 1, rows: ["we", "ee"] }
  },
  bead: {
    open:    { look: true, rows: ["e", "e"] },
    blink:   { dy: 1, rows: ["e"] },
    closed:  { dy: 1, rows: ["e"] },
    sleepy:  { dy: 1, rows: ["e"] },
    happy:   { mirror: true, rows: [".e", "e."] },
    wide:    { dy: -1, rows: ["e", "e", "e"] },
    heart:   { mirror: true, dx: -1, dy: -1, rows: ["r.r", "rrr", ".r."] },
    dizzy:   { mirror: true, dx: -1, dy: -1, rows: ["e.e", ".e.", "e.e"] },
    sad:     { rows: ["e", "e"] },
    focused: { look: true, dy: 1, rows: ["e"] }
  }
}

// 4 px wide mouth area (centers on the even-width faces); anchors.mouth is its top-left.
var MOUTHS = {
  smile: { rows: ["e..e", ".ee."] },
  grin:  { rows: ["eeee", ".ee."] },
  open:  { rows: [".ee.", "e..e", ".ee."] },
  flat:  { dy: 1, rows: [".ee."] },
  frown: { dy: 1, rows: [".ee.", "e..e"] },
  wavy:  { dy: 1, rows: [".e.e", "e.e."] }
}

var EXPRESSION_MOUTH = {
  open: "smile", blink: "smile", happy: "grin", sleepy: "flat", closed: "flat",
  wide: "open", heart: "grin", dizzy: "wavy", sad: "frown", focused: "flat"
}

var INK = "#1a1b26"

// Props are drawn at the frame's hand anchor; (ax, ay) is the prop pixel that
// lands on the anchor. '#' uses the character's outline color.
var PROPS = {
  laptop: {
    ax: 4, ay: 4, layer: "front",
    colors: { k: INK, g: "#9aa5b1", l: "#c7d0d9", a: "#7dcfff" },
    rows: [
      "kkkkkkkkk",
      "kgggggggk",
      "kggglgggk",
      "kgggggggk",
      "kkkkkkkkk"
    ]
  },
  book: {
    ax: 3, ay: 4, layer: "front",
    colors: { k: INK, b: "#c0504d", d: "#8c2f2c", y: "#f2d16b" },
    rows: [
      "kkkkkkk",
      "kbbkbbk",
      "kbykbyk",
      "kbbkbbk",
      "kddkddk",
      ".kkkkk."
    ]
  },
  gamepad: {
    ax: 3, ay: 3, layer: "front",
    colors: { k: INK, g: "#6c7a89", d: "#3d4652", r: "#ff5c5c", b: "#5cc8ff" },
    rows: [
      ".kkkkk.",
      "kgdgrgk",
      "kdddgbk",
      "kgdgggk",
      ".kk.kk."
    ]
  },
  brush: {
    ax: 1, ay: 5, layer: "front",
    colors: { k: INK, r: "#ff6b9a", y: "#d9b44a", b: "#8d6e63" },
    rows: [
      ".k.",
      "krk",
      "krk",
      "kyk",
      ".b.",
      ".b.",
      ".b."
    ]
  },
  wrench: {
    ax: 1, ay: 5, layer: "front",
    colors: { k: INK, s: "#b0bec5" },
    rows: [
      "k.k",
      "sks",
      "sss",
      ".s.",
      ".s.",
      ".s.",
      ".k."
    ]
  },
  hand: {
    ax: 2, ay: 6, layer: "front",
    colors: { k: INK, w: "#ffe0bd" },
    rows: [
      "k.k.k",
      "wkwkw",
      "wwwww",
      "wwwww",
      "kwwwk",
      ".kwk.",
      ".kkk."
    ]
  },
  cup: {
    ax: 2, ay: 4, layer: "front",
    colors: { k: INK, w: "#e8f1f8", b: "#5fa8ff", c: "#a6d8ff" },
    rows: [
      "kkkkk",
      "kcbck",
      "kbbbk",
      "kwwwk",
      ".kkk."
    ]
  },
  battery: {
    ax: 3, ay: 3, layer: "front",
    colors: { k: INK, r: "#ff5c5c", w: "#e8e8e8" },
    rows: [
      "kkkkkk.",
      "krwwwkk",
      "krwwwkk",
      "kkkkkk."
    ]
  }
}

// Accessories sit on anchors.head (top-center of the head).
var ACCESSORIES = {
  nightcap: {
    ax: 3, ay: 3,
    colors: { k: INK, b: "#5b6ee1", d: "#3f4fb3", w: "#f4f4f4" },
    rows: [
      ".....kkw",
      "....kbkw",
      "..kkbbk.",
      ".kbbbdk.",
      "kwwwwwwk"
    ]
  }
}

// Emotes float above the head on their own small canvas.
var EMOTES = {
  bang: {
    colors: { k: INK, y: "#ffd23f" },
    rows: [
      ".kk.",
      "kyyk",
      "kyyk",
      "kyyk",
      ".kk.",
      "kyyk",
      ".kk."
    ]
  },
  question: {
    colors: { k: INK, w: "#ffffff" },
    rows: [
      ".kkkk.",
      "kwwwwk",
      "kkkkwk",
      "..kwwk",
      "..kwk.",
      "..kk..",
      "..kwk.",
      "..kk.."
    ]
  },
  dots: {
    colors: { k: INK, w: "#ffffff" },
    rows: [
      "kkkkkkkkk",
      "kwkkwkkwk",
      "kkkkkkkkk"
    ]
  },
  heart: {
    colors: { k: INK, r: "#ff4d6d", p: "#ff9eb0" },
    rows: [
      ".kk.kk.",
      "kprkrrk",
      "krrrrrk",
      ".krrrk.",
      "..krk..",
      "...k..."
    ]
  },
  zzz: {
    colors: { k: INK, w: "#dbe7ff" },
    rows: [
      "kkkkk..",
      "kwwwk..",
      "kkwk.kkk",
      ".kwkkwwk",
      "kwwwkkwk",
      "kkkkkwwk",
      "....kkkk"
    ]
  },
  sparkle: {
    colors: { k: INK, y: "#fff3a3", w: "#ffffff" },
    rows: [
      "...k...",
      "..kyk..",
      ".kkykk.",
      "kyywyyk",
      ".kkykk.",
      "..kyk..",
      "...k..."
    ]
  },
  drop: {
    colors: { k: INK, b: "#5fa8ff", w: "#cfe8ff" },
    rows: [
      "..k..",
      ".kbk.",
      "kbwbk",
      "kbbbk",
      ".kkk."
    ]
  },
  bolt: {
    colors: { k: INK, y: "#ffe14d" },
    rows: [
      "..kkk",
      ".kyyk",
      "kyykk",
      "kkyyk",
      ".kyk.",
      ".kk..",
      ".k..."
    ]
  },
  note: {
    colors: { k: INK, n: "#a9d6ff", w: "#ffffff" },
    rows: [
      "..kkk.",
      "..knnk",
      "..knkk",
      "..knk.",
      ".kknk.",
      "kwnnk.",
      "knnnk.",
      ".kkk.."
    ]
  },
  bulb: {
    colors: { k: INK, y: "#ffe680", w: "#ffffff", g: "#9aa5b1" },
    rows: [
      ".kkk.",
      "kywyk",
      "kyyyk",
      ".kyk.",
      ".kgk.",
      ".kkk."
    ]
  },
  spiral: {
    colors: { k: INK, w: "#ffffff" },
    rows: [
      ".kkkkk.",
      "kwwwwwk",
      "kwkkkwk",
      "kwkwkwk",
      "kwkkwwk",
      "kwwwkk.",
      ".kkkk.."
    ]
  },
  stretch: {
    colors: { k: INK, g: "#7ee081", w: "#ffffff" },
    rows: [
      "k.....k",
      "kg...gk",
      ".kg.gk.",
      "..kgk..",
      "..kgk..",
      ".kg.gk.",
      ".k...k."
    ]
  },
  battery: {
    colors: { k: INK, r: "#ff5c5c", w: "#e8e8e8" },
    rows: [
      "kkkkkk.",
      "krwwwkk",
      "krwwwkk",
      "kkkkkk."
    ]
  }
}

function eyeGlyph(style, expression) {
  var set = EYES[style] || EYES.dot
  return set[expression] || set.open
}

function mouthGlyph(expression) {
  return MOUTHS[EXPRESSION_MOUTH[expression] || "smile"] || null
}

// Maps glyph chars for eyes/mouths to colors for this character.
function eyeColors(character, colors) {
  var eyes = character.eyes || {}
  var ink = eyes.color ? (colors[eyes.color] || eyes.color) : (colors["#"] || INK)
  var glint = eyes.glint ? (colors[eyes.glint] || eyes.glint) : "#ffffff"
  return function (ch) {
    if (ch === "e" || ch === "#") return ink
    if (ch === "w") return glint
    if (ch === "r") return "#ff4d6d"
    if (ch === "p") return "#ff8fa3"
    return null
  }
}

function colorFor(glyph, characterColors) {
  return function (ch) {
    if (glyph.colors && glyph.colors[ch]) return glyph.colors[ch]
    if (ch === "#") return characterColors["#"] || INK
    return null
  }
}

if (typeof module !== "undefined") module.exports = {
  EYE_W: EYE_W, EXPRESSIONS: EXPRESSIONS, EYES: EYES, MOUTHS: MOUTHS, EXPRESSION_MOUTH: EXPRESSION_MOUTH,
  PROPS: PROPS, ACCESSORIES: ACCESSORIES, EMOTES: EMOTES, INK: INK,
  eyeGlyph: eyeGlyph, mouthGlyph: mouthGlyph, eyeColors: eyeColors, colorFor: colorFor
}
