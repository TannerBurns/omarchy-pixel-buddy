import QtQuick

// Paints pixel runs ([y, x, length, "#rrggbb"]) at an integer scale with hard
// edges. Repaints only when the runs change; moving the item costs no paint.
Canvas {
  id: canvas

  property var runs: []
  property int px: 3          // logical pixels per art pixel
  property int gridW: 0
  property int gridH: 0

  width: gridW * px
  height: gridH * px
  antialiasing: false
  smooth: false
  renderTarget: Canvas.Image
  renderStrategy: Canvas.Immediate

  onRunsChanged: requestPaint()
  onPxChanged: requestPaint()
  onWidthChanged: requestPaint()
  onHeightChanged: requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    ctx.reset()
    var r = canvas.runs
    if (!r) return
    var s = canvas.px
    for (var i = 0; i < r.length; i++) {
      var run = r[i]
      ctx.fillStyle = run[3]
      ctx.fillRect(run[1] * s, run[0] * s, run[2] * s, s)
    }
  }
}
