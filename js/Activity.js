// What is Tanner doing? Window class + title → an activity category, and the
// buddy's mood for it. Titles are only ever classified, never stored or logged.

var CATEGORIES = ["coding", "terminal", "ai", "browsing", "reading", "chat", "design", "video", "gaming", "files", "system", "desktop", "other"]

var MOOD = {
  coding: "focused", terminal: "focused", ai: "focused",
  browsing: "reading", reading: "reading",
  chat: "social",
  design: "creative",
  video: "chill",
  gaming: "playful", desktop: "playful",
  files: "curious", system: "curious",
  other: "chill"
}

// Props the buddy picks up when sitting in each mood.
var MOOD_PROP = { focused: "laptop", reading: "book", creative: "brush", playful: null, curious: null, social: null, chill: null }
var MOOD_EMOTE = { social: "dots", curious: "question" }

var CLASS_RULES = [
  [/^(code|code-oss|code-url-handler|codium|vscodium|com\.visualstudio\.code.*|com\.microsoft\.vscode.*|cursor|zed|dev\.zed\.zed.*|neovide|sublime_text|com\.sublimetext\..*|gvim|emacs|org\.kde\.kate|kate|gnome-builder|org\.gnome\.builder|jetbrains-.*|android-studio|lapce|dev\.lapce\..*|helix)$/, "coding"],
  [/^(alacritty|kitty|foot|footclient|ghostty|com\.mitchellh\.ghostty|org\.wezfurlong\.wezterm|wezterm|xterm|uxterm|konsole|org\.kde\.konsole|gnome-terminal.*|org\.gnome\.console|kgx|terminator|tilix|com\.gexperts\.tilix|st|st-256color|urxvt|rxvt|warp|dev\.warp\.warp)$/, "terminal"],
  [/^(org\.omarchy\.agent|claude|chatgpt|com\.openai\..*)$/, "ai"],
  [/^(chromium|google-chrome.*|firefox.*|org\.mozilla\.firefox|brave-browser.*|zen|zen-browser|app\.zen_browser\.zen|librewolf|vivaldi.*|microsoft-edge.*|org\.qutebrowser\.qutebrowser|qutebrowser|epiphany|org\.gnome\.epiphany|floorp|thorium-browser|helium)$/, "browsing"],
  [/^(obsidian|md\.obsidian\.obsidian|typora|libreoffice.*|soffice|org\.onlyoffice\..*|zathura|org\.pwmt\.zathura|evince|org\.gnome\.evince|okular|org\.kde\.okular|xournalpp|com\.github\.xournalpp\.xournalpp|logseq|notion.*|anki|calibre.*|foliate|com\.github\.johnfactotum\.foliate)$/, "reading"],
  [/^(slack|com\.slack\.slack|discord|vesktop|webcord|signal|org\.signal\.signal|telegram-desktop|org\.telegram\.desktop|whatsapp.*|teams.*|element|im\.riot\.riot|thunderbird|org\.mozilla\.thunderbird|geary|org\.gnome\.geary|zoom|us\.zoom\.zoom)$/, "chat"],
  [/^(gimp.*|org\.gimp\.gimp|inkscape|org\.inkscape\.inkscape|krita|org\.kde\.krita|blender|darktable|figma-linux|pinta|com\.github\.pinta_project\.pinta|aseprite|pixelorama|com\.orama_interactive\.pixelorama|libresprite|kdenlive|org\.kde\.kdenlive|obs|com\.obsproject\.studio|shotcut|org\.shotcut\.shotcut|davinci.*|resolve)$/, "design"],
  [/^(mpv|vlc|celluloid|io\.github\.celluloid_player\.celluloid|totem|org\.gnome\.totem|haruna|org\.kde\.haruna|kodi|spotify|com\.spotify\.client|jellyfin.*|stremio)$/, "video"],
  [/^(steam|steam_app_.*|steamwebhelper|lutris|net\.lutris\.lutris|heroic|com\.heroicgameslauncher\.hgl|gamescope|retroarch|org\.libretro\.retroarch|minecraft.*|prismlauncher|org\.prismlauncher\.prismlauncher|.*\.exe)$/, "gaming"],
  [/^(nautilus|org\.gnome\.nautilus|thunar|dolphin|org\.kde\.dolphin|nemo|pcmanfm.*|caja|yazi)$/, "files"],
  [/^(pavucontrol|org\.pulseaudio\.pavucontrol|com\.saivert\.pwvucontrol|blueman-manager|blueberry|nm-connection-editor|gnome-disks|org\.gnome\.diskutility|gparted|system-config-printer|1password|keepassxc|org\.keepassxc\.keepassxc|org\.omarchy\..*|impala|wiremix|bluetui|btop)$/, "system"]
]

// Hosts of Chrome/Chromium web apps ("chrome-<host>__<path>-Default") and
// browser title keywords.
var WEB_RULES = [
  [/youtube|netflix|twitch|primevideo|prime video|disneyplus|disney\+|hulu|max\.com|plex|crunchyroll|vimeo/, "video"],
  [/claude\.ai|claude|chatgpt|chat\.openai|gemini|perplexity|copilot/, "ai"],
  [/github|gitlab|bitbucket|stackoverflow|stack overflow|codepen|codesandbox|replit|vercel|localhost|127\.0\.0\.1|developer\.|docs\.rs|crates\.io|npmjs|pypi|readthedocs|mdn/, "coding"],
  [/slack|discord|teams|whatsapp|telegram|messenger|signal|gmail|mail\.google|outlook|proton\.me|hey\.com|basecamp|linear|zoom|meet\.google/, "chat"],
  [/figma|canva|excalidraw|tldraw|miro|photopea|penpot/, "design"],
  [/docs\.google|notion|confluence|wikipedia|medium\.com|substack|arxiv|kindle|reddit|news\.ycombinator|hacker news/, "reading"],
  [/steam|itch\.io|chess\.com|lichess|geforcenow|xbox\.com\/play/, "gaming"]
]

// Terminal titles usually name the running program.
var TERMINAL_RULES = [
  [/^(n?vim?|nvim|hx|helix|emacs|nano|micro|kak|code)\b/, "coding"],
  [/^(claude|codex|aider|gemini|opencode|crush|goose|amp|cursor-agent)\b|claude code/, "ai"],
  [/^(lazygit|lazydocker|git|gh|tig|make|cargo|go |npm|pnpm|yarn|bun|deno|node|python3?|pytest|ruby|rails|mix|gradle|mvn|cmake|ninja|docker|kubectl|k9s)\b/, "coding"],
  [/^(btop|htop|top|nvtop|bottom|btm|glances|journalctl|systemctl|sudo pacman|pacman|yay|paru|omarchy)\b/, "system"],
  [/^(yazi|ranger|lf|nnn|mc|vifm)\b/, "files"],
  [/^(man|less|bat|glow|w3m|lynx)\b/, "reading"],
  [/^(ssh|mosh|tmux|zellij)\b/, "terminal"]
]

// Strips spinner/status glyphs that agents and shells animate at the start of
// titles ("◐ ", "⠋ ", "✳ ", "● ").
function cleanTitle(title) {
  // Anything before the first letter/digit/path char is decoration (spinners,
  // status dots, emoji). Kept ASCII-safe for QML's regex engine.
  return String(title || "").replace(/^[^A-Za-z0-9\u00C0-\u024F~\/.(\[-]+/, "").trim()
}

function matchRules(rules, s) {
  for (var i = 0; i < rules.length; i++) if (rules[i][0].test(s)) return rules[i][1]
  return null
}

function classify(cls, title) {
  var c = String(cls || "").trim().toLowerCase()
  var t = cleanTitle(title).toLowerCase()
  if (c === "" && t === "") return "desktop"

  // Chrome/Chromium web apps: chrome-<host>__<path>-Default
  var web = c.match(/^(?:chrome|chromium|brave|msedge)-(.+?)__/)
  if (web) return matchRules(WEB_RULES, web[1].replace(/_/g, ".")) || "browsing"

  var cat = matchRules(CLASS_RULES, c)
  if (cat === "terminal") return matchRules(TERMINAL_RULES, t) || "terminal"
  if (cat === "browsing") return matchRules(WEB_RULES, t) || "browsing"
  if (cat === "ai") return "ai"
  if (cat) return cat
  return "other"
}

function moodOf(category) { return MOOD[category] || "chill" }

if (typeof module !== "undefined") module.exports = {
  CATEGORIES: CATEGORIES, MOOD: MOOD, MOOD_PROP: MOOD_PROP, MOOD_EMOTE: MOOD_EMOTE,
  classify: classify, moodOf: moodOf, cleanTitle: cleanTitle
}
