import QtQuick
import qs.Commons
import "js/Sprite.js" as Sprite
import "js/Glyphs.js" as Glyphs
import "js/CharacterSchema.js" as Schema

// What the menu shows: the character (or "surprise me daily"), movement mode,
// size, colors and motion, focus, a stretch now, snoozing nudges and hiding.
// Shared by the right-click menu on the buddy (BuddyMenu) and the bar icon's
// popup (BarWidget); each owns its own frame and closing.
Column {
  id: content

  required property var service
  property color bg: Color.popups.background
  property color fg: Color.popups.text
  property color line: Color.popups.border
  property color accent: Color.accent
  property color dim: Qt.darker(content.fg, 1.6)
  readonly property int cell: 40
  readonly property var settings: content.service.settings
  signal closeRequested()

  spacing: 10
  focus: true
  Keys.onEscapePressed: content.closeRequested()

  function preview(id) {
    var ch = content.service.registry.byId[id]
    if (!ch) return { runs: [], w: 0, h: 0 }
    var colors = Schema.resolveColors(ch, content.settings.colors, content.service.themeColors)
    return Sprite.crop(Sprite.compose({ character: ch, colors: colors, glyphs: Glyphs }))
  }

  // Header
  Row {
    spacing: 10
    SpriteCanvas {
      readonly property var p: content.preview(content.service.characterId)
      px: 3
      gridW: p.w
      gridH: p.h
      runs: p.runs
      anchors.verticalCenter: parent.verticalCenter
    }
    Column {
      anchors.verticalCenter: parent.verticalCenter
      spacing: 2
      Text {
        text: content.service.character ? content.service.character.name : "Pixel Buddy"
        textFormat: Text.PlainText
        color: content.fg
        font.family: Style.font.family
        font.pixelSize: Style.font.title
        font.bold: true
      }
      Text {
        text: (content.settings.character === "daily" ? "Today's surprise" : "Pinned") + " · " + content.service.statusLine
        textFormat: Text.PlainText
        color: content.dim
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }
  }

  Rectangle { width: parent.width; height: 2; color: Qt.darker(content.line, 1.5) }

  // Character grid
  Flow {
    width: parent.width
    spacing: 4
    Repeater {
      model: content.service.registry.ids
      delegate: Item {
        required property string modelData
        readonly property bool current: content.service.characterId === modelData
        readonly property var p: content.preview(modelData)
        width: content.cell
        height: content.cell
        Rectangle {
          anchors.fill: parent
          color: tile.containsMouse ? Qt.darker(content.bg, 1.25) : "transparent"
          border.color: parent.current ? content.accent : "transparent"
          border.width: 2
        }
        SpriteCanvas {
          px: Math.max(1, Math.min(2, Math.floor((content.cell - 6) / Math.max(1, Math.max(parent.p.w, parent.p.h)))))
          gridW: parent.p.w
          gridH: parent.p.h
          runs: parent.p.runs
          anchors.centerIn: parent
        }
        MouseArea {
          id: tile
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: content.service.setSetting("character", modelData)
        }
      }
    }
  }

  PixelChip {
    text: "Surprise me daily"
    selected: content.settings.character === "daily"
    accent: content.accent; fg: content.fg; bg: content.bg
    onPicked: content.service.setSetting("character", "daily")
  }

  PixelChoice {
    label: "Mode"
    options: [["hopper", "Hopper"], ["patrol", "Patrol"], ["roam", "Roam"], ["stay", "Stay"]]
    value: content.settings.mode
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.setSetting("mode", v) }
  }
  PixelChoice {
    label: "Size"
    options: [["small", "S"], ["medium", "M"], ["large", "L"]]
    value: content.settings.size
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.setSetting("size", v) }
  }
  PixelChoice {
    label: "Colors"
    options: [["natural", "Natural"], ["theme", "Theme"]]
    value: content.settings.colors
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.setSetting("colors", v) }
  }
  PixelChoice {
    label: "Motion"
    options: [["full", "Full"], ["calm", "Calm"]]
    value: content.settings.motion
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.setSetting("motion", v) }
  }
  PixelChoice {
    visible: content.service.entryHome === "bar"
    label: "Bar"
    options: [["left", "Left"], ["center", "Center"], ["right", "Right"]]
    value: content.service.barSection
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.moveBar(v) }
  }

  Rectangle { width: parent.width; height: 2; color: Qt.darker(content.line, 1.5) }

  Flow {
    width: parent.width
    spacing: 6
    PixelChip {
      text: content.service.focusRunning ? "Stop focus" : "Focus " + content.settings.focusMinutes + " min"
      selected: content.service.focusRunning
      accent: content.accent; fg: content.fg; bg: content.bg
      onPicked: { content.service.focusAction("toggle"); content.closeRequested() }
    }
    PixelChip {
      text: "Stretch now"
      accent: content.accent; fg: content.fg; bg: content.bg
      onPicked: { content.closeRequested(); content.service.stretchNow() }
    }
    PixelChip {
      text: "Snooze reminders 1h"
      accent: content.accent; fg: content.fg; bg: content.bg
      onPicked: { content.service.coachRef.snooze(60); content.closeRequested() }
    }
    PixelChip {
      text: content.service.hidden ? "Show" : "Hide (Super+Alt+B)"
      accent: content.accent; fg: content.fg; bg: content.bg
      onPicked: { content.closeRequested(); content.service.setHidden(!content.service.hidden) }
    }
  }

  Text {
    width: parent.width
    text: content.service.focusLabel ? content.service.focusLabel + "\n" + content.service.wellbeingLine : content.service.wellbeingLine
    textFormat: Text.PlainText
    color: content.dim
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }
}
