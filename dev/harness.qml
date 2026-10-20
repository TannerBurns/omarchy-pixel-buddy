import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "plugin" as Buddy

// Development harness (see scripts/dev-run.sh): runs the plugin in its own
// Quickshell instance with live reload. A stub stands in for Omarchy's shell
// facade and writes settings to a scratch shell.json instead of yours. With
// PIXEL_BUDDY_DEV_BAR=1, a small strip under the top-right corner also stands
// in for the bar, hosting the plugin's bar widget against this instance's
// service (it sits over your windows, so it's off unless you ask for it).
ShellRoot {
  id: harness

  readonly property string dir: Quickshell.env("PIXEL_BUDDY_DEV")
  readonly property bool withBar: Quickshell.env("PIXEL_BUDDY_DEV_BAR") === "1"

  FileView {
    id: devConfig
    path: harness.dir + "/shell.json"
    printErrors: false
  }

  QtObject {
    id: stubShell
    property string pluginId: "tannerburns.pixel-buddy"
    property var bar: ({ barHidden: false, barSize: 26, position: "top" })
    function updateEntryInline(id, settings) {
      var entry = { id: id }
      for (var k in settings) if (k !== "id") entry[k] = settings[k]
      devConfig.setText(JSON.stringify({ version: 1, plugins: [entry] }, null, 2) + "\n")
      return true
    }
  }

  Buddy.Service {
    id: service
    settingsPath: harness.dir + "/shell.json"
    stateDir: harness.dir + "/state"
    shell: stubShell
  }

  QtObject {
    id: barStub
    property QtObject shell: QtObject {
      function serviceFor(id) { return id === "tannerburns.pixel-buddy" ? service : null }
    }
    property color foreground: "#c0caf5"
    property color barForeground: "#c0caf5"
    property color background: "#1a1b26"
    property string fontFamily: "monospace"
    property string position: "top"
    property bool vertical: false
    property int barSize: 30
    property bool foregroundAnimationEnabled: true
    property var activePopout: null
    function showTooltip(target, text) { console.log("bar tooltip: " + text.replace(/\n/g, " | ")) }
    function hideTooltip(target) {}
    function run(command) { console.log("bar run: " + command) }
    function requestPopout(owner) { barStub.activePopout = owner }
    function releasePopout(owner) { if (barStub.activePopout === owner) barStub.activePopout = null }
  }

  // Full width like the real bar (so the icon's x is the monitor's), but only
  // the strip on the right is drawn or takes clicks.
  LazyLoader {
    active: harness.withBar
    PanelWindow {
      anchors { top: true; left: true; right: true }
      margins { top: 40 }
      implicitHeight: barStub.barSize
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "pixel-buddy-dev-bar"
      WlrLayershell.layer: WlrLayer.Overlay
      color: "transparent"
      mask: Region { item: devStrip }

      Rectangle {
        id: devStrip
        anchors.right: parent.right
        anchors.rightMargin: 12
        width: devWidget.implicitWidth + 16
        height: parent.height
        color: "#e61a1b26"

        Buddy.BarWidget {
          id: devWidget
          anchors.centerIn: parent
          height: barStub.barSize
          bar: barStub
          moduleName: "tannerburns.pixel-buddy"
        }
      }
    }
  }
}
