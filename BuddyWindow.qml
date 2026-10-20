import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Ui

// The buddy's surface: one transparent full-output layer above every window on
// every workspace. Only the buddy itself (and the stretch bubble while it's up)
// takes input; everything else clicks through, a visiting friend included.
// Hiding parks the content and empties the masks instead of unmapping, so
// showing it again is instant.
PanelWindow {
  id: win

  required property var controller
  property var friend: null              // a visiting friend's Controller (drawn behind the buddy)
  property var targetScreen: null
  property bool overFullscreen: false
  property var coach: null               // WellbeingCoach; its bubble lives in this window
  readonly property Item bubble: bubbleItem
  readonly property bool bubbleShown: bubbleItem.visible

  signal menuRequested(real x, real y)
  signal petted()
  signal dropped()

  screen: win.targetScreen
  visible: !remap.remapping
  color: "transparent"
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "pixel-buddy"
  WlrLayershell.layer: win.overFullscreen ? WlrLayer.Overlay : WlrLayer.Top
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  // While a press is held the hitbox grows a little, so a fast flick can't slip
  // off before the compositor's implicit grab takes over.
  readonly property int pad: input.pressedInside ? 48 : 0
  readonly property rect hit: win.controller.hitbox
  readonly property rect bubbleRect: win.bubbleShown
    ? Qt.rect(win.bubble.x, win.bubble.y, win.bubble.width, win.bubble.height) : Qt.rect(0, 0, 0, 0)
  readonly property bool friendDrawn: !!win.friend && (win.friend.view.visible === true || win.friend.portals.length > 0)
  readonly property rect friendRect: win.friendDrawn ? win.friend.bounds : Qt.rect(0, 0, 0, 0)

  mask: Region {
    x: win.hit.width > 0 ? Math.round(win.hit.x - win.pad) : 0
    y: win.hit.width > 0 ? Math.round(win.hit.y - win.pad) : 0
    width: win.hit.width > 0 ? Math.round(win.hit.width + 2 * win.pad) : 0
    height: win.hit.width > 0 ? Math.round(win.hit.height + 2 * win.pad) : 0
    Region {
      x: Math.round(win.bubbleRect.x)
      y: Math.round(win.bubbleRect.y)
      width: Math.round(win.bubbleRect.width)
      height: Math.round(win.bubbleRect.height)
    }
  }

  // Tells Hyprland which part of this full-screen surface can have pixels.
  HyprlandWindow.visibleMask: Region {
    x: Math.round(win.controller.bounds.x)
    y: Math.round(win.controller.bounds.y)
    width: win.controller.view.visible || win.controller.portals.length > 0 ? Math.round(win.controller.bounds.width) : 0
    height: win.controller.view.visible || win.controller.portals.length > 0 ? Math.round(win.controller.bounds.height) : 0
    Region {
      x: Math.round(win.bubbleRect.x)
      y: Math.round(win.bubbleRect.y)
      width: Math.round(win.bubbleRect.width)
      height: Math.round(win.bubbleRect.height)
    }
    Region {
      x: Math.round(win.friendRect.x)
      y: Math.round(win.friendRect.y)
      width: Math.round(win.friendRect.width)
      height: Math.round(win.friendRect.height)
    }
  }

  ScreenMoveRemap { id: remap; window: win }

  // A visiting friend: its two portal slots, body and emote, behind the buddy.
  Repeater {
    model: 2
    delegate: SpriteCanvas {
      required property int index
      readonly property var p: win.friend && win.friend.portals.length > index ? win.friend.portals[index] : null
      visible: p !== null
      px: win.friend ? win.friend.px : 1
      gridW: p ? p.w : 0
      gridH: p ? p.h : 0
      runs: p ? p.runs : []
      x: p ? p.x : 0
      y: p ? p.y : 0
    }
  }
  SpriteCanvas {
    visible: !!win.friend && win.friend.view.visible === true
    px: win.friend ? win.friend.px : 1
    gridW: win.friend ? win.friend.sprite.w || 0 : 0
    gridH: win.friend ? win.friend.sprite.h || 0 : 0
    runs: win.friend ? win.friend.sprite.runs || [] : []
    x: win.friend ? win.friend.view.x || 0 : 0
    y: win.friend ? win.friend.view.y || 0 : 0
  }
  SpriteCanvas {
    readonly property var e: win.friend ? win.friend.emote : null
    visible: e !== null && !!win.friend && win.friend.view.visible === true
    px: win.friend ? Math.max(2, win.friend.px - 1) : 1
    gridW: e ? e.w : 0
    gridH: e ? e.h : 0
    runs: e ? e.runs : []
    x: e ? e.x : 0
    y: e ? e.y : 0
  }

  // Two portal slots (entry and exit), behind the buddy.
  SpriteCanvas {
    readonly property var p: win.controller.portals.length > 0 ? win.controller.portals[0] : null
    visible: p !== null
    px: win.controller.px
    gridW: p ? p.w : 0
    gridH: p ? p.h : 0
    runs: p ? p.runs : []
    x: p ? p.x : 0
    y: p ? p.y : 0
  }
  SpriteCanvas {
    readonly property var p: win.controller.portals.length > 1 ? win.controller.portals[1] : null
    visible: p !== null
    px: win.controller.px
    gridW: p ? p.w : 0
    gridH: p ? p.h : 0
    runs: p ? p.runs : []
    x: p ? p.x : 0
    y: p ? p.y : 0
  }

  SpriteCanvas {
    id: body
    visible: win.controller.view.visible === true
    px: win.controller.px
    gridW: win.controller.sprite.w || 0
    gridH: win.controller.sprite.h || 0
    runs: win.controller.sprite.runs || []
    x: win.controller.view.x || 0
    y: win.controller.view.y || 0
  }

  SpriteCanvas {
    readonly property var e: win.controller.emote
    visible: e !== null && win.controller.view.visible === true
    px: Math.max(2, win.controller.px - 1)
    gridW: e ? e.w : 0
    gridH: e ? e.h : 0
    runs: e ? e.runs : []
    x: e ? e.x : 0
    y: e ? e.y : 0
  }

  Bubble {
    id: bubbleItem
    coach: win.coach
    anchorX: win.controller.view.feetX || 0
    anchorTop: win.controller.hitbox.height > 0 ? win.controller.hitbox.y : (win.controller.view.feetY || 0) - 48
    anchorBottom: win.controller.view.feetY || 0
    areaWidth: win.width
    areaHeight: win.height
  }

  MouseArea {
    id: input
    property bool pressedInside: false
    property bool dragging: false
    property real lastClickAt: 0     // a second click within 350 ms is a double-click
    property real pressX: 0
    property real pressY: 0

    x: Math.round(win.hit.x - win.pad)
    y: Math.round(win.hit.y - win.pad)
    width: Math.round(win.hit.width + 2 * win.pad)
    height: Math.round(win.hit.height + 2 * win.pad)
    enabled: win.hit.width > 0 || pressedInside
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    hoverEnabled: true
    cursorShape: dragging ? Qt.ClosedHandCursor : Qt.OpenHandCursor

    onEntered: win.controller.hover(true)
    onExited: win.controller.hover(false)

    onPressed: function (mouse) {
      var p = mapToItem(win.contentItem, mouse.x, mouse.y)
      if (mouse.button === Qt.RightButton) { win.menuRequested(p.x, p.y); return }
      pressX = p.x
      pressY = p.y
      pressedInside = true
      dragging = false
      watchdog.restart()
    }
    onPositionChanged: function (mouse) {
      if (!pressedInside) return
      var p = mapToItem(win.contentItem, mouse.x, mouse.y)
      if (!dragging && Math.abs(p.x - pressX) + Math.abs(p.y - pressY) > 5) {
        dragging = true
        win.controller.dragStart(pressX, pressY)
      }
      if (dragging) win.controller.dragMove(p.x, p.y)
      watchdog.restart()
    }
    onReleased: function (mouse) { finish(mouse.button === Qt.LeftButton) }
    onCanceled: finish(false)
    onPressedChanged: if (!pressed && pressedInside) finish(false)

    function finish(click) {
      if (!pressedInside) return
      pressedInside = false
      watchdog.stop()
      if (dragging) {
        dragging = false
        win.controller.dragEnd()
        win.dropped()
      } else if (click) {
        var now = Date.now()
        if (now - lastClickAt < 350) {
          lastClickAt = 0
          win.controller.special()
        } else {
          lastClickAt = now
          win.controller.pet()
        }
        win.petted()
      }
    }
  }

  // A press that never sees a release (compositor hiccup, lost grab) must not
  // leave the buddy glued to the pointer.
  Timer { id: watchdog; interval: 3000; onTriggered: input.finish(false) }

  function cancelDrag() { input.finish(false) }
}
