// Battery saver. Every frame the buddy draws costs CPU (about half a percent of
// a core per frame per second on a laptop iGPU), so on battery it does less:
// fewer, slower animation frames, less wandering, no excursions, and slower
// polling of the cursor and window geometry.

var NORMAL = {
  saver: false,
  walkFps: 99, idleFps: 99, sleepFps: 99,   // no caps: use the character's own rates
  blinkScale: 1, wanderScale: 1,
  hangs: true, specials: true,
  cursorMs: [250, 1000],                     // [while the pointer moves, otherwise]
  geometryMs: [2000, 5000],                  // [floating windows visible, otherwise]
  fastHz: 0                                  // 0: smooth moves follow the display
}

var SAVER = {
  saver: true,
  walkFps: 5, idleFps: 0.6, sleepFps: 0.5,
  blinkScale: 2, wanderScale: 0.4,
  hangs: false, specials: false,
  cursorMs: [1000, 3000],
  geometryMs: [5000, 15000],
  fastHz: 30
}

// setting: "auto" (on battery) | "on" | "off"
function isSaver(setting, onBattery) {
  return setting === "on" || (setting !== "off" && !!onBattery)
}

function policy(saver) { return saver ? SAVER : NORMAL }

if (typeof module !== "undefined") module.exports = { NORMAL: NORMAL, SAVER: SAVER, isSaver: isSaver, policy: policy }
