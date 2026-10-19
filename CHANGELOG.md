# Changelog

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
