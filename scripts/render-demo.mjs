#!/usr/bin/env node
// Builds the README images from the real modules (no screen captures, so no
// personal screen content ever ends up in the repo):
//   screenshots/characters.png   every built-in character
//   screenshots/expressions.png  a few characters x the shared expressions
//   screenshots/portal-*.png     frames of a workspace-switch portal, simulated
//                                with js/World.js exactly as the buddy runs it
//   screenshots/visit-*.png      a friend's visit, run with js/Visit.js's scene
// scripts/make-media.sh turns these into portal.gif, visit.gif and preview.png (magick).
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
const Personality = require(join(ROOT, "js/Personality.js"))
const Visit = require(join(ROOT, "js/Visit.js"))

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

function metricsFor(ch, k) {
  const sp = ch.poses.special || {}
  return {
    k, w: ch.w, h: ch.h, body: Sprite.frameBox(ch, "idle", 0), hangTop: Sprite.frameBox(ch, "hang", 0).y0,
    motion: ch.motion, floats: ch.floats, flies: ch.flies, speed: ch.speed,
    fps: Object.fromEntries(Object.entries(ch.poses).map(([p, v]) => [p, v.fps])),
    frames: Object.fromEntries(Object.entries(ch.poses).map(([p, v]) => [p, v.frames.length])),
    special: { travel: sp.travel || 0, emote: sp.emote || null, duration: sp.duration || null }
  }
}

// Draws one world's render state (portals, body, emote) like Controller.qml.
function drawWorld(img, w, ch, colors, k, s) {
  const r = World.render(w)
  for (const q of r.portals) {
    const g = Portal.portal({ kind: q.kind, w: q.w, h: q.h, open: q.open, step: q.step, flash: q.flash })
    drawRuns(img, g.runs, Math.round((q.x - g.cx * k) * s), Math.round((q.y - g.cy * k) * s), k * s)
  }
  if (!r.visible) return
  const c = Sprite.compose({ character: ch, colors, glyphs: Glyphs, pose: r.pose, frame: r.frame, expression: r.expr, look: r.look,
                             facing: r.facing, prop: r.prop, accessories: r.accessories, ops: r.ops })
  const left = Math.round(r.x - (Sprite.PAD + ch.w / 2) * k), top = Math.round(r.y - (Sprite.PAD + ch.h) * k)
  drawRuns(img, c.runs, left * s, top * s, k * s)
  if (r.emote && Glyphs.EMOTES[r.emote.id]) {
    const em = Glyphs.EMOTES[r.emote.id]
    const runs = []
    em.rows.forEach((row, y) => row.split("").forEach((c2, x) => { if (c2 !== "." && em.colors[c2]) runs.push([y, x, 1, em.colors[c2]]) }))
    const ew = Math.max(...em.rows.map(row => row.length)), ek = Math.max(2, k - 1)
    const headTop = c.bbox ? top + c.bbox.y0 * k : r.y - 16 * k
    const ex = Math.round(r.x + (r.facing > 0 ? 1 : -1) * 4 * k - ew * k / 2)
    drawRuns(img, runs, ex * s, Math.round(headTop - (em.rows.length + 2) * k) * s, ek * s)
  }
}

// Simulates a workspace switch with the real world state machine.
function portalFrames(out, id) {
  const ch = loadCharacter(id)
  const k = 3, s = 2                  // logical px per art px, device px per logical px
  const metrics = metricsFor(ch, k)
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
      const c = Sprite.compose({ character: ch, colors, glyphs: Glyphs, pose: r.pose, frame: r.frame, expression: r.expr, look: r.look, facing: r.facing, prop: r.prop, accessories: r.accessories, ops: r.ops })
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

// A friend's visit: the host and a scripted friend, driven by Visit.timeline
// the way Visit.qml drives them.
function visitFrames(out, hostId, friendId) {
  const k = 3, s = 2
  const hostCh = loadCharacter(hostId), friendCh = loadCharacter(friendId)
  let seed = 11
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const mon = { gx: 0, gy: 0, w: 300, h: 110, left: 0, top: 0, right: 300, bottom: 96 }
  const floor = { id: "floor", kind: "floor", x1: 0, x2: 300, y: 96, address: "" }
  const hostMetrics = Object.assign(metricsFor(hostCh, k), { personality: Personality.normalize(hostCh.personality).personality })
  const h = World.create({ motion: Motion, platforms: Platforms, personalities: Personality, metrics: hostMetrics, rng, mode: "hopper" })
  const f = World.create({ motion: Motion, platforms: Platforms, personalities: Personality, metrics: metricsFor(friendCh, k), rng, mode: "hopper", scripted: true })
  World.setEnv(h, { mon, ledges: [floor], focused: null, perch: { kind: "floor", ledgeId: "floor", x: 200, y: 96, facing: -1 } })
  World.setEnv(f, { mon, ledges: [floor], focused: null, perch: null })
  World.place(h, { x: 200, y: 96 })
  h.facing = -1
  const colors = [Schema.resolveColors(hostCh, "natural"), Schema.resolveColors(friendCh, "natural")]
  const dt = 1 / 15
  const frames = []
  const snap = () => {
    const img = canvas(mon.w * s, mon.h * s, BG)
    fill(img, 0, 96 * s, mon.w * s, (mon.h - 96) * s, FLOOR)
    drawWorld(img, f, friendCh, colors[1], k, s)
    drawWorld(img, h, hostCh, colors[0], k, s)
    frames.push(img)
  }
  const tick = () => { World.tick(h, dt); World.tick(f, dt); snap() }
  for (let t = 0; t < 0.6; t += dt) tick()
  World.setVisit(h, true)
  const at = Visit.spot({ x: h.x, y: h.y, halfW: World.halfW(h), ledge: h.support }, World.halfW(f), mon, k, World.halfW(f) + 12 * k)
  World.portalIn(f, { x: at.x, y: at.y, ledge: h.support, facing: at.facing }, at.facing)
  const steps = Visit.timeline(() => 0.3)
  let i = 0, t = 0, gone = false
  while (!gone && t < 14) {
    while (i < steps.length && steps[i].at <= t) {
      const st = steps[i++]
      const who = st.who === "both" ? [h, f] : st.who === "host" ? [h] : [f]
      for (const w of who) {
        if (st.act === "notice") { World.face(w, at.side); World.express(w, "bang", "wide", 0.9) }
        if (st.act === "greet") { World.face(w, w === h ? at.side : -at.side); World.express(w, st.emote, "happy", 1.3) }
        if (st.act === "special" && !World.special(w)) World.react(w, "cheer")
        if (st.act === "cheer") World.react(w, "cheer")
        if (st.act === "bye") World.express(w, "heart", "happy", 1.2)
        if (st.act === "leave") { World.setVisit(h, false); World.face(w, at.side); World.portalOut(w) }
      }
    }
    tick()
    t += dt
    for (const e of World.drain(f)) if (e.type === "gone") gone = true
    World.drain(h)
  }
  for (let j = 0; j < 8; j++) tick()
  frames.forEach((img, n) => writeFileSync(join(out, `visit-${String(n).padStart(3, "0")}.png`), encodePng(img)))
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
  const v = visitFrames(out, "cat", "duck")
  console.log(`${out}: characters.png, expressions.png, ${n} portal frames, ${v} visit frames`)
}

main()
