# Custom characters

Put a character file in `~/.config/pixel-buddy/characters/` and it appears in the buddy's right-click menu. The folder is watched, so saving the file updates the buddy immediately. A file that doesn't validate is skipped and logged once in the shell log. You can see why with:

```bash
omarchy-shell pixel-buddy debug | jq .problems
```

You draw the body with letters. The plugin adds the eyes, every expression and gaze direction, the mouth, props such as the laptop and the stretch hand, what it wears (the nightcap, a scarf, sunglasses, a party hat or a crown), the emotes and the portals. Only an `idle` pose is required.

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
  "anchors": { "eyes": [[4, 9], [10, 9]], "mouth": [6, 12], "hand": [7, 15], "head": [7, 5], "neck": [7, 14] },
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
      { "base": "idle/0", "shift": [0, 2], "rows": { "15": ".##############." }, "anchors": { "neck": [7, 14] } }
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
| `personality` | no | How it tends to behave: naps, wanders, follows the pointer and so on (see [Personality](#personality)). |
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
| `head` | Top center of the head, where hats sit: the nightcap, party hat and crown rest their bottom edge here (the nightcap's brim one row lower). |
| `neck` | The middle of the neck, on the row where the head meets the body. The scarf's band (12 pixels wide, 2 tall) starts on this row, so the lowest it can be is the second-to-last row. Characters without a `neck` can't wear the scarf. |

Coordinates count from the top-left of the frame, starting at 0.

Sunglasses need no anchor of their own: a lens covers each eye's 4 x 4 area (see the rules below), with a bridge between them when the eyes are close. They come off while the buddy sleeps, and characters with `eyes.style` `none` can't wear them. Leave room for hats above the head: the lint flags any frame where a hat, the scarf or a lens would be cut off.

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

### Signature moves

`special` plays when you double-click the buddy, after a finished stretch, and now and then on its own. Written in the `{ "fps": n, "frames": [...] }` form, any pose can also carry:

| Field | Range | Meaning |
| --- | --- | --- |
| `travel` | -4 to 4 | Art pixels to move per frame, in the direction it faces. It stops at the end of whatever it stands on. `travel` x `fps` must stay within 40. |
| `duration` | 0.3 to 4 | Seconds the move lasts, looping its frames. The default is two passes through the frames, between 0.6 and 3 seconds. |
| `emote` | an emote id | Shown above the head for the whole move: `bang`, `question`, `dots`, `heart`, `zzz`, `sparkle`, `drop`, `bolt`, `note`, `bulb`, `spiral`, `stretch` or `battery`. Unknown ids are skipped. |

```json
"special": { "fps": 6, "travel": 1, "duration": 1.5, "emote": "sparkle", "frames": [{ "base": "idle/0", "shift": [0, -1] }, { "base": "idle/0" }] }
```

During its signature move the buddy looks straight ahead, so `special` frames only need room for the eyes at that one gaze. A character without `special` cheers instead.

### Personality

A `personality` block makes a character behave like itself. Every key is optional; anything left out behaves like a character without a personality. A bad value never stops the character from loading: it's skipped with a warning (`node scripts/lint-characters.mjs` shows them).

| Key | Range | Default | Effect |
| --- | --- | --- | --- |
| `energy` | 0.5 to 2 | 1 | How lively it is. Higher means shorter rests and more moving about; lower means long sits. |
| `wander` | 0 to 2 | 1 | How often, and how far, it wanders around its spot. |
| `naps` | 0 to 1 | 0 | How often it dozes off during the day. |
| `aloof` | 0 to 1 | 0 | The share of pets it shrugs off: it turns its back with a "…". |
| `special` | 0 to 0.2 | 0.06 | How often it shows off its signature move on its own. |
| `follows` | true or false | false | Trots after the pointer while you move it. |
| `zippy` | true or false | false | Quick on its feet: faster steps and quicker hops. |
| `flies` | true or false | false | Flies up to high windows instead of taking a portal. In flight it plays its `fall` pose, so draw wing flaps there. |
| `patrols` | true or false | false | Walks its beat end to end and turns around at each end. |

```json
"personality": { "naps": 0.5, "aloof": 0.4 }
```

The built-ins: the cat naps and is a little aloof, the puppy follows you, the hamster is zippy, the dragon flies, the ghost wanders, the knight patrols and the zombie takes it slow. Anyone can switch personalities off with the `personality` setting.

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

The lint checks the format, the eye and mouth areas, the feet, and that everything the buddy can wear fits. The contact sheets show every pose and frame on dark, grey and light backgrounds, every expression with every gaze, the pixel effects and props, and real sizes. They use the same compositor as the buddy.
