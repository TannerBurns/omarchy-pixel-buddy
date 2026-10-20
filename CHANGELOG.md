# Changelog

## 0.4.0: Life

### Added

- **Personalities.** Characters behave like themselves: the cat naps during the day and gives some pets the cold shoulder, the puppy trots after your pointer, the hamster is zippy, the dragon flies up to high windows instead of taking a portal, the ghost wanders far, the knight patrols its beat and the zombie takes it slow. Custom characters can have a `personality` block too (see [docs/characters.md](docs/characters.md#personality)), and `set personality false` makes them all behave alike.
- **Friends drop by.** Every `friendEvery` minutes (45) or so, another character steps out of a portal next to the buddy: they greet each other, each does its signature move, they cheer, and the friend walks back into its portal. About ten seconds, and never while you're in a fullscreen app, sharing your screen, focusing, away or answering a stretch. Turn visits on or off in the menu's new **Friends** row or with `set friends false`. **Invite a friend** in the menu, or `omarchy-shell pixel-buddy friend random|<id>`, brings one over at once.
- **Stats and a wardrobe.** The buddy counts your Done stretches, finished focus rounds, day streak and active minutes per kind of work (categories only, kept for seven days, on your machine). Milestones unlock a scarf (10 stretches), a party hat (3-day streak), sunglasses (5 focus rounds) and a crown (7-day streak), and the buddy offers to put each one on. Wear them from the menu's wardrobe row; they show on screen and on the bar icon, and the nightcap still takes the place of a hat at bedtime. The menu and the bar tooltip show today's stats.
- New settings `personality`, `friends`, `friendEvery` and `stats`; IPC calls `friend`, `stats`, `wear`, `preview` and `resetStats`. Character files get a `neck` anchor for the scarf.

### Changed

- **Real-time pacing.** The buddy's clock ran slow whenever it was resting, so a "20-second" sit could last minutes and it was much quieter than intended. It now keeps real time, with longer sits and rests so it stays calm: it moves about a little more than before, dangles from windows less often (every 15 minutes at most) and shows off on its own now and then.
- The stretch count in a row now reads "3 in a row"; the new day streak is in the stats.
- After you call the buddy over from the bar, it stays where it landed for a minute before heading back to its spot.

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
