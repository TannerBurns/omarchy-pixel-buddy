import QtQuick
import Quickshell
import Quickshell.Io
import "plugin" as Buddy

// Development harness (see scripts/dev-run.sh): runs the plugin in its own
// Quickshell instance with live reload. A stub stands in for Omarchy's shell
// facade and writes settings to a scratch shell.json instead of yours.
ShellRoot {
  id: harness

  readonly property string dir: Quickshell.env("PIXEL_BUDDY_DEV")

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
    settingsPath: harness.dir + "/shell.json"
    stateDir: harness.dir + "/state"
    shell: stubShell
  }
}
