// Settings, schema, sprite compositor and portal generator.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js, characterFiles, loadCharacter } = require("./helpers.cjs")

const Settings = js("Settings")
const Schema = js("CharacterSchema")
const Sprite = js("Sprite")
const Glyphs = js("Glyphs")
const Portal = js("Portal")

test("settings: defaults when the entry is empty or garbage", () => {
  const s = Settings.coerce({ id: "tannerburns.pixel-buddy" })
  assert.equal(s.character, "daily")
  assert.equal(s.mode, "hopper")
  assert.equal(s.scale, 3)
  assert.equal(s.warp, "portal")
  assert.equal(s.breakMinutes, 45)
  assert.equal(s.bedtime, "23:00")
  assert.deepEqual(s.stretches, Settings.CATEGORIES)
  const g = Settings.coerce({ mode: "fly", size: 9, breakMinutes: "lots", bedtime: "25:99", wellbeing: "maybe", character: "../etc" })
  assert.equal(g.mode, "hopper")
  assert.equal(g.size, "medium")
  assert.equal(g.breakMinutes, 45)
  assert.equal(g.bedtime, "23:00")
  assert.equal(g.wellbeing, true)
  assert.equal(g.character, "daily")
  assert.deepEqual(Settings.coerce(null).mode, "hopper")
})

test("settings: strings from omarchy/IPC coerce like typed values", () => {
  const s = Settings.coerce({ overFullscreen: "true", followCursor: "0", breakMinutes: "30", size: "Large", bedtime: "off", stretches: "wrists, eyes,bogus" })
  assert.equal(s.overFullscreen, true)
  assert.equal(s.followCursor, false)
  assert.equal(s.breakMinutes, 30)
  assert.equal(s.scale, 4)
  assert.equal(s.bedtime, "")
  assert.deepEqual(s.stretches, ["wrists", "eyes"])
})

test("settings: parseValue validates and entryWith keeps unknown keys", () => {
  assert.deepEqual(Settings.parseValue("breakMinutes", "20"), { ok: true, value: 20 })
  assert.equal(Settings.parseValue("breakMinutes", "0").ok, false)
  assert.deepEqual(Settings.parseValue("mode", "Roam"), { ok: true, value: "roam" })
  assert.equal(Settings.parseValue("mode", "teleport").ok, false)
  assert.equal(Settings.parseValue("nope", "1").ok, false)
  assert.deepEqual(Settings.parseValue("stretches", "eyes,legs"), { ok: true, value: "eyes,legs" })
  assert.equal(Settings.parseValue("stretches", "eyes,toes").ok, false)
  assert.deepEqual(Settings.parseValue("bedtime", "7:30"), { ok: true, value: "07:30" })
  const e = Settings.entryWith({ id: "x", note: "mine", mode: "stay" }, "tannerburns.pixel-buddy", "mode", "roam")
  assert.deepEqual(e, { id: "tannerburns.pixel-buddy", note: "mine", mode: "roam" })
})

test("schema: every built-in character validates and has distinct ids", () => {
  const ids = new Set()
  for (const f of characterFiles()) {
    const ch = loadCharacter(f)
    assert.ok(!ids.has(ch.id), "duplicate id " + ch.id)
    ids.add(ch.id)
    for (const pose of Schema.POSES) assert.ok(ch.poses[pose].frames.length > 0, ch.id + " " + pose)
  }
  assert.ok(ids.size >= 1)
})

test("schema: patch frames, shifts and the fallback chain", () => {
  const rows = []
  for (let i = 0; i < 8; i++) rows.push(i === 7 ? "########" : i >= 3 ? "#oooooo#" : "........")
  const json = {
    format: "pixel-buddy-character", version: 1, id: "test", name: "Test", size: [8, 8],
    palette: { "#": "#000000", o: { natural: "#ff0000", theme: "accent" } },
    eyes: { style: "dot" }, anchors: { eyes: [[2, 4], [4, 4]] },
    poses: {
      idle: { frames: [{ rows }, { base: "idle/0", rows: { "3": "..####.." } }] },
      jump: [{ base: "idle/0", shift: [0, -1] }]
    }
  }
  const res = Schema.validate(json)
  assert.ok(res.ok, res.errors.join("; "))
  const ch = res.character
  assert.equal(ch.poses.idle.frames[1].rows[3], "..####..")
  assert.equal(ch.poses.jump.frames[0].rows[6], "########")
  assert.deepEqual(ch.poses.jump.frames[0].anchors.eyes, [[2, 3], [4, 3]])
  assert.equal(ch.poses.fall.from, "jump")
  assert.equal(ch.poses.hang.from, "jump")
  assert.equal(ch.poses.sleep.from, "idle")
  const theme = Schema.resolveColors(ch, "theme", { accent: "#00ff00" })
  assert.notEqual(theme.o, "#ff0000")
  assert.equal(Schema.resolveColors(ch, "natural").o, "#ff0000")
})

test("schema: rejects bad files with useful errors", () => {
  const bad = Schema.validate({ format: "pixel-buddy-character", version: 1, id: "Bad Id", name: "", size: [4, 99], palette: [], poses: {} })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(e => e.includes("id")))
  assert.ok(bad.errors.some(e => e.includes("size")))
  const json = {
    format: "pixel-buddy-character", version: 1, id: "x", name: "X", size: [8, 8], palette: { o: "#fff" },
    eyes: { style: "none" }, poses: { idle: [{ rows: ["oooooooo", "oo", "", "", "", "", "", ""] }], wiggle: [] }
  }
  const r = Schema.validate(json)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.includes("unknown pose")))
  assert.ok(r.errors.some(e => e.includes("wide")))
  assert.equal(Schema.validate({ ...json, poses: { idle: [{ base: "idle/0" }] } }).ok, false)
})

test("sprite: composes runs, flips, clips and squashes on the grid", () => {
  const ch = loadCharacter(characterFiles().find(f => f.endsWith("blob.json")))
  const colors = Schema.resolveColors(ch, "natural")
  const base = Sprite.compose({ character: ch, colors, glyphs: Glyphs })
  assert.ok(base.runs.length > 10)
  assert.equal(base.w, ch.w + 2 * Sprite.PAD)
  // Every run is inside the grid.
  for (const [y, x, n] of base.runs) assert.ok(y >= 0 && y < base.h && x >= 0 && x + n <= base.w)
  // Feet land on the cell's bottom row.
  assert.equal(base.bbox.y1, base.oy + ch.h - 1)
  const flipped = Sprite.compose({ character: ch, colors, glyphs: Glyphs, facing: -1 })
  assert.equal(flipped.bbox.y1, base.bbox.y1)
  const squashed = Sprite.compose({ character: ch, colors, glyphs: Glyphs, ops: { squash: 2 } })
  assert.equal(squashed.bbox.y0, base.bbox.y0 + 2)
  const clipped = Sprite.compose({ character: ch, colors, glyphs: Glyphs, ops: { clip: { side: "right", at: 8 } } })
  assert.ok(clipped.bbox.x1 < base.ox + 8)
  const gone = Sprite.compose({ character: ch, colors, glyphs: Glyphs, ops: { clip: { side: "bottom", at: 0 } } })
  assert.equal(gone.bbox, null)
  const flash = Sprite.compose({ character: ch, colors, glyphs: Glyphs, ops: { flash: 1 } })
  assert.ok(flash.runs.every(r => r[3] === "#ffffff"))
})

test("sprite: every expression and gaze stays on the face of every character", () => {
  const looks = [-1, 0, 1]
  for (const f of characterFiles()) {
    const ch = loadCharacter(f)
    if (ch.eyes.style === "none") continue
    const colors = Schema.resolveColors(ch, "natural")
    for (const expression of Glyphs.EXPRESSIONS) for (const lx of looks) for (const ly of looks) {
      const c = Sprite.compose({ character: ch, colors, glyphs: Glyphs, expression, look: [lx, ly] })
      const plain = Sprite.compose({ character: ch, colors, glyphs: Glyphs, expression: "closed" })
      assert.ok(c.bbox.x0 >= plain.bbox.x0 - 1 && c.bbox.x1 <= plain.bbox.x1 + 1 && c.bbox.y0 >= plain.bbox.y0 - 1,
        `${ch.id} ${expression} look ${lx},${ly} draws outside the body`)
    }
  }
})

test("portal: tears open as a seam, opens into a ring, floor portals stay flat", () => {
  const seam = Portal.portal({ kind: "side", open: 0.2, step: 0 })
  const xs = new Set(seam.runs.map(r => r[1]))
  assert.equal(xs.size, 1, "a closed-ish portal is a one-pixel seam")
  const open = Portal.portal({ kind: "side", open: 1, step: 3 })
  const colors = new Set(open.runs.map(r => r[3]))
  for (const c of [Portal.DEFAULT_COLORS.edge, Portal.DEFAULT_COLORS.core]) assert.ok(colors.has(c))
  const floor = Portal.portal({ kind: "floor", open: 1, step: 0 })
  assert.ok(floor.w > floor.h * 2)
  const themed = Portal.themeColors("#ff9e64", Schema.hslToHex, hex => { const [r, g, b] = Schema.hexToRgb(hex); return Schema.rgbToHsl(r, g, b) })
  assert.match(themed.mid, /^#[0-9a-f]{6}$/)
  // Swirl moves between steps.
  const a = JSON.stringify(Portal.portal({ kind: "side", open: 1, step: 1 }).runs)
  const b = JSON.stringify(Portal.portal({ kind: "side", open: 1, step: 2 }).runs)
  assert.notEqual(a, b)
})

test("docs: the custom character example validates and matches docs/characters.md", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const { ROOT } = require("./helpers.cjs")
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/custom-mochi.json"), "utf8"))
  const res = Schema.validate(fixture)
  assert.ok(res.ok, res.errors.join("; "))
  assert.equal(res.character.poses.sleep.frames[0].rows[15], ".##############.")
  const doc = fs.readFileSync(path.join(ROOT, "docs/characters.md"), "utf8")
  const block = doc.match(/```json\n(\{\n  "format"[\s\S]*?)```/)
  assert.ok(block, "example block present")
  assert.deepEqual(JSON.parse(block[1]), fixture)
})

test("docs: the README settings table covers every setting", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const { ROOT } = require("./helpers.cjs")
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
  for (const key of Settings.KEYS) assert.ok(readme.includes("| `" + key + "` |"), "README documents " + key)
})
