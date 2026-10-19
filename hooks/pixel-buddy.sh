#!/bin/bash
# Pixel Buddy: a little celebration when `omarchy update` finishes.
#
# Install (once):
#   omarchy hook install post-update ~/.config/omarchy/plugins/tannerburns.pixel-buddy/hooks/pixel-buddy.sh
# Remove:
#   rm ~/.config/omarchy/hooks/post-update.d/pixel-buddy.sh
#
# Best effort: it never fails the update, even when the shell or the buddy
# isn't running.

export OMARCHY_PATH=${OMARCHY_PATH:-/usr/share/omarchy}
omarchy-shell -q pixel-buddy react celebrate || true
exit 0
