#!/usr/bin/env node
// Rewrites character JSON files in the canonical layout: two-space indent, one
// pixel row per line, anchors and other number arrays on one line. Keeps art
// diffs readable. Usage: node scripts/format-characters.mjs [file.json ...]
// (defaults to every built-in character), --check to only report.

import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function isFlat(v) {
  return Array.isArray(v) && v.every(x => typeof x === "number" || (Array.isArray(x) && x.every(y => typeof y === "number")))
}

function fmt(v, indent) {
  const pad = " ".repeat(indent)
  const inner = " ".repeat(indent + 2)
  if (v === null || typeof v !== "object") return JSON.stringify(v)
  if (isFlat(v)) return JSON.stringify(v).replace(/,/g, ", ")
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]"
    return "[\n" + v.map(x => inner + fmt(x, indent + 2)).join(",\n") + "\n" + pad + "]"
  }
  const keys = Object.keys(v)
  if (keys.length === 0) return "{}"
  // Small objects of scalars or flat arrays stay on one line (anchors, palette entries, fps).
  const oneLine = keys.every(k => v[k] === null || typeof v[k] !== "object" || isFlat(v[k]))
  if (oneLine) {
    const s = "{ " + keys.map(k => JSON.stringify(k) + ": " + fmt(v[k], 0)).join(", ") + " }"
    if (s.length + indent <= 110) return s
  }
  return "{\n" + keys.map(k => inner + JSON.stringify(k) + ": " + fmt(v[k], indent + 2)).join(",\n") + "\n" + pad + "}"
}

export function format(json) { return fmt(json, 0) + "\n" }

function main() {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  let files = args.filter(a => a !== "--check")
  if (files.length === 0) {
    const dir = join(ROOT, "characters")
    files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json").map(f => join(dir, f))
  }
  let dirty = 0
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const out = format(JSON.parse(src))
    if (out !== src) {
      dirty++
      if (check) console.log("not formatted: " + f)
      else writeFileSync(f, out)
    }
  }
  if (check && dirty) process.exit(1)
  if (!check) console.log(`formatted ${files.length} file(s)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
