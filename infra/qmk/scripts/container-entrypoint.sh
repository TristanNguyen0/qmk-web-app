#!/bin/sh
# Container entrypoint for the pinned QMK build image.
#
# This is deliberately NOT a general shell. It dispatches a fixed set of verbs and
# passes remaining arguments through as an argument vector — never re-parsed, never
# interpolated into a shell string (claude.md § Build isolation: "Avoid shell
# evaluation entirely").
set -eu

# HOME and TMPDIR are directed into the writable workspace by the sandbox, but with a
# read-only container root nothing else can create them. Do it here so every verb has
# a writable home regardless of whether /workspace is a bind mount or a tmpfs.
mkdir -p "${HOME:-/workspace/home}" "${TMPDIR:-/workspace/tmp}"

verb="${1:-}"
[ "$#" -gt 0 ] && shift

case "${verb}" in
  extract-catalog)
    exec python3 /opt/qmk-web-app/extract_catalog.py --qmk-root /qmk "$@"
    ;;
  compile)
    # Argument vector supplied by services/worker; see BuildSandbox. Never re-parsed.
    #
    # QMK's build writes three things relative to its working directory that a
    # read-only source tree cannot accept: gcc temporaries, the `generated-files`
    # intermediate marker, and `cpfirmware_qmk`'s copy of the finished firmware
    # (builddefs/common_rules.mk:190-192). Left unaddressed these make a SUCCESSFUL
    # build exit non-zero, which would make build status untrustworthy in both
    # directions.
    #
    # So the working directory is a symlink farm: every top-level entry of the
    # read-only /qmk mount is symlinked into a writable directory in the workspace.
    # The directory itself is writable, every file in it remains read-only in the
    # pinned tree, and the tree is still structurally immutable (ADR 0003).
    QMKROOT=/workspace/qmkroot
    mkdir -p "${QMKROOT}" /workspace/build /workspace/tmp

    for entry in /qmk/* /qmk/.[!.]*; do
      [ -e "${entry}" ] || continue
      ln -sfn "${entry}" "${QMKROOT}/$(basename "${entry}")"
    done

    # QMK's python resolves QMK_FIRMWARE from the process working directory
    # (lib/python/qmk/constants.py) and reads ORIG_CWD at import time, so both must
    # be established here rather than by the caller. QMK_USERSPACE points at the
    # ephemeral, application-owned keymap tree; BUILD_DIR keeps every compiler
    # intermediate inside the writable workspace.
    cd "${QMKROOT}"
    ORIG_CWD="${QMKROOT}" \
    QMK_USERSPACE=/workspace/userspace \
    TMPDIR=/workspace/tmp \
    exec qmk compile -e BUILD_DIR=/workspace/build "$@"
    ;;
  verify-env)
    # Startup assertion that the mounted tree is a usable pinned QMK checkout with
    # the userspace mechanism this app depends on (ADR 0003), plus (D-04) that it
    # offers a community-module hook API at least as high as an optional declared
    # minimum. Remaining arguments are the fixed vector the entrypoint already
    # passes through — never re-parsed by a shell.
    exec python3 - "$@" <<'PY'
import json, os, re, sys

root = '/qmk'

# --min-module-hook-api <version> is the only argument this verb accepts. It is
# already shape-validated by the caller (packages/qmk-sandbox's
# assertValidModuleHookApiVersion) before it reaches this argument vector
# (claude.md rule 4); parse_version below is a second, independent line of
# defence, not the primary validation.
args = sys.argv[1:]
min_version_arg = None
i = 0
while i < len(args):
    if args[i] == '--min-module-hook-api':
        if i + 1 >= len(args):
            print(json.dumps({'error': '--min-module-hook-api requires a value'}))
            sys.exit(64)
        min_version_arg = args[i + 1]
        i += 2
    else:
        i += 1


def parse_version(value):
    """Three dot-separated non-negative integers, as a comparable int tuple —
    never string comparison, so a two-digit component ranks correctly."""
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


checks = {
    'qmk_lib_python': os.path.isdir(os.path.join(root, 'lib', 'python', 'qmk')),
    'makefile': os.path.isfile(os.path.join(root, 'Makefile')),
    'paths_mk': os.path.isfile(os.path.join(root, 'paths.mk')),
    'schemas': os.path.isdir(os.path.join(root, 'data', 'schemas')),
}
try:
    with open(os.path.join(root, 'builddefs', 'build_keyboard.mk'), encoding='utf-8') as fh:
        checks['qmk_userspace_supported'] = 'QMK_USERSPACE' in fh.read()
except OSError:
    checks['qmk_userspace_supported'] = False
try:
    open(os.path.join(root, '.qmk-web-app-write-probe'), 'w').close()
    checks['qmk_tree_read_only'] = False
    os.unlink(os.path.join(root, '.qmk-web-app-write-probe'))
except OSError:
    checks['qmk_tree_read_only'] = True

# The new key (D-04): the highest community-module hook API version the pinned
# tree offers, compared component-wise as integers against an optional declared
# minimum. Absent minimum -> true; the catalog-extraction and compile verbs have
# no module requirement.
highest_hook_version = None
hook_dir = os.path.join(root, 'data', 'constants', 'module_hooks')
try:
    for name in os.listdir(hook_dir):
        stem = name[:-len('.hjson')] if name.endswith('.hjson') else name
        parsed = parse_version(stem)
        if parsed is None:
            continue
        if highest_hook_version is None or parsed > highest_hook_version:
            highest_hook_version = parsed
except OSError:
    highest_hook_version = None

parsed_min = parse_version(min_version_arg) if min_version_arg is not None else None
checks['module_hook_api_version_ok'] = min_version_arg is None or (
    parsed_min is not None and highest_hook_version is not None and highest_hook_version >= parsed_min
)

# Observability only — never folded into the all-true aggregate that decides the
# exit code. Only booleans in `checks` decide `ok`.
module_hook_api = {
    'highest': '.'.join(str(part) for part in highest_hook_version) if highest_hook_version else None,
    'minimumRequested': min_version_arg,
}

print(json.dumps({'checks': checks, 'ok': all(checks.values()), 'moduleHookApi': module_hook_api}, sort_keys=True))
sys.exit(0 if all(checks.values()) else 1)
PY
    ;;
  *)
    echo "unknown verb: ${verb}" >&2
    echo "usage: extract-catalog | compile | verify-env" >&2
    exit 64
    ;;
esac
