#!/usr/bin/env python3
"""Extract raw keyboard metadata from a pinned QMK tree using QMK's own tooling.

See docs/adr/0002-catalog-derives-from-qmk-tooling.md.

This script makes NO product decisions. It does not filter, default, repair, or
interpret. It resolves what QMK itself reports for each keyboard and records
failures verbatim so the TypeScript normalizer can mark entries unsupported with
an accurate reason (claude.md § Discovery process, step 5).

Output is newline-delimited JSON on stdout:

    {"type": "provenance", ...}      exactly one, first line
    {"type": "keycode_spec", ...}    exactly one
    {"type": "keyboard", ...}        one per enumerated keyboard
    {"type": "summary", ...}         exactly one, last line

Usage:
    python3 extract_catalog.py --qmk-root /qmk [--limit N] [--keyboard KB]...
"""

import argparse
import json
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone


def _add_qmk_to_path(qmk_root):
    """Make QMK's bundled python library importable, exactly as its own CLI does.

    QMK's `lib/python/qmk/path.py` reads ORIG_CWD at import time; the `qmk` CLI
    normally sets it via milc. We are importing the library directly, so we must
    establish the same environment before the first import or it raises KeyError.
    """
    lib = os.path.join(qmk_root, 'lib', 'python')
    if not os.path.isdir(lib):
        raise SystemExit(f'not a QMK tree (missing lib/python): {qmk_root}')
    sys.path.insert(0, lib)
    # QMK's modules resolve data files relative to the process working directory.
    os.chdir(qmk_root)
    os.environ.setdefault('ORIG_CWD', qmk_root)
    os.environ.setdefault('QMK_HOME', qmk_root)


def _git_head(qmk_root):
    """Read the checkout's HEAD, or None if git cannot tell us.

    `-c safe.directory` is required because the tree is mounted read-only and owned
    by a different UID than the unprivileged build user, which git otherwise refuses
    to inspect as "dubious ownership".
    """
    try:
        out = subprocess.run(
            ['git', '-c', f'safe.directory={qmk_root}', 'rev-parse', 'HEAD'],
            cwd=qmk_root, capture_output=True, text=True, timeout=30, check=True,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def _default_keymap(qmk_root, keyboard):
    """Resolve the keyboard's `default` keymap using QMK's own locator and parser.

    Returns a dict with `status` of `resolved`, `not_found`, or `failed`. A resolved
    record carries the layers exactly as QMK reads them — keycode tokens verbatim,
    aliases unresolved, layer names as written (a C designator such as `_LOWER`, or a
    number). The normalizer decides whether that is usable and the product decides
    what any of it means; this function only reports.

    `keymap.c` goes through `qmk.keymap.parse_keymap_c`, the same routine behind
    `qmk c2json`. It preprocesses with `cpp`, so `#define`d layer names become
    numbers while `enum` names stay symbolic.
    """
    import qmk.keymap  # noqa: E402 — importable only after _add_qmk_to_path

    try:
        path = qmk.keymap.locate_keymap(keyboard, 'default')
    except Exception as exc:  # noqa: BLE001 — report, never abort the keyboard
        return {'status': 'failed', 'error': {'kind': type(exc).__name__, 'message': str(exc)[:2000]}}

    if path is None:
        return {'status': 'not_found'}

    path = os.path.abspath(str(path))
    try:
        relative = os.path.relpath(path, qmk_root)
    except ValueError:
        relative = path

    try:
        # QMK's locator prefers keymap.json when both files exist, but a keymap.json
        # may carry only `config` while the layers live in the sibling keymap.c — QMK's
        # build merges the two. Follow the same rule: no `layers` in the JSON means
        # the C file is the keymap.
        if path.endswith('.json'):
            with open(path, encoding='utf-8') as fh:
                data = json.load(fh)
            sibling = os.path.join(os.path.dirname(path), 'keymap.c')
            if 'layers' not in data and os.path.isfile(sibling):
                path = sibling
                relative = os.path.relpath(path, qmk_root)

        if path.endswith('.json'):
            layout = data.get('layout')
            layers = [
                {'name': None, 'layout': layout, 'keycodes': layer}
                for layer in data.get('layers', [])
            ]
        else:
            parsed = qmk.keymap.parse_keymap_c(path)
            layers = [
                {
                    'name': None if layer.get('name') in (False, None) else str(layer['name']),
                    'layout': None if layer.get('layout') in (False, None) else layer['layout'],
                    'keycodes': layer.get('keycodes', []),
                }
                for layer in parsed.get('layers', [])
            ]
        return {
            'status': 'resolved',
            'source': relative,
            'format': 'json' if path.endswith('.json') else 'c',
            'layers': layers,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            'status': 'failed',
            'source': relative,
            'error': {'kind': type(exc).__name__, 'message': str(exc)[:2000]},
        }


def emit(record):
    json.dump(record, sys.stdout, sort_keys=True, separators=(',', ':'))
    sys.stdout.write('\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--qmk-root', required=True)
    parser.add_argument('--limit', type=int, default=0, help='0 = no limit')
    parser.add_argument('--keyboard', action='append', default=[],
                        help='extract only these keyboards (repeatable)')
    parser.add_argument('--expect-commit', default=None,
                        help='commit the caller believes is checked out; '
                             'extraction aborts if git reports a different one')
    args = parser.parse_args()

    qmk_root = os.path.abspath(args.qmk_root)

    # Provenance is a correctness requirement, not a nicety (claude.md rule 6): a
    # catalog must name the exact tree it came from. The caller has already verified
    # the checkout, and we independently cross-check with git when it is able to
    # answer. A *disagreement* is fatal; git merely being unavailable is not.
    head = _git_head(qmk_root)
    if args.expect_commit and head and head != args.expect_commit:
        raise SystemExit(
            f'refusing to extract: tree HEAD is {head}, caller expected {args.expect_commit}'
        )
    resolved_commit = head or args.expect_commit
    if not resolved_commit:
        raise SystemExit('refusing to extract: no commit could be established for this tree')

    _add_qmk_to_path(qmk_root)

    import qmk.keycodes  # noqa: E402
    import qmk.keyboard  # noqa: E402
    import qmk.info  # noqa: E402
    import qmk.keymap  # noqa: E402

    emit({
        'type': 'provenance',
        # v2: each keyboard record carries `default_keymap` (see _default_keymap).
        # v3: one `community_keymap` record per QMK community layout (see below).
        # v4: community_keymap records carry the layout's key geometry (`positions`).
        'extractorVersion': 4,
        'qmkCommit': resolved_commit,
        'commitSource': 'git' if head else 'caller-asserted',
        'qmkRoot': qmk_root,
        'extractedAt': datetime.now(timezone.utc).isoformat(),
        'pythonVersion': sys.version.split()[0],
    })

    # Keycodes come from QMK's own versioned spec resolution, never a hand-written list.
    keycode_version = qmk.keycodes.list_versions()[0]
    spec = qmk.keycodes.load_spec(keycode_version)
    emit({
        'type': 'keycode_spec',
        'version': keycode_version,
        'availableVersions': qmk.keycodes.list_versions(),
        'keycodes': spec.get('keycodes', {}),
        'ranges': spec.get('ranges', {}),
    })

    # QMK's canonical keymap for each community layout (`layouts/default/<name>/
    # default_<name>/keymap.c`): the HHKB arrangement, ANSI/ISO/WKL/Tsangan 60s,
    # ortho grids, and so on. Global facts, not per keyboard; a keyboard's own
    # `community_layouts` (in its info) says which apply to it.
    layouts_dir = os.path.join(qmk_root, 'layouts', 'default')
    for name in sorted(os.listdir(layouts_dir)) if os.path.isdir(layouts_dir) else []:
        keymap_c = os.path.join(layouts_dir, name, f'default_{name}', 'keymap.c')
        if not os.path.isfile(keymap_c):
            continue
        record = {'type': 'community_keymap', 'layout': name}
        # The layout's own geometry (layouts/default/<name>/info.json), verbatim: what
        # lets a community keymap be laid onto a keyboard that does not declare the
        # layout, by matching physical key positions.
        info_path = os.path.join(layouts_dir, name, 'info.json')
        try:
            with open(info_path, encoding='utf-8') as fh:
                layout_info = json.load(fh)
            record['positions'] = layout_info.get('layouts', {}).get(f'LAYOUT_{name}', {}).get('layout')
        except (OSError, ValueError) as exc:
            record['positions_error'] = {'kind': type(exc).__name__, 'message': str(exc)[:500]}
        try:
            parsed = qmk.keymap.parse_keymap_c(keymap_c)
            record.update({
                'status': 'resolved',
                'source': os.path.relpath(keymap_c, qmk_root),
                'layers': [
                    {
                        'name': None if layer.get('name') in (False, None) else str(layer['name']),
                        'layout': None if layer.get('layout') in (False, None) else layer['layout'],
                        'keycodes': layer.get('keycodes', []),
                    }
                    for layer in parsed.get('layers', [])
                ],
            })
        except Exception as exc:  # noqa: BLE001
            record.update({'status': 'failed', 'error': {'kind': type(exc).__name__, 'message': str(exc)[:2000]}})
        emit(record)

    if args.keyboard:
        keyboards = list(args.keyboard)
    else:
        keyboards = sorted(qmk.keyboard.list_keyboards())
        if args.limit > 0:
            keyboards = keyboards[:args.limit]

    ok = 0
    failed = 0
    for kb in keyboards:
        try:
            info = qmk.info.info_json(kb)
            emit({
                'type': 'keyboard',
                'keyboardId': kb,
                'status': 'resolved',
                # Verbatim QMK output. The normalizer decides what is usable.
                'info': info,
                'default_keymap': _default_keymap(qmk_root, kb),
            })
            ok += 1
        except Exception as exc:  # noqa: BLE001 — a broken keyboard must not abort the run
            emit({
                'type': 'keyboard',
                'keyboardId': kb,
                'status': 'extraction_failed',
                'error': {
                    'kind': type(exc).__name__,
                    'message': str(exc)[:2000],
                    'traceback': traceback.format_exc()[-4000:],
                },
            })
            failed += 1

    emit({
        'type': 'summary',
        'requested': len(keyboards),
        'resolved': ok,
        'extractionFailed': failed,
    })


if __name__ == '__main__':
    main()
