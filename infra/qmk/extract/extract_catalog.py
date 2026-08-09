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

    emit({
        'type': 'provenance',
        'extractorVersion': 1,
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
