# Changelog

## 0.3.0: Focus

### Added

- **Focus timer.** Rounds of `focusMinutes` (25) with Do Not Disturb on, then a `focusBreakMinutes` (5) break with a stretch, then "Another round?". During a round the buddy jumps up through a portal and waits on the bar, leaving your windows alone, and the bar icon shows its face and the minutes left; when the round ends it drops back down under the icon. Start it from the bar icon (middle-click), the menu, `omarchy-shell pixel-buddy focus toggle` or a keyboard shortcut. Rounds survive suspend and shell restarts, and Do Not Disturb is only switched off if the timer switched it on.
- **Bar icon.** The plugin is now also a bar widget: the buddy's face and the focus countdown, in the bar section you choose (the menu's **Bar** row, or `omarchy-shell pixel-buddy bar left|center|right`). Click calls the buddy over (it drops out of a portal under the icon), right-click opens the menu, middle-click starts or stops focus. `barIcon: false` hides just the icon.
- **Git celebrations.** A cheer on commits and a leap on pushes, in repositories under `gitRoots` (`~/Work,~/Code,~/Projects,~/src`). Only the action word of new reflog entries is read, never commit messages, branch names or paths. At most one every 20 seconds and 40 a day, muted for a minute during commit bursts, quiet while the buddy is hidden or away. Uses inotifywait when installed, otherwise checks every 30 seconds.
- New settings `focusMinutes`, `focusBreakMinutes`, `focusDnd`, `barIcon`, `gitCelebrate` and `gitRoots`; IPC calls `focus`, `git` and `bar`; reactions `leap` and `sparkle`.

### Upgrading from 0.2

- After `omarchy plugin update tannerburns.pixel-buddy && omarchy restart shell`, run `bash ~/.config/omarchy/plugins/tannerburns.pixel-buddy/scripts/add-to-bar.sh` once to put the icon on the bar. It keeps your settings. Until then the buddy works as before, but `omarchy plugin list` shows it as disabled.
- Once the icon is on the bar, removing the widget from the bar also removes the buddy. Use `barIcon: false` to hide just the icon.

## 0.2.0: Moves & polish

### Added

- **Signature moves.** Double-click the buddy and every character does its own move: the cat stretches, the puppy wags, the bunny binkies, the frog flicks its tongue, the duck quacks, the crab clacks sideways, the blob jiggles, the robot sparks, the dragon puffs fire, the pumpkin glows, the star twinkles, the zombie lurches and the penguin belly-slides. It also shows off on its own now and then (never in calm motion, at night, on low battery or in battery saver).
- **Character handoffs.** Changing character, from the menu, IPC or the daily surprise, plays a portal handoff: the old character walks into a portal and the new one steps out of another at the same spot. While you drag it, while it's hidden, or with `warp` set to `none`, the swap is instant.
- **Battery saver.** New `batterySaver` setting: `auto` (default, on battery), `on` or `off`. It caps animation frame rates, wanders less, skips dangling and random moves, and polls the pointer and windows less often. `status` reports `saver`.
- **Theme spin.** Changing your Omarchy theme makes the buddy spin; theme-tinted characters recolor mid-spin.
- **Update celebration.** `hooks/pixel-buddy.sh` is a post-update hook: `omarchy hook install post-update ~/.config/omarchy/plugins/tannerburns.pixel-buddy/hooks/pixel-buddy.sh`.
- New reactions for `react`: `special`, `celebrate`, `done` and `spin`. A finished stretch now ends with the signature move.
- Character files can give any pose `travel`, `duration` and `emote` (see [docs/characters.md](docs/characters.md#signature-moves)). The new `note` emote is the duck's.

### Changed

- `react` answers `unknown` for names it doesn't know instead of `ok`.
- Settings are read from the plugin's bar entry when it has one (groundwork for the bar widget in 0.3.0).
- The buddy waits for its characters before appearing, so a pinned character never flashes as another one at login.

### Fixed

- With `warp` set to `none`, the buddy now follows focus to another monitor.

## 0.1.0

First release: seventeen characters with a daily surprise, the window-hopper movement modes, workspace portals, guided stretch reminders, drop-in custom characters and the right-click menu.
