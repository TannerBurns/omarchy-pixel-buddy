#!/usr/bin/env node
// Renders contact sheets of characters with the same compositor the buddy uses
// (js/Sprite.js), so what you review is exactly what ships. No dependencies:
// PNGs are encoded with node's zlib.
//
//   node scripts/render-sheet.mjs <id|path.json>... [--out DIR] [--scale N] [--theme #rrggbb]
//   node scripts/render-sheet.mjs --lineup [--out DIR]       every built-in, idle frame 0
//   node scripts/render-sheet.mjs --glyphs [--out DIR]       emotes and props
//   node scripts/render-sheet.mjs --portal [--out DIR]       portal open/close strip
//
// Per character it writes <id>-poses.png (every pose and frame on dark, grey
// and light backgrounds), <id>-faces.png (expressions x gaze directions),
// <id>-ops.png (squash/stretch/lean/clip/flash/ghost) and <id>-sizes.png
// (real size at 1x/2x/3x/4x art scale).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import zlib from "node:zlib"

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const Sprite = require(join(ROOT, "js/Sprite.js"))
const Glyphs = require(join(ROOT, "js/Glyphs.js"))
const Schema = require(join(ROOT, "js/CharacterSchema.js"))
const Portal = existsSync(join(ROOT, "js/Portal.js")) ? require(join(ROOT, "js/Portal.js")) : null

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encodePng(img) {
  const { w, h, data } = img
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------- canvas

function rgb(hex) {
  const s = hex.replace("#", "")
  const n = parseInt(s.length === 3 ? s.split("").map(c => c + c).join("") : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function canvas(w, h, bg = "#000000") {
  const data = Buffer.alloc(w * h * 4)
  const img = { w, h, data }
  fill(img, 0, 0, w, h, bg)
  return img
}

export function fill(img, x, y, w, h, hex) {
  const [r, g, b] = rgb(hex)
  for (let yy = Math.max(0, y); yy < Math.min(img.h, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(img.w, x + w); xx++) {
      const i = (yy * img.w + xx) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
  }
}

export function drawRuns(img, runs, x0, y0, s) {
  for (const [y, x, n, c] of runs) fill(img, x0 + x * s, y0 + y * s, n * s, s, c)
}

// ---------------------------------------------------------------- loading

export function loadCharacter(ref) {
  let file = ref
  if (!ref.endsWith(".json")) file = join(ROOT, "characters", ref + ".json")
  const json = JSON.parse(readFileSync(file, "utf8"))
  const res = Schema.validate(json)
  if (!res.ok) throw new Error(`${basename(file)}: ${res.errors.join("; ")}`)
  return res.character
}

export function builtinIds() {
  const idx = join(ROOT, "characters", "index.json")
  if (existsSync(idx)) return JSON.parse(readFileSync(idx, "utf8")).characters
  return readdirSync(join(ROOT, "characters")).filter(f => f.endsWith(".json") && f !== "index.json").map(f => f.slice(0, -5))
}

function composeFor(ch, colors, o = {}) {
  return Sprite.compose(Object.assign({ character: ch, colors, glyphs: Glyphs }, o))
}

// ---------------------------------------------------------------- sheets

const BGS = ["#101315", "#7f7f7f", "#ffffff"]

function posesSheet(ch, colors, s) {
  const probe = composeFor(ch, colors)
  const cw = probe.w * s, chh = probe.h * s, gap = 2 * s
  const maxFrames = Math.max(...Schema.POSES.map(p => ch.poses[p].frames.length))
  const bandW = maxFrames * (cw + gap) + gap
  const img = canvas(bandW * BGS.length, Schema.POSES.length * (chh + gap) + gap, "#000000")
  BGS.forEach((bg, bi) => {
    fill(img, bi * bandW, 0, bandW, img.h, bg)
    Schema.POSES.forEach((pose, pi) => {
      const frames = ch.poses[pose].frames
      const expr = pose === "sleep" ? "closed" : "open"
      frames.forEach((_, fi) => {
        const c = composeFor(ch, colors, { pose, frame: fi, expression: expr })
        drawRuns(img, c.runs, bi * bandW + gap + fi * (cw + gap), gap + pi * (chh + gap), s)
      })
    })
  })
  return img
}

function facesSheet(ch, colors, s) {
  const looks = [[0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
  const probe = composeFor(ch, colors)
  const cw = probe.w * s, chh = probe.h * s, gap = 2 * s
  const img = canvas(looks.length * (cw + gap) + gap, Glyphs.EXPRESSIONS.length * (chh + gap) + gap, "#101315")
  Glyphs.EXPRESSIONS.forEach((expression, ei) => {
    looks.forEach((look, li) => {
      const c = composeFor(ch, colors, { expression, look })
      drawRuns(img, c.runs, gap + li * (cw + gap), gap + ei * (chh + gap), s)
    })
  })
  return img
}

function opsSheet(ch, colors, s) {
  const variants = [
    {}, { squash: 1 }, { squash: 2 }, { stretch: 1 }, { stretch: 2 }, { lean: 0.15 }, { lean: -0.15 },
    { clip: { side: "right", at: Math.floor(ch.w / 2) } }, { clip: { side: "bottom", at: Math.floor(ch.h / 2) } },
    { flash: 0.5 }, { flash: 1 }, { ghost: 0.34 }, { ghost: 0.67 }, { ghost: 1 }
  ]
  const extras = [
    { prop: "laptop" }, { prop: "book" }, { prop: "gamepad" }, { prop: "brush" }, { prop: "wrench" },
    { prop: "hand" }, { prop: "cup" }, { prop: "battery" }, { accessory: "nightcap" }, { facing: -1 },
    { facing: -1, prop: "laptop" }
  ]
  const probe = composeFor(ch, colors)
  const cw = probe.w * s, chh = probe.h * s, gap = 2 * s
  const cols = Math.max(variants.length, extras.length)
  const img = canvas(cols * (cw + gap) + gap, 2 * (chh + gap) + gap, "#101315")
  variants.forEach((ops, i) => drawRuns(img, composeFor(ch, colors, { ops }).runs, gap + i * (cw + gap), gap, s))
  extras.forEach((o, i) => drawRuns(img, composeFor(ch, colors, o).runs, gap + i * (cw + gap), chh + 2 * gap, s))
  return img
}

function sizesSheet(ch, colors) {
  const probe = composeFor(ch, colors)
  // 2 device px per logical px here (Tanner's display), art scale 1..4
  const scales = [2, 4, 6, 8]
  const w = scales.reduce((a, s) => a + probe.w * s + 16, 16)
  const h = probe.h * 8 + 32
  const img = canvas(w, h, "#101315")
  let x = 16
  for (const s of scales) {
    drawRuns(img, probe.runs, x, h - 16 - probe.h * s, s)
    x += probe.w * s + 16
  }
  return img
}

function lineup(ids, s, theme) {
  const chars = ids.map(id => loadCharacter(id))
  const comps = chars.map(ch => composeFor(ch, Schema.resolveColors(ch, theme ? "theme" : "natural", { accent: theme })))
  const gap = 3 * s
  const w = comps.reduce((a, c) => a + c.w * s + gap, gap)
  const h = Math.max(...comps.map(c => c.h)) * s + 2 * gap
  const img = canvas(w, h, "#101315")
  let x = gap
  comps.forEach(c => { drawRuns(img, c.runs, x, h - gap - c.h * s, s); x += c.w * s + gap })
  return img
}

function glyphSheet(s) {
  const names = Object.keys(Glyphs.EMOTES)
  const props = Object.keys(Glyphs.PROPS)
  const accs = Object.keys(Glyphs.ACCESSORIES)
  const cell = 10 * s, gap = 2 * s
  const cols = Math.max(names.length, props.length + accs.length)
  const img = canvas(cols * (cell + gap) + gap, 2 * (cell + gap) + gap, "#101315")
  const draw = (g, i, row) => {
    const map = c => (g.colors && g.colors[c]) || (c === "#" ? "#1a1b26" : null)
    const runs = []
    g.rows.forEach((r, y) => r.split("").forEach((c, x) => { const col = c === "." ? null : map(c); if (col) runs.push([y, x, 1, col]) }))
    drawRuns(img, runs, gap + i * (cell + gap), gap + row * (cell + gap), s)
  }
  names.forEach((n, i) => draw(Glyphs.EMOTES[n], i, 0))
  props.forEach((n, i) => draw(Glyphs.PROPS[n], i, 1))
  accs.forEach((n, i) => draw(Glyphs.ACCESSORIES[n], props.length + i, 1))
  return img
}

function portalSheet(s) {
  if (!Portal) throw new Error("js/Portal.js not found")
  const steps = 12
  const p0 = Portal.portal({ kind: "side", h: 22, w: 10, open: 1, step: 0 })
  const cw = p0.w * s, chh = p0.h * s, gap = 2 * s
  const f0 = Portal.portal({ kind: "floor", h: 6, w: 18, open: 1, step: 0 })
  const img = canvas(steps * (Math.max(cw, f0.w * s) + gap) + gap, chh + f0.h * s + 3 * gap, "#101315")
  const colW = Math.max(cw, f0.w * s) + gap
  for (let i = 0; i < steps; i++) {
    const open = i < 6 ? (i + 1) / 6 : 1
    const p = Portal.portal({ kind: "side", h: 22, w: 10, open, step: i })
    drawRuns(img, p.runs, gap + i * colW, gap, s)
    const f = Portal.portal({ kind: "floor", h: 6, w: 18, open, step: i })
    drawRuns(img, f.runs, gap + i * colW, chh + 2 * gap, s)
  }
  return img
}

// ---------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2)
  let out = join(ROOT, "build", "sheets")
  let scale = 8
  let theme = null
  const refs = []
  let doLineup = false, doGlyphs = false, doPortal = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--out") out = resolve(args[++i])
    else if (a === "--scale") scale = parseInt(args[++i], 10)
    else if (a === "--theme") theme = args[++i]
    else if (a === "--lineup") doLineup = true
    else if (a === "--glyphs") doGlyphs = true
    else if (a === "--portal") doPortal = true
    else refs.push(a)
  }
  mkdirSync(out, { recursive: true })
  const written = []
  const save = (name, img) => { const p = join(out, name); writeFileSync(p, encodePng(img)); written.push(p) }
  for (const ref of refs) {
    const ch = loadCharacter(ref)
    const colors = Schema.resolveColors(ch, theme ? "theme" : "natural", { accent: theme })
    save(`${ch.id}-poses.png`, posesSheet(ch, colors, scale))
    save(`${ch.id}-faces.png`, facesSheet(ch, colors, scale))
    save(`${ch.id}-ops.png`, opsSheet(ch, colors, scale))
    save(`${ch.id}-sizes.png`, sizesSheet(ch, colors))
  }
  if (doLineup) save(theme ? "lineup-theme.png" : "lineup.png", lineup(builtinIds(), Math.max(2, Math.round(scale / 2)), theme))
  if (doGlyphs) save("glyphs.png", glyphSheet(scale))
  if (doPortal) save("portal.png", portalSheet(scale))
  for (const p of written) console.log(p)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
