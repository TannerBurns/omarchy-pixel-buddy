#!/usr/bin/env bash
# Puts Pixel Buddy's icon on the bar, for installs from before 0.3.0.
#
# Those keep the buddy's settings in shell.json's plugins list, and Omarchy only
# places a bar widget for a plugin that isn't in that list yet. This saves the
# settings, disables and re-enables the plugin (which puts the icon on the
# right of the bar, after the tray) and copies the settings onto the new bar
# entry. Your saved spots, stretch history and focus timer are kept. Run it
# once, after updating and restarting the shell:
#
#   bash ~/.config/omarchy/plugins/tannerburns.pixel-buddy/scripts/add-to-bar.sh
set -euo pipefail

ID=tannerburns.pixel-buddy
CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/shell.json

fail() { echo "add-to-bar: $*" >&2; exit 1; }

command -v omarchy-shell >/dev/null || fail "omarchy-shell not found; run this in your Omarchy session"
[[ -f $CONFIG ]] || fail "no $CONFIG"

on_bar() {
  jq --arg id "$ID" '[(.bar.layout // {}) | (.left, .center, .right) | .[]? | (if type == "object" then .id else . end) | select(. == $id)] | length' "$CONFIG"
}

kinds=$(omarchy-shell shell listPlugins | jq -c --arg id "$ID" '.[] | select(.id == $id) | .kinds')
[[ -n $kinds ]] || fail "Pixel Buddy isn't installed"
if [[ $kinds != *bar-widget* ]]; then
  fail "the shell is still running Pixel Buddy from before 0.3.0; update and restart it first:
  omarchy plugin update $ID && omarchy restart shell"
fi

if (( $(on_bar) > 0 )); then
  echo "Pixel Buddy is already on the bar."
  exit 0
fi

entry=$(jq -c --arg id "$ID" '[.plugins[]? | select(type == "object" and .id == $id)] | first // {}' "$CONFIG")
echo "Your settings: $entry"

omarchy plugin disable "$ID" >/dev/null
omarchy plugin enable "$ID" >/dev/null

placed=0
for _ in {1..50}; do
  if (( $(on_bar) > 0 )); then placed=1; break; fi
  sleep 0.1
done
(( placed )) || fail "the icon didn't appear on the bar; your settings were: $entry"

while IFS= read -r key; do
  value=$(jq -c --arg k "$key" '.[$k]' <<<"$entry")
  omarchy bar set "$ID" "$key" "$value" --json >/dev/null
done < <(jq -r 'keys[] | select(. != "id")' <<<"$entry")

echo "Pixel Buddy is on the bar. Hide just the icon with: omarchy-shell pixel-buddy set barIcon false"
