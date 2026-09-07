# 7. QMK's default keymap is the attributed starting point for a new configuration

Date: 2026-09-06

## Status

Accepted.

## Context

Until now a new configuration started completely unbound. The reasoning, recorded in
`CreateConfigurationButton.tsx`, was that adopting QMK's default *silently* would
present someone else's choices as the user's own, and that rule 2 forbids inventing
keymap data.

Both halves are right, but the conclusion was too strong. An empty 87-key board is a
poor starting point for the product's actual promise — *advanced* firmware without a
toolchain — because the user has to rebuild QWERTY by hand before the interesting part
begins. It is also the wrong foundation for the planned assistant ("default QWERTY,
with SOCD on A/D"): an assistant that cannot say what QMK's default is has to guess it,
which rule 2 forbids far more clearly than it forbids reading a file from the pinned
tree.

The catalog had no default keymaps because extracting them is not free: 3,270 of the
3,385 defaults in the pinned tree are `keymap.c`, not `keymap.json`, and reading them
means running QMK's own C parser (the one behind `qmk c2json`) inside the build image.

## Decision

1. **The catalog carries each keyboard's `keymaps/default`, as a fact.** Extractor v2
   resolves it with `qmk.keymap.locate_keymap` and reads it with
   `qmk.keymap.parse_keymap_c` (or the JSON directly). The normalizer stores what QMK
   reported — verbatim keycode tokens, layer designators, the layout macro resolved
   through QMK's own `layout_aliases`, and the source path — or records *why* it is
   unavailable. It never trims a layer to fit a layout or fills a gap.

2. **The catalog carries QMK's keycode alias table**, from the keycode spec the
   extractor already dumps. `KC_BSPC → KC_BACKSPACE` is QMK's statement, not ours.

3. **Interpretation lives in the domain, not the catalog.**
   `importDefaultKeymap` (packages/domain/src/default-keymap.ts) turns tokens into the
   product's binding model, and only in ways checkable against the tree: alias-resolved
   plain keycodes that are in the supported catalog; `MO`/`TG`/`LT`; single-modifier
   tap-hold macros per `quantum_keycodes.h`. Positions carry across layouts of the same
   keyboard by matrix coordinate — the same physical switch. Everything else is reported
   in `unmapped` and the position stays visibly unassigned.

4. **The UI attributes, and offers both.** The keyboard page names the source file,
   says how many layers and keys the default gives, lists what could not be carried
   over, and offers "Edit QMK's default" alongside "Start blank". The default is
   labelled as QMK's choices until the user changes them.

5. **A new extractor is a new catalog version and a new image**, per
   `claude.md § Source management`: image `0.33.13-3`, catalog `0.33.13-2`. The SOCD
   registry's `verifiedFor` records for `0.33.13-2` were re-earned by a fresh
   `pnpm socd:matrix catalogs/0.33.13-2` run, not inherited from `0.33.13-1`.

### Addendum (2026-09-06): community-layout keymaps as presets

The same reasoning extends to QMK's `layouts/default/<name>/default_<name>/keymap.c`: one
canonical keymap per community layout (`60_hhkb`, `60_ansi_wkl`, `tkl_iso`, `alice`, …), and
each keyboard's `info.json` declares which layouts it supports. Extractor v3 records the 106
keymaps; normalizer v3 keeps the 99 that are arrangements (six ortho grids are `KC_A, KC_B, …`
compile patterns, detected by their share of distinct base-layer keycodes — ≤ 0.25 against
≥ 0.88 for every real one) and, per keyboard, the community layouts whose keymap fits the
keyboard's own `LAYOUT_<name>` macro position for position. `importCommunityKeymap` carries a
preset onto any layout of the keyboard exactly as the default is carried. The assistant's
`apply_layout_preset` and the keyboard page's preset buttons both use it, so "make an HHKB
layout" means QMK's HHKB keymap, never the model's recollection of one. Catalog `0.33.13-3`,
image `0.33.13-4`; SOCD records re-earned by a matrix run.

## Consequences

- 3,639 of 3,743 supported keyboards have a usable default. The 104 without one are
  honest failures (`#include "muse.h"` and similar that `cpp` cannot resolve, keymaps
  mixing layout macros, layers that do not match the layout length) and start blank
  with the reason shown.
- The unmapped list is a live inventory of product gaps: shifted symbols (`KC_EXLM`),
  media keys, `QK_BOOT`, RGB controls, multi-modifier mod-taps, custom keycodes. Each
  is a candidate for the supported catalog, added the usual way — allowlist plus tests
  against the pinned spec — not by loosening the import.
- `MO(_LOWER)` resolves via the layer's array designator. `[_LOWER] = LAYOUT(…)` makes
  `_LOWER` that layer's index by C semantics, so this is a reading of the source, not
  a guess; a designator that is not a layer, or a `#define`d name `cpp` already turned
  into an out-of-range number, is left unmapped.
- The assistant work can now express "default QWERTY" as `apply_default_keymap()`
  grounded in the catalog, and describe what it *cannot* do from the same `unmapped`
  data.
