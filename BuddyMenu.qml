import QtQuick
import Quickshell
import Quickshell.Hyprland
import qs.Commons
import "js/Sprite.js" as Sprite
import "js/Glyphs.js" as Glyphs
import "js/CharacterSchema.js" as Schema

// Right-click menu: pick a character (or "surprise me daily"), movement mode,
// size, colors and motion, start a stretch, snooze nudges, or hide. A popup of
// the buddy's surface; an outside click or Esc closes it.
PopupWindow {
  id: menu

  required property var service
  property var anchorWindow: null
  property rect anchorRect: Qt.rect(0, 0, 1, 1)
  property bool open: false

  readonly property var settings: menu.service.settings
  readonly property color bg: Color.popups.background
  readonly property color fg: Color.popups.text
  readonly property color line: Color.popups.border
  readonly property color accent: Color.accent
  readonly property color dim: Qt.darker(Color.popups.text, 1.6)
  readonly property int cell: 40

  visible: menu.open && menu.anchorWindow !== null
  color: "transparent"
  implicitWidth: 312
  implicitHeight: body.implicitHeight + 24

  anchor.window: menu.anchorWindow
  anchor.rect.x: menu.anchorRect.x
  anchor.rect.y: menu.anchorRect.y
  anchor.rect.width: Math.max(1, menu.anchorRect.width)
  anchor.rect.height: Math.max(1, menu.anchorRect.height)
  anchor.edges: Edges.Top | Edges.Left
  anchor.gravity: Edges.Top | Edges.Left
  anchor.adjustment: PopupAdjustment.Slide | PopupAdjustment.Flip

  function close() { menu.open = false }

  // Opened by a right-click: a real popup grab, so the compositor closes the
  // menu on any click outside it and gives it keyboard focus (Esc works).
  // A popup grab needs a fresh click on the buddy, so when the menu is opened
  // over IPC (no click) it falls back to Hyprland's focus grab, which, like
  // Omarchy's PopupCard, includes the always-mapped buddy surface.
  property bool fromClick: true
  grabFocus: menu.fromClick
  onVisibleChanged: if (!visible && menu.open) menu.open = false

  HyprlandFocusGrab {
    active: menu.visible && !menu.fromClick
    windows: menu.anchorWindow ? [menu, menu.anchorWindow] : [menu]
    onCleared: menu.close()
  }

  function preview(id) {
    var ch = menu.service.registry.byId[id]
    if (!ch) return { runs: [], w: 0, h: 0 }
    var colors = Schema.resolveColors(ch, menu.settings.colors, menu.service.themeColors)
    var c = Sprite.compose({ character: ch, colors: colors, glyphs: Glyphs })
    if (!c.bbox) return { runs: [], w: 0, h: 0 }
    var runs = c.runs.map(function (r) { return [r[0] - c.bbox.y0, r[1] - c.bbox.x0, r[2], r[3]] })
    return { runs: runs, w: c.bbox.x1 - c.bbox.x0 + 1, h: c.bbox.y1 - c.bbox.y0 + 1 }
  }

  // Pixel frame: 2 px border with notched corners.
  Item {
    anchors.fill: parent
    Rectangle { x: 2; y: 0; width: parent.width - 4; height: parent.height; color: menu.line }
    Rectangle { x: 0; y: 2; width: parent.width; height: parent.height - 4; color: menu.line }
    Rectangle { x: 4; y: 2; width: parent.width - 8; height: parent.height - 4; color: menu.bg }
    Rectangle { x: 2; y: 4; width: parent.width - 4; height: parent.height - 8; color: menu.bg }
  }

  Item {
    id: keys
    anchors.fill: parent
    focus: true
    Keys.onEscapePressed: menu.close()
  }

  Column {
    id: body
    x: 12
    y: 12
    width: menu.implicitWidth - 24
    spacing: 10

    // Header
    Row {
      spacing: 10
      SpriteCanvas {
        readonly property var p: menu.open ? menu.preview(menu.service.characterId) : { runs: [], w: 0, h: 0 }
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
          text: menu.service.character ? menu.service.character.name : "Pixel Buddy"
          textFormat: Text.PlainText
          color: menu.fg
          font.family: Style.font.family
          font.pixelSize: Style.font.title
          font.bold: true
        }
        Text {
          text: (menu.settings.character === "daily" ? "Today's surprise" : "Pinned") + " · " + menu.service.statusLine
          textFormat: Text.PlainText
          color: menu.dim
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
      }
    }

    Rectangle { width: parent.width; height: 2; color: Qt.darker(menu.line, 1.5) }

    // Character grid
    Flow {
      width: parent.width
      spacing: 4
      Repeater {
        model: menu.open ? menu.service.registry.ids : []
        delegate: Item {
          required property string modelData
          readonly property bool current: menu.service.characterId === modelData
          readonly property var p: menu.preview(modelData)
          width: menu.cell
          height: menu.cell
          Rectangle {
            anchors.fill: parent
            color: tile.containsMouse ? Qt.darker(menu.bg, 1.25) : "transparent"
            border.color: parent.current ? menu.accent : "transparent"
            border.width: 2
          }
          SpriteCanvas {
            px: Math.max(1, Math.min(2, Math.floor((menu.cell - 6) / Math.max(1, Math.max(parent.p.w, parent.p.h)))))
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
            onClicked: menu.service.setSetting("character", modelData)
          }
        }
      }
    }

    Chip {
      text: "Surprise me daily"
      selected: menu.settings.character === "daily"
      onPicked: menu.service.setSetting("character", "daily")
    }

    Choice {
      label: "Mode"
      options: [["hopper", "Hopper"], ["patrol", "Patrol"], ["roam", "Roam"], ["stay", "Stay"]]
      value: menu.settings.mode
      onPicked: function (v) { menu.service.setSetting("mode", v) }
    }
    Choice {
      label: "Size"
      options: [["small", "S"], ["medium", "M"], ["large", "L"]]
      value: menu.settings.size
      onPicked: function (v) { menu.service.setSetting("size", v) }
    }
    Choice {
      label: "Colors"
      options: [["natural", "Natural"], ["theme", "Theme"]]
      value: menu.settings.colors
      onPicked: function (v) { menu.service.setSetting("colors", v) }
    }
    Choice {
      label: "Motion"
      options: [["full", "Full"], ["calm", "Calm"]]
      value: menu.settings.motion
      onPicked: function (v) { menu.service.setSetting("motion", v) }
    }

    Rectangle { width: parent.width; height: 2; color: Qt.darker(menu.line, 1.5) }

    Flow {
      width: parent.width
      spacing: 6
      Chip { text: "Stretch now"; onPicked: { menu.close(); menu.service.stretchNow() } }
      Chip { text: "Snooze reminders 1h"; onPicked: { menu.service.coachRef.snooze(60); menu.close() } }
      Chip { text: "Hide (Super+Alt+B)"; onPicked: { menu.close(); menu.service.setHidden(true) } }
    }

    Text {
      width: parent.width
      text: menu.service.wellbeingLine
      textFormat: Text.PlainText
      color: menu.dim
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  component Chip: Item {
    id: chip
    property string text: ""
    property bool selected: false
    signal picked()
    width: chipLabel.implicitWidth + 16
    height: chipLabel.implicitHeight + 8
    Rectangle {
      anchors.fill: parent
      color: chip.selected || chipMouse.containsMouse ? menu.accent : "transparent"
      border.color: menu.accent
      border.width: 2
    }
    Text {
      id: chipLabel
      anchors.centerIn: parent
      text: chip.text
      textFormat: Text.PlainText
      color: chip.selected || chipMouse.containsMouse ? menu.bg : menu.fg
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    MouseArea {
      id: chipMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: chip.picked()
    }
  }

  component Choice: Row {
    id: choice
    property string label: ""
    property var options: []
    property string value: ""
    signal picked(string v)
    spacing: 6
    Text {
      width: 56
      anchors.verticalCenter: parent.verticalCenter
      text: choice.label
      textFormat: Text.PlainText
      color: menu.dim
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }
    Repeater {
      model: choice.options
      delegate: Chip {
        required property var modelData
        text: modelData[1]
        selected: choice.value === modelData[0]
        onPicked: choice.picked(modelData[0])
      }
    }
  }
}
