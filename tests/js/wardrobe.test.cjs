// What the buddy wears: accessory slots, paint order, sunglasses and the neck
// anchors every built-in character carries.
const test = require("node:test")
const assert = require("node:assert/strict")
const { js, characterFiles, loadCharacter } = require("./helpers.cjs")

const Schema = js("CharacterSchema")
const Sprite = js("Sprite")
const Glyphs = js("Glyphs")

const builtins = characterFiles().map(loadCharacter)
const cat = builtins.find(c => c.id === "cat")
const crab = builtins.find(c => c.id === "crab")

function compose(ch, o) {
  return Sprite.compose(Object.assign({ character: ch, colors: Schema.resolveColors(ch, "natural"), glyphs: Glyphs }, o))
}

// The color at a cell coordinate of a composed sprite (null when transparent).
function pixel(comp, x, y) {
  const gx = comp.ox + x, gy = comp.oy + y
  for (const [ry, rx, n, c] of comp.runs) if (ry === gy && gx >= rx && gx < rx + n) return c
  return null
}

function colorsOf(comp) { return new Set(comp.runs.map(r => r[3])) }

// A small character built for one test: a face that is all "o" inside an outline.
function synthetic(o = {}) {
  const rows = ["########", "#oooooo#", "#oooooo#", "#oooooo#", "#oooooo#", "#oooooo#", "#oooooo#", "########"]
  const res = Schema.validate({
    format: "pixel-buddy-character", version: 1, id: "tester", name: "Tester", size: [8, 8],
    palette: { "#": "#202020", o: "#c0c0c0" }, eyes: { style: o.eyeStyle || "dot" },
    poses: { idle: [{ rows, anchors: Object.assign({ eyes: [[2, 3], [5, 3]] }, o.anchors || {}) }] }
  })
  assert.ok(res.ok, res.errors.join("; "))
  return res.character
}

test("glyphs: every accessory names its slot, and the wardrobe lists real ones", () => {
  for (const [id, acc] of Object.entries(Glyphs.ACCESSORIES)) {
    assert.ok(Glyphs.ACCESSORY_SLOTS.includes(acc.slot), id + " has a slot")
    assert.ok(typeof acc.name === "string" && acc.name.length > 0, id + " has a name")
  }
  assert.deepEqual(Glyphs.WARDROBE, ["scarf", "partyhat", "sunglasses", "crown"])
  for (const id of Glyphs.WARDROBE) assert.ok(Glyphs.ACCESSORIES[id], id)
  assert.equal(Glyphs.ACCESSORIES.nightcap.slot, "head")
})

test("wardrobe: the last accessory listed wins its slot", () => {
  assert.deepEqual(compose(cat, { accessories: ["partyhat", "crown"] }).runs, compose(cat, { accessories: ["crown"] }).runs)
  assert.deepEqual(compose(cat, { accessories: ["crown", "partyhat"] }).runs, compose(cat, { accessories: ["partyhat"] }).runs)
  assert.deepEqual(compose(cat, { accessories: ["bogus", "crown", "nope"] }).runs, compose(cat, { accessories: ["crown"] }).runs)
  // Different slots stack.
  assert.notDeepEqual(compose(cat, { accessories: ["scarf", "crown"] }).runs, compose(cat, { accessories: ["crown"] }).runs)
})

test("wardrobe: the nightcap after a crown replaces it, the scarf and sunglasses stay", () => {
  const night = compose(cat, { accessories: ["scarf", "sunglasses", "crown", "nightcap"] })
  assert.deepEqual(night.runs, compose(cat, { accessories: ["scarf", "sunglasses", "nightcap"] }).runs)
  assert.notDeepEqual(night.runs, compose(cat, { accessories: ["scarf", "sunglasses", "crown"] }).runs)
  const colors = colorsOf(night)
  assert.ok(colors.has(Glyphs.ACCESSORIES.scarf.colors.r), "scarf drawn")
  assert.ok(colors.has(Glyphs.ACCESSORIES.sunglasses.colors.g), "lenses drawn")
  assert.ok(colors.has(Glyphs.ACCESSORIES.nightcap.colors.b), "nightcap drawn")
  assert.ok(!colors.has(Glyphs.ACCESSORIES.crown.colors.y), "no crown")
})

test("wardrobe: the legacy accessory option still draws the nightcap", () => {
  const legacy = compose(cat, { accessory: "nightcap" })
  assert.deepEqual(legacy.runs, compose(cat, { accessories: ["nightcap"] }).runs)
  assert.notDeepEqual(legacy.runs, compose(cat, {}).runs)
  // It counts after the list, so it wins the head slot.
  assert.deepEqual(compose(cat, { accessories: ["crown"], accessory: "nightcap" }).runs, legacy.runs)
})

test("wardrobe: sunglasses cover the eyes, hats cover the head, a front prop goes over both", () => {
  const plain = compose(cat, {})
  const a = cat.poses.idle.frames[0].anchors
  const lensColors = new Set(Object.values(Glyphs.ACCESSORIES.sunglasses.colors))
  const shades = compose(cat, { accessories: ["sunglasses"] })
  for (const [x, y] of a.eyes) {
    assert.equal(pixel(plain, x, y), Glyphs.eyeColors(cat, Schema.resolveColors(cat, "natural"))("e"), "an eye under there")
    assert.ok(lensColors.has(pixel(shades, x, y)), "a lens over the eye at " + x + "," + y)
  }
  // The crown's bottom row lands on the head anchor's row.
  const crown = Glyphs.ACCESSORIES.crown
  const crowned = compose(cat, { accessories: ["crown"] })
  assert.equal(pixel(crowned, a.head[0], a.head[1]), crown.colors[crown.rows[crown.ay][crown.ax]])
  // The laptop (a front prop on the hand anchor) paints over the scarf.
  const laptop = Glyphs.PROPS.laptop
  const both = compose(cat, { accessories: ["scarf"], prop: "laptop" })
  const x = a.hand[0], y = a.neck[1]
  const lc = laptop.rows[y - (a.hand[1] - laptop.ay)][x - (a.hand[0] - laptop.ax)]
  assert.equal(pixel(both, x, y), laptop.colors[lc])
  assert.notEqual(pixel(compose(cat, { accessories: ["scarf"] }), x, y), pixel(both, x, y))
})

test("wardrobe: no sunglasses while asleep, or on a character without eyes", () => {
  assert.deepEqual(compose(cat, { expression: "closed", accessories: ["sunglasses"] }).runs, compose(cat, { expression: "closed" }).runs)
  assert.notDeepEqual(compose(cat, { expression: "blink", accessories: ["sunglasses"] }).runs, compose(cat, { expression: "blink" }).runs)
  const eyeless = synthetic({ eyeStyle: "none", anchors: { head: [3, 0], neck: [3, 6] } })
  assert.deepEqual(compose(eyeless, { accessories: ["sunglasses"] }).runs, compose(eyeless, {}).runs)
  assert.equal(Sprite.fits(eyeless, "sunglasses", Glyphs), false)
})

test("wardrobe: the bridge joins lenses only when they're close", () => {
  const g = Glyphs.ACCESSORIES.sunglasses
  const blocks = c => Sprite.placement(g, c.poses.idle.frames[0].anchors, c.eyes.style)
  assert.equal(blocks(cat).length, 3, "cat: two lenses and a bridge")
  assert.equal(blocks(crab).length, 2, "crab: its eyes sit too far apart for a bridge")
  for (const c of [cat, crab]) {
    const [l, r] = blocks(c)
    const lw = Math.max(...l.rows.map(row => row.length))
    const gap = r.x - (l.x + lw)
    assert.equal(blocks(c).length === 3, gap > 0 && gap <= g.bridgeGap, c.id)
  }
})

test("wardrobe: fits() follows the anchors", () => {
  const bare = synthetic()
  for (const id of ["partyhat", "crown", "nightcap", "scarf"]) assert.equal(Sprite.fits(bare, id, Glyphs), false, id)
  assert.equal(Sprite.fits(bare, "sunglasses", Glyphs), true)
  const dressed = synthetic({ anchors: { head: [3, 0], neck: [3, 6] } })
  for (const id of Glyphs.WARDROBE) assert.equal(Sprite.fits(dressed, id, Glyphs), true, id)
  // Without the Glyphs module it knows the built-in accessories.
  assert.equal(Sprite.fits(dressed, "crown"), true)
  assert.equal(Sprite.fits(bare, "scarf"), false)
  assert.equal(Sprite.fits(dressed, "bogus", Glyphs), false)
  assert.equal(Sprite.fits(dressed, "bogus"), false)
})

test("wardrobe: every built-in can wear everything, on every frame, without a pixel cut off", () => {
  const P = Sprite.PAD
  for (const ch of builtins) {
    for (const id of Glyphs.WARDROBE) assert.ok(Sprite.fits(ch, id, Glyphs), ch.id + " fits " + id)
    for (const [pose, p] of Object.entries(ch.poses)) {
      if (p.from !== pose) continue
      p.frames.forEach((fr, fi) => {
        const where = ch.id + " " + pose + "/" + fi
        const [nx, ny] = fr.anchors.neck || []
        assert.ok(fr.anchors.neck && fr.rows[ny][nx] !== ".", where + ": neck on the body")
        for (const [id, acc] of Object.entries(Glyphs.ACCESSORIES)) {
          const blocks = Sprite.placement(acc, fr.anchors, ch.eyes.style)
          assert.ok(blocks.length > 0, where + ": places " + id)
          for (const b of blocks) b.rows.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) {
              if (row[rx] === ".") continue
              const x = b.x + rx, y = b.y + ry
              assert.ok(x >= -P && x < ch.w + P && y >= -P && y < ch.h, where + ": " + id + " pixel " + x + "," + y + " is cut off")
            }
          })
        }
      })
    }
  }
})

test("wardrobe: worn items move with the body (flip and squash)", () => {
  const right = compose(cat, { accessories: ["scarf", "crown"] })
  const left = compose(cat, { accessories: ["scarf", "crown"], facing: -1 })
  const mirror = right.runs.map(([y, x, n, c]) => [y, right.w - x - n, n, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  assert.deepEqual(left.runs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), mirror)
  // A squash pivots on the body, so a tall hat doesn't move where it bends:
  // below the (squashed-down) hat the two are identical.
  const sq = compose(cat, { ops: { squash: 1 } })
  const sqHat = compose(cat, { ops: { squash: 1 }, accessories: ["partyhat"] })
  const head = cat.poses.idle.frames[0].anchors.head
  const below = comp => comp.runs.filter(r => r[0] >= comp.oy + head[1] + 2)
  assert.deepEqual(below(sqHat), below(sq))
})
