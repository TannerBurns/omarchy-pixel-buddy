// Shared loaders for the unit tests. The js/ modules are plain scripts with a
// `module.exports` footer, so node can require() them as-is.
const path = require("node:path")
const fs = require("node:fs")

const ROOT = path.resolve(__dirname, "..", "..")
const js = name => require(path.join(ROOT, "js", name + ".js"))
const fixture = name => JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", name + ".json"), "utf8"))
const characterFiles = () => fs.readdirSync(path.join(ROOT, "characters"))
  .filter(f => f.endsWith(".json") && f !== "index.json")
  .map(f => path.join(ROOT, "characters", f))
const loadCharacter = file => {
  const res = js("CharacterSchema").validate(JSON.parse(fs.readFileSync(file, "utf8")))
  if (!res.ok) throw new Error(path.basename(file) + ": " + res.errors.join("; "))
  return res.character
}

// Seeded RNG so world tests are deterministic.
function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

module.exports = { ROOT, js, fixture, characterFiles, loadCharacter, rng }
