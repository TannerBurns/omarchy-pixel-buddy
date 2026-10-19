import QtQuick
import Quickshell
import qs.Ui
import qs.Commons

// Pixel Buddy on the bar: the buddy's face, plus the minutes left while a focus
// round or its break runs. Left click calls the buddy over (showing it first
// if it's hidden), right click opens the menu, middle click starts or stops
// focus. Hovering shows the next stretch and the focus state.
//
// The widget talks to this plugin's own service. Under a replacement bar (no
// service access), or while a just-updated widget meets the older service the
// shell keeps loaded until it restarts, it falls back to fixed IPC commands.
BarWidget {
  id: root

  readonly property string version: "0.3.0"
  readonly property string pluginId: "tannerburns.pixel-buddy"
  readonly property var svc: root.bar && root.bar.shell && typeof root.bar.shell.serviceFor === "function"
    ? root.bar.shell.serviceFor(root.pluginId) : null
  readonly property bool live: !!root.svc && root.svc.apiVersion === 1
  readonly property bool shown: root.live ? root.svc.barIcon : true
  readonly property var face: root.live ? root.svc.barFace : null
  readonly property string countdown: root.live ? root.svc.barText : ""
  readonly property int iconPx: root.face && root.face.h > 0 ? Math.max(1, Math.floor((root.barSize - 6) / root.face.h)) : 1

  property bool popupOpen: false
  function close() { root.popupOpen = false }

  // Tell the service where this icon is (focus goes up here, and comes back
  // down from here).
  property var registeredWith: null
  function register() {
    if (!root.live || root.registeredWith === root.svc) return
    root.registeredWith = root.svc
    root.svc.registerBarIcon(root)
  }
  Component.onCompleted: root.register()
  onLiveChanged: root.register()
  Component.onDestruction: {
    try { if (root.registeredWith) root.registeredWith.unregisterBarIcon(root) } catch (e) {}
  }

  visible: root.shown
  implicitWidth: root.shown ? row.implicitWidth + Style.space(12) : 0
  implicitHeight: root.barSize

  Row {
    id: row
    anchors.centerIn: parent
    spacing: Style.space(5)

    SpriteCanvas {
      visible: root.face !== null && root.face.w > 0
      anchors.verticalCenter: parent.verticalCenter
      px: root.iconPx
      gridW: root.face ? root.face.w : 0
      gridH: root.face ? root.face.h : 0
      runs: root.face ? root.face.runs : []
    }

    // Fallback mark when the service isn't reachable.
    Text {
      visible: !root.live
      anchors.verticalCenter: parent.verticalCenter
      text: "󰊠"
      textFormat: Text.PlainText
      color: root.bar ? root.bar.barForeground : Color.foreground
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      visible: root.countdown !== "" && !root.vertical
      anchors.verticalCenter: parent.verticalCenter
      text: root.countdown
      textFormat: Text.PlainText
      color: root.bar ? root.bar.barForeground : Color.foreground
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
    }
  }

  // Where the click landed, for dropping the buddy in under the icon: the bar
  // spans its monitor, so its window coordinates are the monitor's.
  function iconX() {
    var win = root.QsWindow.window
    if (!win) return -1
    return Math.round(root.mapToItem(win.contentItem, root.width / 2, 0).x)
  }
  function screenName() {
    var win = root.QsWindow.window
    return win && win.screen ? String(win.screen.name || "") : ""
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton

    onClicked: function (mouse) {
      if (root.bar) root.bar.hideTooltip(root)
      if (mouse.button === Qt.RightButton) {
        if (root.live) root.popupOpen = !root.popupOpen
        else if (root.bar) root.bar.run("omarchy-shell pixel-buddy menu")
      } else if (mouse.button === Qt.MiddleButton) {
        if (root.live) root.svc.barAction("focus", "", -1)
        else if (root.bar) root.bar.run("omarchy-shell pixel-buddy focus toggle")
      } else {
        if (root.live) root.svc.barAction("summon", root.screenName(), root.iconX())
        else if (root.bar) root.bar.run("omarchy-shell pixel-buddy show")
      }
    }
    onEntered: if (root.bar) root.bar.showTooltip(root, root.live ? root.svc.barTooltip : "Pixel Buddy\nRestart the shell to finish updating (omarchy restart shell)")
    onExited: if (root.bar) root.bar.hideTooltip(root)
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    open: root.popupOpen && root.live
    contentWidth: popup.fittedContentWidth(Style.space(300))
    contentHeight: popup.fittedContentHeight(content.item ? content.item.implicitHeight : 0)

    // Built only while the popup is up.
    Loader {
      id: content
      anchors.left: parent.left
      anchors.right: parent.right
      active: popup.visible && root.live
      focus: true
      sourceComponent: Component {
        MenuContent {
          service: root.svc
          width: content.width
          onCloseRequested: root.close()
        }
      }
    }
  }
}
