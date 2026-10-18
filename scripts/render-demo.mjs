#!/usr/bin/env node
// Builds the README images from the real modules (no screen captures, so no
// personal screen content ever ends up in the repo):
//   screenshots/characters.png   every built-in character
//   screenshots/expressions.png  a few characters x the shared expressions
//   screenshots/portal-*.png     frames of a workspace-switch portal, simulated
//                                with js/World.js exactly as the buddy runs it
// scripts/make-media.sh turns these into portal.gif and preview.png (magick).
//
//   node scripts/render-demo.mjs [--out DIR]

import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { encodePng, loadCharacter, builtinIds, canvas, fill, drawRuns } from "./render-sheet.mjs"

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const Sprite = require(join(ROOT, "js/Sprite.js"))
const Glyphs = require(join(ROOT, "js/Glyphs.js"))
const Schema = require(join(ROOT, "js/CharacterSchema.js"))
const Portal = require(join(ROOT, "js/Portal.js"))
const World = require(join(ROOT, "js/World.js"))
const Motion = require(join(ROOT, "js/Motion.js"))
const Platforms = require(join(ROOT, "js/Platforms.js"))

const BG = "#101315"
const FLOOR = "#1c2126"

function compose(ch, o = {}) {
  return Sprite.compose(Object.assign({ character: ch, colors: Schema.resolveColors(ch, "natural"), glyphs: Glyphs }, o))
}

function lineup(out) {
  const ids = builtinIds()
  const s = 6, gap = 4 * s, perRow = 9
  const chars = ids.map(loadCharacter)
  const comps = chars.map(ch => compose(ch))
  const cw = comps[0].w * s, chh = comps[0].h * s
  const rows = Math.ceil(chars.length / perRow)
  const img = canvas(perRow * (cw + gap) + gap, rows * (chh + gap) + gap, BG)
  comps.forEach((c, i) => {
    const r = Math.floor(i / perRow), col = i % perRow
    const inRow = Math.min(perRow, chars.length - r * perRow)
    const x0 = Math.round((img.w - inRow * (cw + gap) + gap) / 2) + col * (cw + gap)
    drawRuns(img, c.runs, x0, gap + r * (chh + gap), s)
  })
  writeFileSync(join(out, "characters.png"), encodePng(img))
}

function expressions(out) {
  const ids = ["cat", "frog", "robot", "ghost"]
  const exprs = ["open", "happy", "wide", "heart", "sleepy", "dizzy", "sad"]
  const s = 5, gap = 3 * s
  const chars = ids.map(loadCharacter)
  const probe = compose(chars[0])
  const cw = probe.w * s, chh = probe.h * s
  const img = canvas(exprs.length * (cw + gap) + gap, ids.length * (chh + gap) + gap, BG)
  chars.forEach((ch, r) => exprs.forEach((expression, c) => {
    drawRuns(img, compose(ch, { expression }).runs, gap + c * (cw + gap), gap + r * (chh + gap), s)
  }))
  writeFileSync(join(out, "expressions.png"), encodePng(img))
}

// Simulates a workspace switch with the real world state machine.
function portalFrames(out, id) {
  const ch = loadCharacter(id)
  const k = 3, s = 2                  // logical px per art px, device px per logical px
  const metrics = {
    k, w: ch.w, h: ch.h, body: Sprite.frameBox(ch, "idle", 0), hangTop: Sprite.frameBox(ch, "hang", 0).y0,
    motion: ch.motion, floats: ch.floats, flies: ch.flies, speed: ch.speed,
    fps: Object.fromEntries(Object.entries(ch.poses).map(([p, v]) => [p, v.fps])),
    frames: Object.fromEntries(Object.entries(ch.poses).map(([p, v]) => [p, v.frames.length]))
  }
  let seed = 7
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const w = World.create({ motion: Motion, platforms: Platforms, metrics, rng, mode: "hopper" })
  const mon = { gx: 0, gy: 0, w: 260, h: 110, left: 0, top: 0, right: 260, bottom: 96 }
  const floor = { id: "floor", kind: "floor", x1: 0, x2: 260, y: 96, address: "" }
  const env = (x) => ({ mon, ledges: [floor], focused: null, perch: { kind: "floor", ledgeId: "floor", x, y: 96, facing: -1 } })
  World.setEnv(w, env(70))
  World.place(w, { x: 70, y: 96 })
  World.setCursor(w, 200, 40)
  const colors = Schema.resolveColors(ch, "natural")
  const dt = 1 / 15
  const frames = []
  const snap = () => {
    const r = World.render(w)
    const img = canvas(mon.w * s, mon.h * s, BG)
    fill(img, 0, 96 * s, mon.w * s, (mon.h - 96) * s, FLOOR)
    for (const q of r.portals) {
      const g = Portal.portal({ kind: q.kind, w: q.w, h: q.h, open: q.open, step: q.step, flash: q.flash })
      drawRuns(img, g.runs, Math.round((q.x - g.cx * k) * s), Math.round((q.y - g.cy * k) * s), k * s)
    }
    if (r.visible) {
      const c = Sprite.compose({ character: ch, colors, glyphs: Glyphs, pose: r.pose, frame: r.frame, expression: r.expr, look: r.look, facing: r.facing, prop: r.prop, accessory: r.accessory, ops: r.ops })
      drawRuns(img, c.runs, Math.round((r.x - (Sprite.PAD + ch.w / 2) * k) * s), Math.round((r.y - (Sprite.PAD + ch.h) * k) * s), k * s)
      if (r.emote && Glyphs.EMOTES[r.emote.id]) {
        const em = Glyphs.EMOTES[r.emote.id]
        const runs = []
        em.rows.forEach((row, y) => row.split("").forEach((c2, x) => { if (c2 !== "." && em.colors[c2]) runs.push([y, x, 1, em.colors[c2]]) }))
        drawRuns(img, runs, Math.round((r.x + 10 - 3 * k) * s), Math.round((r.y - (ch.h + 10) * k) * s), (k - 1) * s)
      }
    }
    frames.push(img)
  }
  const run = (secs) => { for (let t = 0; t < secs; t += dt) { World.tick(w, dt); snap() } }
  run(0.8)
  World.setEnv(w, env(190))
  World.workspaceSwitch(w, 1, "side")
  run(1.7)
  World.setEnv(w, env(70))
  World.workspaceSwitch(w, -1, "side")
  run(1.9)
  frames.forEach((img, i) => writeFileSync(join(out, `portal-${String(i).padStart(3, "0")}.png`), encodePng(img)))
  return frames.length
}

function main() {
  const args = process.argv.slice(2)
  let out = join(ROOT, "build", "demo")
  for (let i = 0; i < args.length; i++) if (args[i] === "--out") out = resolve(args[++i])
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  lineup(out)
  expressions(out)
  const n = portalFrames(out, "knight")
  console.log(`${out}: characters.png, expressions.png, ${n} portal frames`)
}

main()
