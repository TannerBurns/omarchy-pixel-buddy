import QtQuick
import qs.Commons

// The wellbeing speech bubble: a guided stretch (title, the current step, a
// stepped countdown) or the bedtime nudge. Pixel-styled, theme-colored, never
// takes keyboard focus, and ignores clicks for its first moments so a click
// meant for something else can't dismiss it by accident.
Item {
  id: bubble

  property var coach: null
  property real anchorX: 0        // buddy center (logical, window coords)
  property real anchorTop: 0      // top of the buddy's body
  property real anchorBottom: 0   // the buddy's feet
  property real areaWidth: 1280
  property real areaHeight: 800

  readonly property bool shown: !!(coach && coach.active && !coach.collapsed)
  readonly property int px: 2
  readonly property int maxWidth: 260
  readonly property color bg: Color.popups.background
  readonly property color fg: Color.popups.text
  readonly property color line: Color.popups.border
  readonly property color accent: Color.accent
  readonly property bool armed: coach ? Date.now() - coach.shownAt > 600 || armTimer.armed : false

  visible: shown
  z: 2
  width: Math.min(maxWidth, Math.max(180, content.implicitWidth + 2 * pad))
  height: content.implicitHeight + 2 * pad + tail
  readonly property int pad: 10
  readonly property int tail: 8
  readonly property bool below: anchorTop - height - 6 < 34

  x: Math.round(Math.max(6, Math.min(areaWidth - width - 6, anchorX - width / 2)))
  y: Math.round(below ? anchorBottom + 6 : anchorTop - height - 4)

  Timer {
    id: armTimer
    property bool armed: false
    interval: 650
    running: bubble.shown
    onRunningChanged: if (running) armed = false
    onTriggered: armed = true
  }

  // Body with stepped (pixel) corners.
  Item {
    id: card
    x: 0
    y: bubble.below ? bubble.tail : 0
    width: bubble.width
    height: bubble.height - bubble.tail

    Rectangle { x: bubble.px; y: 0; width: parent.width - 2 * bubble.px; height: parent.height; color: bubble.line }
    Rectangle { x: 0; y: bubble.px; width: parent.width; height: parent.height - 2 * bubble.px; color: bubble.line }
    Rectangle { x: bubble.px * 2; y: bubble.px; width: parent.width - 4 * bubble.px; height: parent.height - 2 * bubble.px; color: bubble.bg }
    Rectangle { x: bubble.px; y: bubble.px * 2; width: parent.width - 2 * bubble.px; height: parent.height - 4 * bubble.px; color: bubble.bg }
  }

  // Tail pointing at the buddy.
  Item {
    readonly property real cx: Math.max(14, Math.min(bubble.width - 14, bubble.anchorX - bubble.x))
    x: cx - 6
    y: bubble.below ? 0 : bubble.height - bubble.tail - bubble.px
    width: 12
    height: bubble.tail + bubble.px
    Rectangle { x: 2; y: bubble.below ? 4 : 0; width: 8; height: 6; color: bubble.line }
    Rectangle { x: 4; y: bubble.below ? 0 : 6; width: 4; height: 4; color: bubble.line }
    Rectangle { x: 4; y: bubble.below ? 6 : 0; width: 4; height: 4; color: bubble.bg }
  }

  Column {
    id: content
    x: bubble.pad
    y: (bubble.below ? bubble.tail : 0) + bubble.pad
    width: bubble.width - 2 * bubble.pad
    spacing: 6

    Text {
      width: parent.width
      text: bubble.coach ? bubble.coach.title : ""
      textFormat: Text.PlainText
      color: bubble.accent
      font.family: Style.font.family
      font.pixelSize: Style.font.body
      font.bold: true
      wrapMode: Text.WordWrap
    }

    Text {
      width: parent.width
      text: bubble.coach ? bubble.coach.body : ""
      textFormat: Text.PlainText
      color: bubble.fg
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      lineHeight: 1.1
    }

    // Stepped countdown: one block per second, filled as time passes.
    Row {
      visible: bubble.coach && bubble.coach.stepTotal > 0 && !bubble.coach.stepsDone
      spacing: 2
      Repeater {
        model: bubble.coach ? Math.min(30, bubble.coach.stepTotal) : 0
        delegate: Rectangle {
          required property int index
          readonly property int total: bubble.coach ? Math.min(30, bubble.coach.stepTotal) : 1
          readonly property int remaining: bubble.coach ? Math.ceil(bubble.coach.stepLeft * total / Math.max(1, bubble.coach.stepTotal)) : 0
          width: Math.max(3, Math.floor((content.width - 2 * (total - 1)) / total))
          height: 4
          color: index < total - remaining ? bubble.accent : Qt.darker(bubble.line, 1.6)
        }
      }
    }

    Text {
      visible: text !== ""
      width: parent.width
      text: bubble.coach ? bubble.coach.footer : ""
      textFormat: Text.PlainText
      color: Qt.darker(bubble.fg, 1.4)
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }

    Row {
      spacing: 6
      Repeater {
        model: bubble.coach ? bubble.coach.buttons : []
        delegate: Item {
          required property var modelData
          width: label.implicitWidth + 16
          height: label.implicitHeight + 8
          Rectangle {
            anchors.fill: parent
            color: hover.containsMouse ? bubble.accent : "transparent"
            border.color: bubble.accent
            border.width: 2
          }
          Text {
            id: label
            anchors.centerIn: parent
            text: modelData.label
            textFormat: Text.PlainText
            color: hover.containsMouse ? bubble.bg : bubble.fg
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            font.bold: modelData.primary === true
          }
          MouseArea {
            id: hover
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: if (bubble.armed && bubble.coach) bubble.coach.answer(modelData.id)
          }
        }
      }
    }
  }
}
