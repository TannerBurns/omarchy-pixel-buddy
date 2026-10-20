import QtQuick
import qs.Commons
import "js/Sprite.js" as Sprite
import "js/Glyphs.js" as Glyphs
import "js/CharacterSchema.js" as Schema

// What the menu shows: the character (or "surprise me daily"), movement mode,
// size, colors, motion, bar section and friend visits, focus, a stretch now,
// inviting a friend, snoozing nudges, hiding, today's stats and the wardrobe.
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
  property string hint: ""            // the hovered wardrobe tile
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

  // The buddy on screen wearing one accessory, for the wardrobe tiles: its
  // head and whatever it wears there, like the bar icon.
  function wearPreview(id) {
    var ch = content.service.shownCharacter
    if (!ch) return { runs: [], w: 0, h: 0 }
    var opts = { character: ch, colors: Schema.resolveColors(ch, content.settings.colors, content.service.themeColors), glyphs: Glyphs }
    var bare = Sprite.compose(opts)
    var dressed = Sprite.compose(Object.assign({}, opts, { accessories: [id] }))
    var extra = bare.bbox && dressed.bbox ? Math.max(0, bare.bbox.y0 - dressed.bbox.y0) : 0
    return Sprite.crop(dressed, Math.min(17, 14 + extra))
  }

  function wardrobeHint(t) {
    if (!t.unlocked) return t.name + ": " + t.text
    if (!t.fits) return t.name + " doesn't fit " + (content.service.shownCharacter ? content.service.shownCharacter.name : "this one")
    return t.name + (t.worn ? ": click to take it off" : ": click to wear it")
  }

  // Without a hovered tile: the locked accessory closest to unlocking.
  function nextUnlock() {
    var best = null, ratio = -1
    var w = content.service.wardrobe
    for (var i = 0; i < w.length; i++) {
      var t = w[i]
      if (t.unlocked) continue
      var m = /^(\d+)\/(\d+)/.exec(t.text)
      var r = m ? parseInt(m[1], 10) / Math.max(1, parseInt(m[2], 10)) : 0
      if (r > ratio) { ratio = r; best = t }
    }
    return best ? "Next up: " + best.name.toLowerCase() + ", " + best.text : "Everything's unlocked. Click one to wear it."
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
    label: "Friends"
    options: [["on", "Visits on"], ["off", "Off"]]
    value: content.settings.friends ? "on" : "off"
    accent: content.accent; fg: content.fg; bg: content.bg; dim: content.dim
    onPicked: function (v) { content.service.setSetting("friends", v === "on" ? "true" : "false") }
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
      text: "Invite a friend"
      accent: content.accent; fg: content.fg; bg: content.bg
      onPicked: { content.closeRequested(); content.service.inviteFriend("random") }
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

  // Wardrobe: accessories the stats unlock. A click puts one on or takes it
  // off; locked ones are dimmed, and hovering shows how far along you are.
  Row {
    spacing: 6
    Text {
      width: 56
      anchors.verticalCenter: parent.verticalCenter
      text: "Wear"
      textFormat: Text.PlainText
      color: content.dim
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }
    Repeater {
      model: content.service.wardrobe
      delegate: Item {
        id: tile
        required property var modelData
        readonly property var p: content.wearPreview(modelData.id)
        width: content.cell
        height: content.cell
        opacity: modelData.unlocked && modelData.fits ? 1 : 0.35
        Rectangle {
          anchors.fill: parent
          color: tileMouse.containsMouse ? Qt.darker(content.bg, 1.25) : "transparent"
          border.color: tile.modelData.worn ? content.accent : "transparent"
          border.width: 2
        }
        SpriteCanvas {
          px: Math.max(1, Math.min(2, Math.floor((content.cell - 6) / Math.max(1, Math.max(tile.p.w, tile.p.h)))))
          gridW: tile.p.w
          gridH: tile.p.h
          runs: tile.p.runs
          anchors.centerIn: parent
        }
        MouseArea {
          id: tileMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: tile.modelData.unlocked && tile.modelData.fits ? Qt.PointingHandCursor : Qt.ArrowCursor
          onEntered: content.hint = content.wardrobeHint(tile.modelData)
          onExited: content.hint = ""
          onClicked: {
            if (tile.modelData.unlocked && tile.modelData.fits) content.service.toggleWear(tile.modelData.id)
          }
        }
      }
    }
  }

  Text {
    width: parent.width
    text: content.hint || content.nextUnlock()
    textFormat: Text.PlainText
    elide: Text.ElideRight
    color: content.dim
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
  }

  Rectangle { width: parent.width; height: 2; color: Qt.darker(content.line, 1.5) }

  Text {
    width: parent.width
    text: {
      var lines = []
      if (content.service.focusLabel) lines.push(content.service.focusLabel)
      lines.push(content.service.wellbeingLine)
      if (content.service.statsLine) lines.push(content.service.statsLine)
      return lines.join("\n")
    }
    textFormat: Text.PlainText
    color: content.dim
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }
}
