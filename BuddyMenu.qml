import QtQuick
import Quickshell
import Quickshell.Hyprland
import qs.Commons

// Right-click menu on the buddy (contents in MenuContent.qml). A popup of the
// buddy's surface; an outside click or Esc closes it.
PopupWindow {
  id: menu

  required property var service
  property var anchorWindow: null
  property rect anchorRect: Qt.rect(0, 0, 1, 1)
  property bool open: false

  readonly property color bg: Color.popups.background
  readonly property color fg: Color.popups.text
  readonly property color line: Color.popups.border
  readonly property color accent: Color.accent
  readonly property color dim: Qt.darker(Color.popups.text, 1.6)

  visible: menu.open && menu.anchorWindow !== null
  color: "transparent"
  implicitWidth: 312
  implicitHeight: (body.item ? body.item.implicitHeight : 0) + 24

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

  // Pixel frame: 2 px border with notched corners.
  Item {
    anchors.fill: parent
    Rectangle { x: 2; y: 0; width: parent.width - 4; height: parent.height; color: menu.line }
    Rectangle { x: 0; y: 2; width: parent.width; height: parent.height - 4; color: menu.line }
    Rectangle { x: 4; y: 2; width: parent.width - 8; height: parent.height - 4; color: menu.bg }
    Rectangle { x: 2; y: 4; width: parent.width - 4; height: parent.height - 8; color: menu.bg }
  }

  // The contents are built only while the menu is open.
  Loader {
    id: body
    x: 12
    y: 12
    width: menu.implicitWidth - 24
    active: menu.open
    focus: true
    sourceComponent: Component {
      MenuContent {
        service: menu.service
        width: body.width
        bg: menu.bg
        fg: menu.fg
        line: menu.line
        accent: menu.accent
        dim: menu.dim
        onCloseRequested: menu.close()
      }
    }
  }
}
