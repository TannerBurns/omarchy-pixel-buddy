#!/usr/bin/env bash
# Regenerates the README media from the real modules: screenshots/*.png,
# screenshots/portal.gif and preview.png. Everything is rendered, never
# captured from a screen. Needs node and ImageMagick (magick).
#   bash scripts/make-media.sh
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DEMO="$ROOT/build/demo"
SHOTS="$ROOT/screenshots"
command -v magick >/dev/null || { echo "needs ImageMagick (magick)" >&2; exit 1; }

node "$ROOT/scripts/render-demo.mjs" --out "$DEMO"
mkdir -p "$SHOTS"
cp "$DEMO/characters.png" "$SHOTS/characters.png"
cp "$DEMO/expressions.png" "$SHOTS/expressions.png"
magick -delay 7 -loop 0 "$DEMO"/portal-*.png -filter point -resize 200% -layers Optimize "$SHOTS/portal.gif"

FONT=$(fc-match -f '%{file}' 'JetBrainsMono Nerd Font:style=Bold' 2>/dev/null || true)
BODY=$(fc-match -f '%{file}' 'JetBrainsMono Nerd Font:style=Regular' 2>/dev/null || true)
font_args=()
[[ -n $FONT ]] && font_args=(-font "$FONT")
body_args=()
[[ -n $BODY ]] && body_args=(-font "$BODY")

# Card: title, the roster, and a portal mid-trip.
magick -size 2400x1400 xc:'#101315' \
  \( "$SHOTS/characters.png" -filter point -resize 125% \) -gravity north -geometry +0+300 -composite \
  \( "$DEMO/portal-027.png" -filter point -resize 300% \) -gravity south -geometry +0+70 -composite \
  "${font_args[@]}" -fill '#e8e8e8' -pointsize 104 -gravity north -annotate +0+70 'Pixel Buddy' \
  "${body_args[@]}" -fill '#9aa5b1' -pointsize 38 -gravity north -annotate +0+200 \
  'A pixel-art desktop buddy for Omarchy that warps between workspaces with you' \
  "$ROOT/preview.png"
echo "wrote $SHOTS/{characters,expressions}.png, $SHOTS/portal.gif, $ROOT/preview.png"
