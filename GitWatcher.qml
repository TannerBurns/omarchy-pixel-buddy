import QtQuick
import Quickshell
import Quickshell.Io
import "js/GitLog.js" as GitLog
import "js/Roster.js" as Roster

// Git celebrations. One long-lived helpers/git-watch.sh watches the reflogs of
// the repositories under `roots` and prints only fixed tokens (a commit, an
// amend, a push): never subjects, branches, paths or names. GitLog.js turns
// them into a few reactions at most (agents committing in bursts are muted).
Item {
  id: watcher

  property bool watching: true              // settings.gitCelebrate
  property string roots: ""                 // settings.gitRoots
  property bool buddyVisible: true          // nothing counts while it can't be seen
  property bool focusing: false             // only a sparkle during focus
  property var controller: null

  readonly property string home: Quickshell.env("HOME")
  readonly property var rootList: GitLog.parseRoots(watcher.roots, watcher.home)
  readonly property string script: {
    var u = Qt.resolvedUrl("helpers/git-watch.sh").toString()
    return u.indexOf("file://") === 0 ? decodeURIComponent(u.slice(7)) : u
  }

  property var log: GitLog.create()
  property int repos: -1                    // from the script's "# repos N"; -1 before the first scan
  property string mode: "inotify"           // "poll" when inotifywait is missing
  property string problem: ""               // "no-repos" | "crashed" | ""
  property int failures: 0
  property bool relaunch: false

  // Settings changes settle for 2 s before the watcher restarts.
  onRootListChanged: restartSoon.restart()
  onWatchingChanged: restartSoon.restart()
  Component.onCompleted: restartSoon.restart()
  Timer { id: restartSoon; interval: 2000; onTriggered: watcher.launch() }

  // A rescan every 30 minutes picks up new clones.
  Timer { interval: 30 * 60000; repeat: true; running: watcher.watching; onTriggered: watcher.launch() }
  Timer { id: backoff; onTriggered: watcher.launch() }

  function launch() {
    backoff.stop()
    if (proc.running) {
      // Restart once the old one has exited.
      watcher.relaunch = true
      proc.running = false
      return
    }
    if (!watcher.watching || watcher.rootList.length === 0) { watcher.repos = 0; return }
    var args = ["bash", watcher.script]
    if (watcher.mode === "poll") args.push("--poll", "30")
    // setpriv has the kernel stop the watcher the moment the shell exits (a
    // restart doesn't signal children); the script also checks on its own.
    proc.command = ["bash", "-c", "if command -v setpriv >/dev/null; then exec setpriv --pdeathsig TERM -- \"$@\"; fi; exec \"$@\"", "git-watch"]
      .concat(args).concat(watcher.rootList)
    proc.running = true
  }

  function rescan() { watcher.failures = 0; watcher.launch() }

  Process {
    id: proc
    stdout: SplitParser {
      onRead: function (line) { watcher.handle(line) }
    }
    onExited: function (code) {
      if (watcher.relaunch) { watcher.relaunch = false; watcher.launch(); return }
      if (!watcher.watching) return
      if (code === 3) { watcher.mode = "poll"; backoff.interval = 500; backoff.restart(); return }
      if (code === 4) { watcher.repos = 0; watcher.problem = "no-repos"; return }
      // Anything else is a crash: back off 5 s, 30 s, then every 5 minutes.
      watcher.problem = "crashed"
      backoff.interval = [5000, 30000, 300000][Math.min(watcher.failures, 2)]
      watcher.failures++
      backoff.restart()
    }
  }

  function handle(line) {
    var m = /^# repos ([0-9]+)/.exec(line)
    if (m) { watcher.repos = parseInt(m[1], 10); watcher.problem = ""; watcher.failures = 0; return }
    var kind = GitLog.parseLine(line)
    if (!kind) return
    var res = GitLog.decide(watcher.log, kind, Date.now(), { visible: watcher.buddyVisible, focus: watcher.focusing, dayKey: Roster.dayKey(new Date()) })
    watcher.log = res.state
    if (!res.action || !watcher.controller) return
    if (res.action === "commit") watcher.controller.react("celebrate")
    else if (res.action === "push" || res.action === "upgrade") watcher.controller.react("leap")
    else watcher.controller.react("sparkle")
  }

  function status() {
    return { enabled: watcher.watching, repos: watcher.repos, mode: watcher.mode, problem: watcher.problem,
             roots: watcher.rootList.length, today: watcher.log.day === Roster.dayKey(new Date()) ? watcher.log.count : 0 }
  }
}
