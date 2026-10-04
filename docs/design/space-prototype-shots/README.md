# Space prototype — screenshots per step

Taken with Playwright at 1280×860 on `http://127.0.0.1:5173/prototype.html#spaces` (issue #24, plan: [space-prototype-plan.md](../space-prototype-plan.md)).
Compare with the Lumina captures in [docs/research/lumina-spaces/img/](../../research/lumina-spaces/img/). Intentional differences: light theme, no billing, no Explore/Agent/Director mode, model chip last ("Auto · …").

| Step | Shot | Lumina reference | Notes |
|---|---|---|---|
| 1 Page frame | `01-audio-empty.png` | A01 | Left tabs; "Light up your creation"; tab survives reload |
| 2 Feed card | `02-image-feed.png`, `02-image-adv-hover.png` | I02, I04 | Timestamp · prompt · meta row with `Advanced ⓘ` table · result with ⋯ |
| 2 Running / cancelled | `02-video-feed-running-and-cancelled.png` | V02 | Stop is disabled once a Seedance job runs (it can only stop while queued) |
| 3 Regenerate / Re-edit | `03-regenerate-twice.png`, `03-reedit-fills-composer.png` | I05 | Two Regenerates = two cards, draft untouched; Re-edit → "Filled in parameters" |
| 4 Refs per run | `04-card-with-refs.png`, `04-reedit-refills-refs.png` | I02 (2nd card) | `@Logo` chips in the prompt, thumbnails in meta; Re-edit refills the slot |
| 5 Reference slot | `05-image-slot-menu.png`, `05-image-slot-two-refs.png`, `05-image-slot-open-chips.png`, `05-video-material-menu.png`, `05-audio-voice-slot.png` | I01, V03, A05, A07 | `+1` badge; role chips in the popover; Voice slot for Seed TTS |
| 6 Vibe + Text | `06-audio-vibe-text.png`, `06-audio-space-after-run.png`, `06-audio-node-vibe-text.png` | A07, A10 | Same two boxes and Auto prompt on the canvas node |
| 7 Detail modal | `07-image-detail-modal.png`, `07-audio-detail-modal.png` | I03 | Parameter table + Seed, Clone & try, filmstrip |
| 8 History dock | `08-history-dock-all.png`, `08-history-search-from-audio.png`, `08-clone-jumps-to-image.png` | A06, I02 (right column) | Search "fox" from Audio → Clone & try lands in Image |
| 9 Details | `09-cmd-enter-autoscroll.png`, `09-narrow.png`, `09-narrow-detail.png` | — | Ctrl/⌘+Enter, follows new cards, < 900 px layout |
| — Text | `10-text-space.png` | — | Text tab still runs |
