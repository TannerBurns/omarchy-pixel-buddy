#!/usr/bin/env node
// Lints character files: the schema, characters/index.json, canonical
// formatting, personality values, and the art rules that keep every character
// working with the shared glyphs:
//   - feet on the bottom row (walkers), so ledges and floors line up
//   - eye sockets: every expression at every gaze lands on face pixels (never
//     outline or transparency)
//   - the mouth area sits on face pixels
//   - the neck anchor sits on the body (every built-in frame has one), and
//     every accessory (hats, scarf, sunglasses) stays inside the sprite area
// Usage: node scripts/lint-characters.mjs [file.json ...]   (default: built-ins)
// Exits 1 on errors; warnings are printed but don't fail.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { format } from "./format-characters.mjs"

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const Schema = require(join(ROOT, "js/CharacterSchema.js"))
const Glyphs = require(join(ROOT, "js/Glyphs.js"))
const Sprite = require(join(ROOT, "js/Sprite.js"))
const Personality = require(join(ROOT, "js/Personality.js"))

const errors = []
const warnings = []
const err = (f, m) => errors.push(`${basename(f)}: ${m}`)
const warn = (f, m) => warnings.push(`${basename(f)}: ${m}`)

const EYE_POSES = ["idle", "walk", "sit", "cheer", "stretch", "carried", "jump", "special"]
const LOOKS = [-1, 0, 1]
// A signature move always looks straight ahead, so only that gaze must fit.
const STRAIGHT_ONLY = ["special"]

function checkSockets(file, ch) {
  const style = ch.eyes.style
  if (style === "none") return
  for (const pose of EYE_POSES) {
    const p = ch.poses[pose]
    if (p.from !== pose) continue
    p.frames.forEach((fr, fi) => {
      const eyes = fr.anchors.eyes
      if (!eyes) return
      for (const expression of Glyphs.EXPRESSIONS) {
        const g = Glyphs.eyeGlyph(style, expression)
        const looks = g.look && !STRAIGHT_ONLY.includes(pose) ? LOOKS : [0]
        const gw = Math.max(...g.rows.map(r => r.length))
        for (const lx of looks) for (const ly of looks) {
          eyes.forEach((a, ei) => {
            const right = ei === 1
            const rows = right && g.mirror ? g.rows.map(r => r.split("").reverse().join("")) : g.rows
            const dx = right && g.mirror ? -((g.dx || 0) + gw - Glyphs.EYE_W[style]) : (g.dx || 0)
            rows.forEach((row, ry) => {
              for (let rx = 0; rx < row.length; rx++) {
                if (row[rx] === ".") continue
                const x = a[0] + dx + lx + rx, y = a[1] + (g.dy || 0) + ly + ry
                const under = y >= 0 && y < ch.h && x >= 0 && x < ch.w ? fr.rows[y][x] : "."
                if (under === "." || under === "#") {
                  err(file, `${pose}/${fi}: ${expression} eye (look ${lx},${ly}) lands on ${under === "." ? "nothing" : "outline"} at ${x},${y}`)
                  return
                }
              }
            })
          })
        }
      }
      const m = fr.anchors.mouth
      if (m) {
        for (const mouth of Object.values(Glyphs.MOUTHS)) {
          mouth.rows.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) {
              if (row[rx] === ".") continue
              const x = m[0] + (mouth.dx || 0) + rx, y = m[1] + (mouth.dy || 0) + ry
              const under = y >= 0 && y < ch.h && x >= 0 && x < ch.w ? fr.rows[y][x] : "."
              if (under === "." || under === "#") { err(file, `${pose}/${fi}: mouth lands on ${under === "." ? "nothing" : "outline"} at ${x},${y}`); return }
            }
          })
        }
      }
    })
  }
}

// Pose emotes must name a glyph this version draws (custom files only warn:
// an unknown emote is skipped at runtime).
function checkEmotes(file, ch, builtin) {
  for (const [name, p] of Object.entries(ch.poses)) {
    if (p.from !== name || !p.emote || Glyphs.EMOTES[p.emote]) continue
    const msg = `${name}: unknown emote '${p.emote}' (known: ${Object.keys(Glyphs.EMOTES).join(", ")})`
    if (builtin) err(file, msg)
    else warn(file, msg)
  }
}

// Accessories: the neck anchor sits on the body, and everything worn stays
// inside the sprite area (the cell plus Sprite.PAD on the sides and top), so
// no pixel of a hat, scarf or lens is ever cut off. Built-ins must give every
// frame a neck; custom characters without one just can't wear the scarf.
function checkWardrobe(file, ch, builtin) {
  const report = builtin ? err : warn
  const P = Sprite.PAD
  if (!builtin && !ch.poses.idle.frames[0].anchors.neck) warn(file, "no neck anchor, so it can't wear the scarf")
  for (const [pose, p] of Object.entries(ch.poses)) {
    if (p.from !== pose) continue
    p.frames.forEach((fr, fi) => {
      const a = fr.anchors
      if (!a.neck) {
        if (builtin) err(file, `${pose}/${fi}: anchors.neck is missing`)
      } else {
        const [x, y] = a.neck
        const under = y >= 0 && y < ch.h && x >= 0 && x < ch.w ? fr.rows[y][x] : "."
        if (under === ".") report(file, `${pose}/${fi}: anchors.neck ${x},${y} is not on the body`)
      }
      for (const [id, acc] of Object.entries(Glyphs.ACCESSORIES)) {
        const out = []
        for (const b of Sprite.placement(acc, a, ch.eyes.style)) {
          b.rows.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) {
              if (row[rx] === ".") continue
              const x = b.x + rx, y = b.y + ry
              if (x < -P || x >= ch.w + P || y < -P || y >= ch.h) out.push(`${x},${y}`)
            }
          })
        }
        if (out.length) report(file, `${pose}/${fi}: the ${acc.name.toLowerCase()} reaches outside the sprite area at ${out[0]}`)
      }
    })
  }
}

// A personality never rejects a character (bad values fall back with a
// warning at runtime), but the built-ins must be clean.
function checkPersonality(file, ch, builtin) {
  if (ch.personality === null || ch.personality === undefined) return
  for (const m of Personality.normalize(ch.personality).warnings) {
    if (builtin) err(file, m)
    else warn(file, m)
  }
}

function checkFeet(file, ch) {
  if (ch.floats) return
  for (const pose of ["idle", "walk", "sit"]) {
    const p = ch.poses[pose]
    if (p.from !== pose) continue
    p.frames.forEach((fr, fi) => {
      if (ch.motion === "hop" && pose === "walk" && /[^.]/.test(fr.rows[ch.h - 1]) === false) return
      if (!/[^.]/.test(fr.rows[ch.h - 1])) err(file, `${pose}/${fi}: feet must touch the bottom row`)
    })
  }
}

function checkStyle(file, ch) {
  const f = ch.poses.idle.frames[0]
  let x0 = 99, x1 = -1
  f.rows.forEach(r => { for (let x = 0; x < r.length; x++) if (r[x] !== ".") { x0 = Math.min(x0, x); x1 = Math.max(x1, x) } })
  if (x1 - x0 + 1 > 15) warn(file, `idle body is ${x1 - x0 + 1} px wide (aim for <= 14)`)
  if (Object.keys(ch.palette).length > 9) warn(file, `${Object.keys(ch.palette).length} palette colors (aim for <= 8)`)
  if (!ch.palette["#"]) warn(file, "no '#' outline color (eyes default to it)")
}

function lint(file, builtin) {
  let text
  try { text = readFileSync(file, "utf8") } catch { err(file, "cannot read"); return null }
  let json
  try { json = JSON.parse(text) } catch (e) { err(file, "invalid JSON: " + e.message); return null }
  if (builtin && format(json) !== text) err(file, "not in canonical format (run: node scripts/format-characters.mjs)")
  const res = Schema.validate(json)
  if (!res.ok) { for (const e of res.errors) err(file, e); return null }
  for (const w of res.warnings) warn(file, w)
  const ch = res.character
  if (builtin && basename(file) !== ch.id + ".json") err(file, `file name must be ${ch.id}.json`)
  checkFeet(file, ch)
  checkSockets(file, ch)
  checkEmotes(file, ch, builtin)
  checkPersonality(file, ch, builtin)
  checkWardrobe(file, ch, builtin)
  checkStyle(file, ch)
  return ch
}

function main() {
  const args = process.argv.slice(2)
  const dir = join(ROOT, "characters")
  let files = args
  let builtin = false
  if (files.length === 0) {
    builtin = true
    files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json").sort().map(f => join(dir, f))
    const idxFile = join(dir, "index.json")
    if (!existsSync(idxFile)) err(idxFile, "missing")
    else {
      const idx = JSON.parse(readFileSync(idxFile, "utf8")).characters || []
      const onDisk = files.map(f => basename(f, ".json"))
      for (const id of idx) if (!onDisk.includes(id)) err(idxFile, `lists '${id}' but characters/${id}.json is missing`)
      for (const id of onDisk) if (!idx.includes(id)) err(idxFile, `does not list ${id}.json`)
    }
  }
  let frames = 0, count = 0
  for (const f of files) {
    const ch = lint(f, builtin)
    if (ch) { count++; for (const p of Object.values(ch.poses)) frames += p.from ? 0 : 0; frames += Object.keys(ch.poses).filter(k => ch.poses[k].from === k).reduce((a, k) => a + ch.poses[k].frames.length, 0) }
  }
  for (const w of warnings) console.log("warning: " + w)
  for (const e of errors) console.log("error: " + e)
  console.log(`${count} character(s), ${frames} frames, ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(errors.length ? 1 : 0)
}

main()
