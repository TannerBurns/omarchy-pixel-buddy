# Pixel Buddy for Omarchy

**A pixel-art desktop buddy that hops between your windows, follows you through a portal on every workspace switch, reacts to what you're working on, and reminds you to stretch.**

<p align="center">
  <img src="preview.png" alt="Pixel Buddy: seventeen pixel-art characters and a knight stepping out of a portal" width="900">
</p>

```bash
omarchy plugin add https://github.com/TannerBurns/omarchy-pixel-buddy --enable --yes
```

## Features

- **Seventeen characters, a new one every day.** Cat, Puppy, Bunny, Hamster, Frog, Duck, Penguin, Crab, Blob, Ghost, Robot, Dragon, Pumpkin, Star, Wizard, Zombie and Knight. "Surprise me daily" picks a different one each morning, never the same twice in a row, and you can pin any of them from the right-click menu.
- **It travels with you.** Every workspace switch opens a pixel portal in your theme's accent color: the buddy walks in on one side and steps out on the other. The scratchpad gets a floor portal, and when you move to another monitor the buddy portals over to it.
- **Window hopper.** It walks along the bottom of the screen, hops onto floating windows you focus and rides along when they move, dangles from a window edge now and then, and falls when the window under it closes. It never sits on your bar. Patrol, Roam and Stay modes keep it calmer.
- **It watches what you do.** Its eyes follow your cursor. It sits with a laptop while you code or work with an AI agent, reads while you browse, glances at new windows and notifications, and naps when you step away.
- **Drag it anywhere.** Pick it up, fling it, drop it. Where you drop it on or under a window becomes its spot for that app.
- **Signature moves.** Double-click it and each character does its own thing: the puppy wags, the frog flicks its tongue, the dragon puffs fire, the penguin belly-slides. Now and then it shows off on its own.
- **Character handoffs.** Pick a new character (or let the daily surprise change) and the old one walks into a portal while the new one steps out of another.
- **It notices your system.** It spins when you change your Omarchy theme (theme-tinted buddies recolor mid-spin) and can celebrate a finished `omarchy update` (see [Update celebration](#update-celebration)).
- **Stretch reminders that change every time.** After a long stretch of work it waits for a natural pause, then walks you through one of 22 stretches across eight categories and acts each one out. After long coding sessions it favors wrists, eyes and neck; it never picks the same category twice in a row. It stays quiet during fullscreen apps, Do Not Disturb and screen sharing.
- **Bring your own character.** Drop a JSON file of pixel rows into `~/.config/pixel-buddy/characters/` and it appears in the menu. Edits show up live.
- **Light on resources.** It only draws when something changes: about 1% of one CPU core while it wanders, far less while it sits still. On battery it switches to a [battery saver](#battery-saver) that draws and polls even less.

## Screenshots

<p align="center">
  <img src="screenshots/portal.gif" alt="A knight walks into a portal and steps out of another one across the screen" width="520">
</p>

| The characters | Shared expressions |
| :---: | :---: |
| <img src="screenshots/characters.png" width="430" alt="All seventeen characters"> | <img src="screenshots/expressions.png" width="330" alt="Cat, frog, robot and ghost showing seven expressions"> |

*These images are rendered from the plugin's own sprite and portal code (`scripts/make-media.sh`), so they match what runs on your desktop.*

## Install

```bash
omarchy plugin add https://github.com/TannerBurns/omarchy-pixel-buddy
```

Omarchy shows its standard warning about third-party plugins, clones the repository, and asks whether to enable it. Add `--enable --yes` to skip the questions. The buddy appears right away.

**Update:** `omarchy plugin update tannerburns.pixel-buddy && omarchy restart shell`. The buddy stays loaded while other plugins reload, so a new version takes effect when the shell restarts.

### Keyboard shortcut (optional)

Add this to `~/.config/hypr/bindings.lua` to show and hide the buddy:

```lua
o.bind("SUPER + ALT + B", "Pixel Buddy", "omarchy-shell pixel-buddy toggle")
```

## Uninstall

```bash
omarchy plugin remove tannerburns.pixel-buddy
rm -rf ~/.local/state/pixel-buddy ~/.config/pixel-buddy   # optional: saved spots, stretch history, custom characters
```

Remove the keyboard shortcut too if you added it, and the update hook if you installed it (`rm ~/.config/omarchy/hooks/post-update.d/pixel-buddy.sh`).

## Usage

| Input | Action |
| --- | --- |
| Drag | Pick it up and move it. Fling it to throw it. |
| Click | Pet it. |
| Double-click | Its signature move. |
| Right-click | Menu: character, surprise me daily, mode, size, colors, motion, stretch now, snooze reminders, hide. |
| Super+Alt+B | Show or hide it (with the shortcut above). |

Everything is also scriptable:

```bash
omarchy-shell pixel-buddy toggle                 # show or hide
omarchy-shell pixel-buddy show
omarchy-shell pixel-buddy hide
omarchy-shell pixel-buddy character frog         # or: daily (plays the portal handoff)
omarchy-shell pixel-buddy mode stay              # hopper, patrol, roam, stay
omarchy-shell pixel-buddy set breakMinutes 30    # any setting below
omarchy-shell pixel-buddy stretch                # a stretch break right now
omarchy-shell pixel-buddy answer done            # answer an open stretch bubble: done, later, skip
omarchy-shell pixel-buddy react celebrate        # a reaction, see below
omarchy-shell pixel-buddy warp left              # play a workspace portal: left, right or down
omarchy-shell pixel-buddy menu                   # open the menu next to the buddy
omarchy-shell pixel-buddy reloadCharacters       # rescan custom characters
omarchy-shell pixel-buddy reset                  # forget the spots it learned for your apps
omarchy-shell pixel-buddy status | jq            # character, mode, battery saver, next stretch
omarchy-shell pixel-buddy debug | jq             # monitors, ledges and perches (window classes only)
```

### Reactions

`omarchy-shell pixel-buddy react <name>` plays one of these, and answers `unknown` for anything else. They're handy in your own scripts and Omarchy hooks.

| Name | Reaction |
| --- | --- |
| `pet` | A heart and a happy hop, like a click. |
| `special` | Its signature move. |
| `celebrate` | Its signature move with sparkles. |
| `done` | Its signature move with a heart (after a finished stretch). |
| `cheer` | Arms up, with a sparkle. |
| `spin` | A quick spin (it does this when the theme changes). |
| `heart` | Heart eyes. |
| `notify` | Looks up as if a notification arrived. |
| `question` | A question mark. |
| `dizzy` | Spinning eyes. |
| `sad` | A sad face. |
| `yawn` | A yawn. |
| `sleep` | A short nap. |
| `wake` | Wakes up with a start. |
| `flop` | Flops over, tired. |
| `battery` | A tired face with a low battery. |
| `charging` | A lightning bolt. |
| `hang` | Climbs up and dangles from the focused window. |
| `hop` | Hops back to its spot. |

## Movement modes

- **Hopper** (default). Gravity applies. With your usual maximized windows there's no room on top of them, so the buddy lives on the floor under the right end of the focused window, and now and then climbs up and dangles from its top edge before letting go. It hops onto floating windows you focus, rides along when you move them, and falls when they close. It follows focus only after focus has settled, so moving the mouse across windows doesn't send it bouncing around.
- **Patrol.** No gravity. It wanders near its home spot; wherever you drop it becomes home.
- **Roam.** No gravity. It walks the whole width of the line it's standing on.
- **Stay.** It stays exactly where you put it, still animating and reacting.

## Settings

Settings live in the plugin's entry in `~/.config/omarchy/shell.json`. The right-click menu and `omarchy-shell pixel-buddy set <key> <value>` write them, or you can edit the entry by hand. Invalid values fall back to the default.

| Key | Default | Description |
| --- | --- | --- |
| `character` | `daily` | A character id (`cat`, `knight`, a custom id) or `daily` for a new one each day. |
| `mode` | `hopper` | `hopper`, `patrol`, `roam` or `stay`. |
| `size` | `medium` | `small`, `medium` or `large`: 2, 3 or 4 screen pixels per art pixel. |
| `colors` | `natural` | `theme` tints characters with your Omarchy theme's accent color. |
| `motion` | `full` | `calm` walks slower and fades between workspaces instead of using portals. |
| `warp` | `portal` | `portal`, `fade` or `none` on a workspace switch. |
| `overFullscreen` | `false` | `true` keeps it above fullscreen apps and the screensaver. |
| `followCursor` | `true` | Eyes follow the pointer. |
| `screencast` | `calm` | While your screen is shared: `calm` (no portals or reminders), `hide` or `normal`. |
| `batterySaver` | `auto` | `auto` (on battery), `on` or `off`. See [Battery saver](#battery-saver). |
| `wellbeing` | `true` | Stretch and bedtime reminders. |
| `breakMinutes` | `45` | Active minutes between stretch breaks (1-480). |
| `stretches` | `all` | Categories to use, e.g. `wrists,eyes,neck`. |
| `bedtime` | `23:00` | When it starts yawning and suggests wrapping up for the night; `off` turns it off. |
| `battery` | `true` | A tired face on low battery, a sparkle when you plug in. |

```bash
omarchy-shell pixel-buddy set colors theme
omarchy-shell pixel-buddy set stretches wrists,eyes,neck
```

## Stretch reminders

The buddy counts active time. Being idle for five minutes or more counts as a break and resets the count, and so does a suspend. Once `breakMinutes` of active time add up, it waits until you pause for a few seconds, then shows a bubble with a guided stretch, a countdown and its own demonstration. **Done** counts toward today's total and your streak, **Later** asks again in ten minutes, and **Skip** resets the timer.

| Category | Stretches |
| --- | --- |
| Neck | Neck tilt, Chin tucks, Look over your shoulders |
| Shoulders | Shoulder rolls, Overhead reach, Chest opener, Cross-body shoulder stretch |
| Wrists | Wrist flexor stretch, Wrist extensor stretch, Fist and spread, Prayer stretch |
| Back | Seated twist, Side bend, Seated cat-cow |
| Eyes | 20-20-20 eye break, Palming |
| Legs | Stand up and walk, Calf raises, Standing quad stretch |
| Breathing | Box breathing (the buddy inflates and deflates as your pacer), Physiological sigh |
| Water | Water break |

It doesn't repeat a stretch until it has used every one in the categories you allow. The stretches are gentle and general. Stop if anything hurts, and leave out any category that doesn't suit you with the `stretches` setting.

After `bedtime` it wears a nightcap, yawns more, and once a night suggests wrapping up. The menu's **Snooze reminders 1h** pauses stretch reminders for an hour.

## Battery saver

Each frame the buddy draws costs a little CPU, so on battery it does less: fewer, slower animation frames, less wandering, no dangling or showing off on its own, and slower checks of the pointer and your windows. Workspace portals and stretch reminders work as usual. `batterySaver` set to `on` keeps it that way on power too, and `off` turns it off. `status` reports `"saver": true` while it's active.

## Update celebration

The buddy can cheer when `omarchy update` finishes. Install the hook it ships with once:

```bash
omarchy hook install post-update ~/.config/omarchy/plugins/tannerburns.pixel-buddy/hooks/pixel-buddy.sh
```

The hook calls `omarchy-shell -q pixel-buddy react celebrate` and never fails an update, even when the buddy isn't running. Remove it with `rm ~/.config/omarchy/hooks/post-update.d/pixel-buddy.sh`.

## Custom characters

Put a character file in `~/.config/pixel-buddy/characters/` and pick it from the menu. Only an `idle` pose is required. Every other pose falls back to one you drew, and the eyes, expressions, props and portal come from the plugin. Draw a `special` pose to give it a signature move. See [docs/characters.md](docs/characters.md) for the format and a complete small example. The built-in characters in [characters/](characters) are full examples too.

## Privacy

- Window titles are only used to guess what kind of work you're doing (coding, browsing, chat and so on). They are never stored, logged or shown; `status` and `debug` report categories and window classes only.
- It notices that a notification arrived, from a new file in Omarchy's notification folder, but never reads it. Notifications held back by Do Not Disturb don't reach that folder.
- Everything stays on your machine. The plugin makes no network requests.

## Requirements

- Omarchy 4 (its shell runs on Quickshell 0.3 or newer) on Hyprland
- UPower for the battery moods (installed with Omarchy)

## Development

Work in your own clone and install from GitHub like any other user. The copy in `~/.config/omarchy/plugins/` is a normal install that `omarchy plugin update` manages.

```bash
git clone https://github.com/TannerBurns/omarchy-pixel-buddy ~/Work/GitHub/omarchy-pixel-buddy
cd ~/Work/GitHub/omarchy-pixel-buddy

bash tests/run.sh                 # manifest checks, node unit tests, character lint, qmllint
omarchy plugin validate .
bash scripts/dev-run.sh           # run this checkout in its own Quickshell instance, live reload on save
node scripts/render-sheet.mjs cat --out /tmp/sheets     # contact sheets of a character's poses and faces
bash scripts/make-media.sh        # rebuild the README images

git push && omarchy plugin update tannerburns.pixel-buddy && omarchy restart shell
```

- **Dev harness:** disable the installed copy first (`omarchy plugin disable tannerburns.pixel-buddy`) or you'll see two buddies. Its IPC lives at `qs ipc -p "$XDG_RUNTIME_DIR/pixel-buddy-dev" call pixel-buddy status`.
- **Layout:** the behavior is plain JavaScript in `js/`. `World.js` is the state machine, `Sprite.js` the compositor, and `Portal.js`, `Platforms.js`, `Motion.js`, `Activity.js`, `Roster.js` and `Wellbeing.js` handle the rest. All of it is unit-tested with node. The QML files connect it to Hyprland, input and drawing.
- **Logs:** `quickshell log -p /usr/share/omarchy/shell -f`.

## Credits

All characters, glyphs and portals are original pixel art made for this plugin. The penguin and the crab are deliberately not Tux or Ferris.

## License

[MIT](LICENSE) © 2026 Tanner Burns
