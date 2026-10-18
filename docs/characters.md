# Custom characters

Put a character file in `~/.config/pixel-buddy/characters/` and it appears in the buddy's right-click menu. The folder is watched, so saving the file updates the buddy immediately. A file that doesn't validate is skipped and logged once in the shell log. You can see why with:

```bash
omarchy-shell pixel-buddy debug | jq .problems
```

You draw the body with letters. The plugin adds the eyes, every expression and gaze direction, the mouth, props such as the laptop and the stretch hand, the nightcap, the emotes and the portals. Only an `idle` pose is required.

## A complete small example

This is `tests/fixtures/custom-mochi.json`; the test suite validates it, so it always matches the format.

```json
{
  "format": "pixel-buddy-character",
  "version": 1,
  "id": "mochi",
  "name": "Mochi",
  "credit": "You",
  "size": [16, 16],
  "motion": "hop",
  "palette": {
    "#": "#3b2a4a",
    "o": { "natural": "#f7d6e0", "theme": "accent-light" },
    "p": "#ff8fab"
  },
  "eyes": { "style": "dot", "color": "#" },
  "anchors": { "eyes": [[4, 9], [10, 9]], "mouth": [6, 12], "hand": [7, 15], "head": [7, 5] },
  "poses": {
    "idle": [
      {
        "rows": [
          "................",
          "................",
          "................",
          "................",
          "................",
          "......####......",
          "....##oooo##....",
          "...#oooooooo#...",
          "..#oooooooooo#..",
          "..#oooooooooo#..",
          ".#oooooooooooo#.",
          ".#oooooooooooo#.",
          ".#poooooooooop#.",
          ".#oooooooooooo#.",
          "..#oooooooooo#..",
          "...##########..."
        ]
      },
      { "base": "idle/0", "rows": { "5": "................", "6": "......####......" } }
    ],
    "sleep": [
      { "base": "idle/0", "shift": [0, 2], "rows": { "15": ".##############." } }
    ]
  }
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `format`, `version` | yes | Always `"pixel-buddy-character"` and `1`. |
| `id` | yes | Lowercase letters, digits, `-` or `_`, up to 40 characters; not `daily`. A custom file with a built-in id replaces that character. |
| `name` | yes | Shown in the menu (1-32 characters, plain text). |
| `credit` | no | Who drew it. |
| `size` | yes | `[width, height]` of every frame, 8 to 32 each. The built-ins are 16 x 16. |
| `motion` | no | How it moves: `walk` (default), `hop`, `waddle`, `scuttle`, `float` (no gravity, bobs in place) or `fly` (walks, glides when falling). |
| `speed` | no | Walking speed multiplier, 0.25 to 3 (default 1). |
| `palette` | yes | Maps single characters to colors (see below). `.` is always transparent. |
| `eyes` | no | `{ "style": "dot" \| "big" \| "bead" \| "none", "color": hex or palette key, "glint": hex or palette key }`. Default: dot eyes in the `#` color. |
| `anchors` | see below | Points the plugin draws at, for the whole character; poses and frames can override them. |
| `poses` | yes | Pose name → list of frames, or `{ "fps": n, "frames": [...] }`. |
| `fps` | no | `{ pose: frames per second }` defaults for poses. |

### Palette

Each key is one character used in your rows. A value is either a color (`"#rrggbb"`) or `{ "natural": "#rrggbb", "theme": role }`. When someone sets `colors` to `theme`, entries with a role take that color from the Omarchy theme instead:

| Role | Color |
| --- | --- |
| `accent` | the theme accent |
| `accent-light` / `accent-shade` / `accent-dark` | lighter, slightly darker and much darker versions of it |
| `foreground`, `background` | the theme's text and background colors |

Use `#` for the outline. Eyes and mouths default to it.

### Anchors

| Anchor | What it marks |
| --- | --- |
| `eyes` | Two `[x, y]` points: the top-left of each eye. Required unless `eyes.style` is `none`. |
| `mouth` | Top-left of a 4-pixel-wide mouth area. Leave it out if your art has its own mouth (or a beak). |
| `hand` | Where props sit: the laptop, book, gamepad, stretch hand and cup are drawn with their bottom center here. |
| `head` | Top center of the head, for the nightcap. |

Coordinates count from the top-left of the frame, starting at 0.

### Poses and fallbacks

| Pose | Used for | Falls back to |
| --- | --- | --- |
| `idle` | standing around (required) | |
| `walk` | moving; hoppers travel on the middle frames of the cycle | `idle` |
| `jump` | rising through a hop | `idle` |
| `fall` | dropping, being thrown | `jump` |
| `sit` | sitting with a prop while you work | `idle` |
| `sleep` | napping while you're away | `sit` |
| `carried` | being dragged | `jump` |
| `hang` | dangling from a window edge | `carried` |
| `cheer` | being petted, finishing a stretch | `jump` |
| `special` | a signature move | `cheer` |
| `stretch` | stretch demonstrations | `idle` |

A pose with a single idle frame still breathes: the plugin squashes it by a pixel every other beat.

### Frames

A frame is either full rows:

```json
{ "rows": ["................", "..."] }
```

or a patch of another frame. Copy it with `base` (`"pose/index"`), move it with `shift` (`[dx, dy]`; empty space becomes transparent), then replace whole rows by index:

```json
{ "base": "idle/0", "shift": [0, 2], "rows": { "15": ".##############." } }
```

A patch can build on an earlier frame of its own pose. Its anchors follow its `shift`, and `"anchors"` on any frame overrides them. A pose holds at most 12 frames, and a file can be at most 256 KB.

## Rules that keep the shared eyes working

- **Leave the face blank where the eyes go.** Draw no eyes yourself. Around each eye anchor, keep a 4 x 4 area of face color, from one pixel up-left of the anchor to two pixels down-right. Every expression and every gaze direction lands in that area, and it must not hit outline (`#`) or transparency (`.`).
- **Same for the mouth:** the 4 x 3 area at the mouth anchor.
- **Feet on the bottom row.** Walkers stand on the last row of `idle`, `walk` and `sit` frames, so they line up with floors and window edges. Floaters can hover.
- **Keep the body about 14 pixels wide or less** at 16 x 16, with the light coming from the top-left, a dark outline from the same hue, and at most seven colors plus the outline.

## Checking your character

From a clone of this repository:

```bash
node scripts/lint-characters.mjs ~/.config/pixel-buddy/characters/mochi.json
node scripts/render-sheet.mjs ~/.config/pixel-buddy/characters/mochi.json --out /tmp/sheets
```

The lint checks the format, the eye and mouth areas, and the feet. The contact sheets show every pose and frame on dark, grey and light backgrounds, every expression with every gaze, the pixel effects and props, and real sizes. They use the same compositor as the buddy.
