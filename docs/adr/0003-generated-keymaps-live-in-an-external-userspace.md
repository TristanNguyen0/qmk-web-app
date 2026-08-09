# ADR 0003 — Generated keymaps live in an external QMK userspace, not inside the QMK tree

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

`claude.md` rule 3 permits the application to "create and own a generated keymap directory under the
selected keyboard's `keymaps/` directory in an ephemeral workspace", and § Build isolation requires
the QMK base source to be mounted **read-only**.

Taken together those two statements are in tension: writing a keymap under
`keyboards/<kb>/keymaps/<name>/` requires a writable QMK tree, which in practice means copying the
whole ~220 MB source per build or mounting it writable.

Inspection of the pinned revision (`332fa30e…`, QMK 0.33.13) shows a third option that QMK supports
natively:

- `Makefile:47` resolves `QMK_USERSPACE` from `qmk env`.
- `builddefs/build_keyboard.mk:417-419` adds the userspace directory to `VPATH`.
- `lib/python/qmk/build_targets.py:196-201` overrides the keymap path when the keymap resolves to a
  userspace directory.
- `builddefs/common_rules.mk:201-205` copies the finished firmware to
  `$(QMK_USERSPACE)/$(TARGET).$(FIRMWARE_FORMAT)`.
- `paths.mk:26` defines `BUILD_DIR := .build`, overridable on the make command line.

## Decision

A build workspace is laid out as:

```text
/workspace/                      # ephemeral, writable, per-build
  userspace/
    qmk.json                     # userspace manifest (generated)
    keyboards/<keyboardId>/keymaps/<generatedKeymapName>/
      keymap.json                # the only files the generator may write
      rules.mk                   # (allowlisted set, see packages/qmk-generator)
      config.h
      keymap.c
  build/                         # BUILD_DIR — all compiler intermediates
  qmkroot/                       # symlink farm; the build's working directory
  tmp/                           # TMPDIR for gcc temporaries
  home/                          # HOME for the build user
/qmk                             # pinned QMK source, mounted READ-ONLY
```

The QMK tree is mounted read-only with **no exceptions**, and the generator writes only inside
`/workspace/userspace/keyboards/<keyboardId>/keymaps/<generatedKeymapName>/`.

### Why the working directory is a symlink farm

QMK's build writes three things relative to its working directory:

1. gcc temporaries (fixed by `TMPDIR`),
2. the `generated-files` intermediate marker that `Makefile` unlinks at the end,
3. `cpfirmware_qmk`, which copies the finished firmware to `$(TARGET).$(FIRMWARE_FORMAT)` in the
   working directory (`builddefs/common_rules.mk:190-192`).

With the working directory set to the read-only mount, (2) and (3) fail *after* a successful link
step, so a **successful build exits non-zero**. Verified on the pinned revision: the firmware was
produced and size-checked (`20624/28672`), yet `qmk compile` exited 2.

Deriving build status from a log substring instead would be fragile in exactly the direction that
matters — `claude.md` § Error handling forbids presenting a compiler failure as flashable firmware.

The fix is to run the build in `/workspace/qmkroot`, a writable directory containing a symlink to
every top-level entry of `/qmk`. The directory is writable, every file within it remains read-only
in the pinned tree, and `qmk compile` now exits 0 on success and non-zero on genuine failure.
Confirmed on `crkbd/rev1`: exit 0, byte-identical artifact, pinned tree unmodified.

This satisfies rule 3 more strictly than the letter of the guide requires: the application does not
merely avoid editing upstream keymaps, it is structurally incapable of writing into the QMK tree at
all. It also gives rule 7 of § Deterministic generation a precise answer — the artifact is collected
from exactly one predetermined path, `$(QMK_USERSPACE)/<target>.<ext>`, and anything else found in
the workspace is rejected.

`claude.md` rule 3's wording should be read as "an application-owned keymap directory the build
resolves as the selected keyboard's keymap", which the userspace layout provides.

## Consequences

- No per-build copy of the QMK tree; the read-only mount is shared across concurrent builds.
- `BUILD_DIR=/workspace/build` must be passed to every compile so no intermediates are attempted
  inside the read-only tree.
- The userspace mechanism is revision-sensitive. `services/worker` asserts its availability against
  the pinned tree at startup, and a QMK bump must re-verify it.
