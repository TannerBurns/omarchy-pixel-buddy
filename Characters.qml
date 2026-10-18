import QtQuick
import Quickshell
import Quickshell.Io
import Qt.labs.folderlistmodel
import "js/CharacterSchema.js" as Schema

// Character registry: the built-ins listed in characters/index.json plus any
// JSON files in ~/.config/pixel-buddy/characters/ (watched; edits apply live).
// Broken files are logged once and skipped.
Item {
  id: reg

  property string customDir: ""
  property bool customDirReady: false     // set once the folder exists (see Service mkdirs)
  property var byId: ({})
  property var builtinIds: []
  property var customIds: []
  property var problems: ({})        // file name -> first error
  property int revision: 0
  property bool ready: false
  readonly property var ids: {
    var out = builtinIds.slice()
    for (var i = 0; i < customIds.length; i++) if (out.indexOf(customIds[i]) < 0) out.push(customIds[i])
    return out
  }

  readonly property string pluginDir: {
    var url = String(Qt.resolvedUrl("."))
    return url.indexOf("file://") === 0 ? decodeURIComponent(url.substring(7)) : url
  }

  property var _builtin: ({})
  property var _custom: ({})          // file path -> id

  function _register(path, text, custom) {
    var json = null
    try { json = JSON.parse(text) } catch (e) { _problem(path, "not valid JSON") ; return null }
    if (custom && text.length > 262144) { _problem(path, "larger than 256 KB"); return null }
    var res = Schema.validate(json)
    if (!res.ok) { _problem(path, res.errors[0]); return null }
    var ch = res.character
    ch.custom = !!custom
    var map = Object.assign({}, reg.byId)
    if (custom && reg._builtin[ch.id] && !reg._custom[path]) {
      // A custom file may override a built-in deliberately; keep the custom one.
    }
    map[ch.id] = ch
    reg.byId = map
    var p = Object.assign({}, reg.problems)
    delete p[path]
    reg.problems = p
    reg.revision++
    return ch
  }

  function _problem(path, message) {
    if (reg.problems[path] === message) return
    var p = Object.assign({}, reg.problems)
    p[path] = message
    reg.problems = p
    console.warn("pixel-buddy: skipping character " + path + ": " + message)
  }

  function _forgetCustom(path) {
    var id = reg._custom[path]
    if (!id) return
    var c = Object.assign({}, reg._custom)
    delete c[path]
    reg._custom = c
    _rebuildCustomIds()
    if (!reg._builtin[id]) {
      var map = Object.assign({}, reg.byId)
      delete map[id]
      reg.byId = map
    } else {
      builtinFiles.reloadOne(id)
    }
    reg.revision++
  }

  function _rebuildCustomIds() {
    var out = []
    for (var k in reg._custom) if (out.indexOf(reg._custom[k]) < 0) out.push(reg._custom[k])
    out.sort()
    reg.customIds = out
  }

  function reloadAll() {
    indexFile.reload()
    for (var i = 0; i < customFiles.count; i++) {
      var v = customFiles.objectAt(i)
      if (v) v.reload()
    }
  }

  // ---- built-ins

  FileView {
    id: indexFile
    path: reg.pluginDir + "/characters/index.json"
    printErrors: false
    onLoaded: {
      try {
        var list = JSON.parse(text()).characters
        reg.builtinIds = Array.isArray(list) ? list.filter(function (id) { return /^[a-z0-9][a-z0-9_-]*$/.test(id) }) : []
      } catch (e) {
        reg.builtinIds = []
        console.warn("pixel-buddy: characters/index.json is invalid")
      }
    }
    onLoadFailed: reg.builtinIds = []
  }

  Instantiator {
    id: builtinFiles
    model: reg.builtinIds
    property int loaded: 0

    function reloadOne(id) {
      for (var i = 0; i < count; i++) {
        var o = objectAt(i)
        if (o && o.charId === id) o.reload()
      }
    }

    delegate: FileView {
      required property string modelData
      readonly property string charId: modelData
      path: reg.pluginDir + "/characters/" + modelData + ".json"
      printErrors: false
      onLoaded: {
        var ch = reg._register(path, text(), false)
        if (ch) {
          var b = Object.assign({}, reg._builtin)
          b[ch.id] = true
          reg._builtin = b
        }
        builtinFiles.loaded++
        if (builtinFiles.loaded >= reg.builtinIds.length) reg.ready = true
      }
      onLoadFailed: {
        reg._problem(path, "could not be read")
        builtinFiles.loaded++
        if (builtinFiles.loaded >= reg.builtinIds.length) reg.ready = true
      }
    }
  }

  // ---- custom characters

  FolderListModel {
    id: customFolder
    // Only once the folder exists: a missing folder makes FolderListModel list
    // the process's working directory instead.
    folder: reg.customDirReady && reg.customDir !== "" ? "file://" + reg.customDir : ""
    showFiles: reg.customDirReady
    nameFilters: ["*.json"]
    showDirs: false
    showHidden: false
  }

  Instantiator {
    id: customFiles
    model: customFolder

    delegate: FileView {
      required property string filePath
      readonly property bool mine: reg.customDirReady && filePath.indexOf(reg.customDir + "/") === 0
      path: mine ? filePath : ""
      watchChanges: true
      printErrors: false
      onFileChanged: reload()
      onLoaded: {
        if (!mine) return
        var ch = reg._register(filePath, text(), true)
        var c = Object.assign({}, reg._custom)
        if (ch) c[filePath] = ch.id
        else delete c[filePath]
        reg._custom = c
        reg._rebuildCustomIds()
      }
      onLoadFailed: if (mine) reg._problem(filePath, "could not be read")
      Component.onDestruction: if (mine) reg._forgetCustom(filePath)
    }
  }
}
