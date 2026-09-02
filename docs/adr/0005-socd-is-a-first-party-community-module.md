# 5. SOCD is a first-party community module, configured only by keycode

Date: 2026-08-09

## Status

Accepted.

## Context

Phase 4 is "verified SOCD support". `claude.md` rule 9 is unusually specific about how
to get there:

> SOCD functionality must be implemented against the exact QMK APIs present in the
> pinned revision. Verify headers, feature requirements, callbacks, and behavior with
> tests before exposing it.

and the SOCD section warns that the reference in the product brief —
`socd_cleaner_process` — "is illustrative only and must not be assumed correct for
every QMK revision."

So the first task was to look, not to remember. Searching the pinned tree
(`0.33.13`, `332fa30e173e5b0ecc0c70ff166974b6db86525e`) for SOCD finds **nothing in
core**. The only mention is in a changelog, pointing at a third-party repository:

```
docs/ChangeLog/20250223.md:16
  … a community module port of getreuer's SOCD Cleaner can be found in tzarc's modules repo
```

There is no `socd_cleaner.h`, no `SOCD_CLEANER_ENABLE`, no `socd_cleaner_process`.
Anything written against that API would not have compiled.

What the pinned revision *does* have is the community module system, added in the same
release. That was verified directly rather than assumed:

- `modules/qmk/hello_world/` — a working module in-tree.
- `data/schemas/community_module.jsonschema` — `qmk.community_module.v1`.
- `data/constants/module_hooks/{0.1.0,1.0.0,1.1.0,1.1.1,1.1.2}.hjson` — the hook API,
  including `process_record` at `0.1.0`.
- `lib/python/qmk/community_modules.py:50` — modules are found under
  `<QMK_USERSPACE>/modules/`, which is exactly where ADR 0003 already puts our
  generated tree.
- `keymap.jsonschema` has a first-class `modules` array.
- `quantum/quantum.c:354` — `process_record_modules` runs *before*
  `process_record_kb`, with the comment "modules must run before kb".
- `quantum/keycodes.h:85` — modules get keycodes `0x77C0`–`0x77FF`, 64 slots.

The remaining problem was configuration. A user's SOCD choice — a policy and four
directional keys — has to reach the firmware somehow. The obvious route is a generated
`config.h` full of `#define`s, and `claude.md` even sanctions it ("configuration
definitions through versioned templates"). But phase 3 shipped a stronger property that
is worth more than the convenience:

> Generation emits **only** `qmk.json` and `keymap.json`. C, Make, and headers are refused.

Spending that property on one `#define` would be a bad trade.

## Decision

**SOCD ships as a first-party QMK community module, `qmkweb/socd_cleaner`, and its
per-build configuration travels entirely as keycodes in `keymap.json`.**

The trick is to put the policy *in the keycode*. The module declares sixteen keycodes —
eight directions × two policies:

```
SOCD_NEUTRAL_W … SOCD_NEUTRAL_RIGHT
SOCD_LAST_W    … SOCD_LAST_RIGHT
```

Which two directions oppose each other is a fact about geometry, not a user preference,
so the pair table (`W/S`, `A/D`, `UP/DOWN`, `LEFT/RIGHT`) is static C. The user chooses
*which* pair and *which* policy, and both of those choices are fully expressed by which
of the sixteen keycodes the generator emits.

The result:

- The generator still emits only `qmk.json` and `keymap.json`. **No C is generated, at
  all.** The only new thing in `keymap.json` is `"modules": ["qmkweb/socd_cleaner"]`
  and four keycode tokens drawn from a frozen table.
- The module's C is static, reviewed, first-party source in
  `packages/qmk-socd-module/module/`. The worker copies it into the ephemeral userspace
  after checking every file against a SHA-256 pinned at review time, so an unreviewed
  edit fails the build instead of being compiled into someone's firmware.
- SOCD is offered only for keyboards in `SOCD_VERIFIED_KEYBOARDS`, and a keyboard earns
  its place there by passing `pnpm socd:matrix` — a real compile, per policy, in the
  real build image.

### Behavioural verification

`socd_resolve.h` holds the resolution logic and includes nothing but `stdbool.h` and
`stdint.h`. That is deliberate: it means the decision logic can be compiled and executed
on an ordinary machine. `packages/qmk-socd-module/test/socd_resolve_test.c` runs 2,070
assertions against **the same header the firmware compiles**, covering both policies,
simultaneous opposing presses, every release ordering, and an exhaustive sweep of all
four-event sequences checking the invariant that SOCD may *suppress* a held key but must
never invent one. `pnpm test` compiles and runs it with `-Wall -Wextra -Werror`.

### Layer interaction

SOCD keycodes are emitted on the **base layer only**. A directional position may be
something else entirely on a raised layer, and SOCD must not reach across layers to
change it. QMK resolves a key's release against the layer that was active when it was
pressed, so a SOCD keycode always sees a matched press/release pair even if the user
changes layer mid-hold.

Because `process_record_modules` runs before `process_record_kb` → `process_record_user`
— where QMK places JSON-defined macros — SOCD resolves a direction key before any macro
sees it, and a macro's own key events are not SOCD keycodes and pass through untouched.

## Consequences

**Good**

- Phase 3's "no generated C" property survives phase 4 intact.
- Behaviour is tested by executing the shipped C, not a reimplementation of it.
- The policy set is closed by construction: a policy with no keycodes cannot be
  selected, so the enum cannot drift ahead of the implementation.
- Adding a keyboard requires a real compile, so "SOCD works here" is never a guess.

**Costs**

- Sixteen keycodes instead of eight plus a define. They are static and cheap, but the
  table is duplicated in three places — `qmk_module.json`, the C dispatch, and
  `packages/domain/src/socd.ts`. Tests cross-check all three against each other, because
  a mismatch would send the wrong key rather than fail loudly.
- Opposing pairs are fixed. A user cannot pair, say, `KC_J` against `KC_L`. That is a
  deliberate limit: every offered combination is one that has been compiled and tested.
- Changing the module's C means regenerating the digest manifest (`pnpm socd:manifest`),
  which is intentional friction on source that ends up in other people's firmware.

**Rejected alternatives**

- *Vendor tzarc's module as a git submodule.* It is third-party code we would be
  compiling into user firmware, pinned to a repository we do not control, and its
  behaviour would still need the same verification. Writing ~120 lines we can test
  exactly was the smaller risk.
- *Generate a `config.h` with the policy and pairs.* Works, and is explicitly permitted,
  but costs the "no generated C" property for no capability we actually gain.
- *Put SOCD in core via a patched QMK tree.* Violates the read-only pinned tree (ADR
  0003) and rule 3.
