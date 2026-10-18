// Window geometry → the ledges the buddy can use, and where it perches for the
// focused window. All coordinates are logical pixels relative to the monitor.
//
// Ledge kinds:
//   floor  the bottom of the usable area (above any bottom bar)
//   stand  a window's top edge with room above it below the bar zone
//   hang   a window's top edge with no headroom (a maximized tiled window sits
//          ~10 px under the bar): the buddy may dangle under it, never stand
// Windows occlude ledges of windows beneath them.

// screen: { x, y, width, height } (logical, global); reserved: [l, t, r, b]
function monitorRect(screen, reserved) {
  var r = Array.isArray(reserved) && reserved.length === 4 ? reserved : [0, 0, 0, 0]
  var w = Math.max(1, Math.round(screen.width)), h = Math.max(1, Math.round(screen.height))
  return {
    gx: Math.round(screen.x), gy: Math.round(screen.y), w: w, h: h,
    left: r[0], top: r[1], right: w - r[2], bottom: h - r[3]
  }
}

// clients: hyprctl-shaped client objects (HyprlandToplevel.lastIpcObject).
// opts: { monitorId, workspaceIds: [ids visible on this monitor], border }
function clientRects(clients, mon, opts) {
  var out = []
  var border = opts.border || 0
  var wsIds = opts.workspaceIds || []
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (!c || !c.at || !c.size) continue
    if (c.mapped === false || c.hidden === true) continue
    if (opts.monitorId !== undefined && c.monitor !== opts.monitorId) continue
    var wsId = c.workspace ? c.workspace.id : null
    if (!c.pinned && wsIds.indexOf(wsId) < 0) continue
    if (c.fullscreen && c.fullscreen !== 0) continue
    var special = wsId !== null && wsId < 0
    var focus = typeof c.focusHistoryID === "number" ? c.focusHistoryID : 99
    out.push({
      address: String(c.address || ("w" + i)),
      cls: String(c["class"] || c.initialClass || ""),
      x: c.at[0] - mon.gx - border,
      y: c.at[1] - mon.gy - border,
      w: c.size[0] + 2 * border,
      h: c.size[1] + 2 * border,
      floating: !!c.floating,
      special: special,
      focus: focus,
      z: (special ? 2000 : 0) + (c.floating ? 1000 : 0) + (c.pinned ? 500 : 0) - focus
    })
  }
  out.sort(function (a, b) { return b.z - a.z })
  return out
}

function subtract(segments, a, b) {
  var out = []
  for (var i = 0; i < segments.length; i++) {
    var s = segments[i]
    if (b <= s[0] || a >= s[1]) { out.push(s); continue }
    if (a > s[0]) out.push([s[0], a])
    if (b < s[1]) out.push([b, s[1]])
  }
  return out
}

// sprite: { w, h } body size in logical px.
function ledges(rects, mon, sprite) {
  var list = [{ id: "floor", kind: "floor", x1: mon.left, x2: mon.right, y: mon.bottom, address: "", cls: "" }]
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i]
    if (r.y < mon.top || r.y >= mon.bottom - 4) continue
    var segs = [[Math.max(mon.left, r.x), Math.min(mon.right, r.x + r.w)]]
    for (var j = 0; j < i; j++) {
      var above = rects[j]
      if (above.y <= r.y && above.y + above.h > r.y) segs = subtract(segs, above.x, above.x + above.w)
    }
    var stand = r.y - sprite.h >= mon.top + 2
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s]
      if (seg[1] - seg[0] < sprite.w * 0.75) continue
      if (!stand && r.y + sprite.h > mon.bottom) continue
      list.push({ id: r.address + "/" + s, kind: stand ? "stand" : "hang", x1: seg[0], x2: seg[1], y: r.y, address: r.address, cls: r.cls })
    }
  }
  return list
}

function clamp(v, a, b) { return a > b ? (a + b) / 2 : v < a ? a : v > b ? b : v }

function widest(list) {
  var best = null
  for (var i = 0; i < list.length; i++) if (!best || list[i].x2 - list[i].x1 > best.x2 - best.x1) best = list[i]
  return best
}

function segmentAt(list, x) {
  for (var i = 0; i < list.length; i++) if (x >= list[i].x1 && x <= list[i].x2) return list[i]
  return widest(list)
}

// focused: a client rect (or null). learned: { cls: { kind, fx } } where fx is
// the fraction across the window where Tanner last dropped the buddy.
// Returns { kind, ledgeId, x, y, facing } or null.
function perchFor(focused, list, learned, sprite, mon) {
  if (!focused) return null
  var half = sprite.w / 2
  var mine = list.filter(function (l) { return l.address === focused.address })
  var stand = mine.filter(function (l) { return l.kind === "stand" })
  var hang = mine.filter(function (l) { return l.kind === "hang" })
  var floorX = function (fx) { return clamp(focused.x + fx * focused.w, mon.left + half, mon.right - half) }
  var inward = function (x) { return x > focused.x + focused.w / 2 ? -1 : 1 }
  var L = learned && focused.cls && learned[focused.cls]
  if (L && typeof L.fx === "number") {
    var want = focused.x + L.fx * focused.w
    if (L.kind === "stand" && stand.length > 0) {
      var s1 = segmentAt(stand, want)
      var x1 = clamp(want, s1.x1 + half, s1.x2 - half)
      return { kind: "stand", ledgeId: s1.id, x: x1, y: s1.y, facing: inward(x1) }
    }
    if (L.kind === "hang" && hang.length > 0) {
      var h1 = segmentAt(hang, want)
      var x2 = clamp(want, h1.x1 + half, h1.x2 - half)
      return { kind: "hang", ledgeId: h1.id, x: x2, y: h1.y, facing: inward(x2) }
    }
    if (L.kind === "floor") {
      var x3 = floorX(L.fx)
      return { kind: "floor", ledgeId: "floor", x: x3, y: mon.bottom, facing: inward(x3) }
    }
  }
  if (stand.length > 0) {
    var s2 = widest(stand)
    var x4 = clamp(s2.x1 + 0.7 * (s2.x2 - s2.x1), s2.x1 + half, s2.x2 - half)
    return { kind: "stand", ledgeId: s2.id, x: x4, y: s2.y, facing: -1 }
  }
  var x5 = floorX(0.92)
  return { kind: "floor", ledgeId: "floor", x: x5, y: mon.bottom, facing: inward(x5) }
}

function byId(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

// The standable ledge the feet are on (|y - ledge.y| <= tol and x over it).
function supportAt(list, x, y, halfW, tol) {
  var t = tol === undefined ? 1.5 : tol
  var best = null
  for (var i = 0; i < list.length; i++) {
    var l = list[i]
    if (l.kind === "hang") continue
    if (Math.abs(l.y - y) > t) continue
    if (x + halfW * 0.4 < l.x1 || x - halfW * 0.4 > l.x2) continue
    if (!best || l.y < best.y) best = l
  }
  return best
}

// Swept landing: the first standable ledge crossed while the feet moved from
// yFrom down to yTo (one-way platforms; never tunnels at any speed).
function landingBelow(list, x, yFrom, yTo, halfW) {
  var best = null
  for (var i = 0; i < list.length; i++) {
    var l = list[i]
    if (l.kind === "hang") continue
    if (l.y < yFrom - 0.01 || l.y > yTo) continue
    if (x + halfW * 0.4 < l.x1 || x - halfW * 0.4 > l.x2) continue
    if (!best || l.y < best.y) best = l
  }
  return best
}

// A hang ledge to dangle from, preferring the focused window's.
function hangSpot(list, address) {
  var hangs = list.filter(function (l) { return l.kind === "hang" })
  var mine = hangs.filter(function (l) { return l.address === address })
  return widest(mine.length > 0 ? mine : hangs)
}

if (typeof module !== "undefined") module.exports = {
  monitorRect: monitorRect, clientRects: clientRects, ledges: ledges, perchFor: perchFor,
  byId: byId, supportAt: supportAt, landingBelow: landingBelow, hangSpot: hangSpot, clamp: clamp
}
