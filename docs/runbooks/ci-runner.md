# Runbook: the self-hosted CI runner

This runbook covers the self-hosted GitHub Actions runner both `.github/workflows/ci-fast.yml`
and `.github/workflows/ci-matrix.yml` depend on: how it is registered, what it is trusted with
and why, how it stays in step with the pinned build image, what to do when it is offline, the
branch-protection configuration that makes the two workflows into an actual merge gate, and the
two independent controls that keep it safe against fork pull requests. It is a runbook, not a
reference for the workflow files themselves — read those directly for exact steps and flags.

## Why a self-hosted runner at all

D-06 puts both workflows on a self-hosted runner because the build host already holds Docker,
the pinned 3.73 GB `qmk-web-app/qmk-build` image, and the pinned QMK checkout
(`infra/qmk/manifest.json`). A hosted GitHub runner has none of those and would need a container
registry, an image-publish step folded into the controlled QMK refresh process below, and a
pinned QMK clone fetched fresh on every run — real infrastructure this project does not have and
does not need while it is a solo-repository project. `runs-on: [self-hosted, qmk-build]` is
written in exactly one place per workflow, so moving to hosted runners later is a one-line change
per job, not a rewrite.

Both the fast check and the matrix run on this runner, not just the matrix. That is not a cost
decision — it is that this runner's Node and pnpm versions are the ones that actually build
firmware. A green fast check on a different execution environment would prove something about a
machine no artifact is ever produced on.

## Registering the runner

Follow GitHub's own instructions: **repository → Settings → Actions → Runners → New self-hosted
runner**, on the build host. Give it both labels the workflows select on:

- `self-hosted`
- `qmk-build`

Both are required — `runs-on: [self-hosted, qmk-build]` in both workflow files matches on the
intersection, and a runner missing either label is never selected, silently. There is exactly one
runner in this project's design; do not register a second one with only one of the two labels as
an experiment — a partially-labelled runner that GitHub could route a job to is worse than no
runner, because a job can appear queued indefinitely with no explanation.

**Run the runner process as an unprivileged user that is a member of the `docker` group, and
nothing more.** It needs exactly two things from the host: the Docker socket (to invoke
`docker run` for compiles and for the Trivy image scan) and the pinned QMK checkout the matrix
job reads. It does not need passwordless `sudo`, a login shell with broader host access, or any
credential beyond what the workflow's own `GITHUB_TOKEN` provides for the run it is executing.

This matters specifically because of what group membership means here: **being in the `docker`
group is host-root-equivalent** — any process that can talk to the Docker socket can start a
container with `-v /:/host` and read or write anything on the machine. That is exactly why D-06
states the runner must never execute a fork pull request in absolute terms, and why the two
independent controls below both exist. A fork PR's workflow-defined code, if it ever ran here,
would run with that same effective privilege.

### The Node toolchain the runner host must provide

`run:` steps in both workflows execute with whatever Node the runner user resolves on its own
`PATH` — neither workflow installs one, because T-05-30 keeps `actions/checkout` the only
marketplace action either file uses. That makes the host's Node a real prerequisite, not a
detail:

- **Node 22 or newer**, matching `engines.node` in `package.json`. Several scripts pass
  `--experimental-strip-types`, which needs 22.6+. Debian 13's `nodejs` package is 20.19.2 and is
  not sufficient.
- **The corepack that ships with that Node.** Debian's separate `node-corepack` package is 0.24.0,
  which cannot launch pnpm 11 at all: it aborts with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`,
  because that corepack's module-loader shim predates pnpm's dynamic imports.

Install it *for the runner user*, not system-wide, so the runner keeps the unprivileged posture
described above. As the runner user:

```
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22
nvm alias default 22
```

The runner service does not read an interactive shell's profile, so also record the resolved
`bin` directory in the runner's own environment file, then restart the service as an
administrator:

```
echo "PATH=$HOME/.nvm/versions/node/$(nvm version 22)/bin:/usr/local/bin:/usr/bin:/bin" \
  >> "$HOME/actions-runner/.env"
systemctl restart actions.runner.<owner>-<repo>.<runner-label>.service
```

The runner user's `PATH` must not point into *another* user's home directory. A runner whose
`PATH` carries, say, `/home/<someone-else>/.nvm/...` logs repeated
`EACCES: permission denied, stat` lines while resolving executables and then falls back silently
to `/usr/bin` — which is how a host that has Node 22 installed for the wrong user still ends up
running jobs on Debian's Node 20.

The first step of both jobs asserts this version and fails with an explicit message naming the
Node it found, so a host that drifts back to an older Node says so directly rather than
resurfacing as a confusing corepack or `tsc` error further down the job.

## Keeping the runner in step with the pinned image — the controlled refresh process

Neither workflow contains a `docker build` step. The matrix job asserts the local image against
`infra/qmk/manifest.json` (name, tag, and digest when the manifest records one) and **fails
loudly rather than rebuilding** if they do not match. This is deliberate: a CI job that can
silently rebuild the image the matrix compiles in would mean a green run no longer proves
anything about the specific image every production build row cites via its `build_image_digest`
column.

Refreshing the image — after a QMK pin bump, or to pick up a base-image security update — is a
**human-run, offline step on the build host itself**, never a CI side effect:

1. Rebuild the image with whatever process `infra/qmk/scripts/build-image.sh` documents (or, if
   that script does not exist yet, the equivalent manual `docker build` against
   `infra/qmk/Dockerfile`), tagged exactly as `infra/qmk/manifest.json`'s `buildImage.name` and
   `buildImage.tag` name it.
2. Record the new image's digest back into `infra/qmk/manifest.json`'s `buildImage.digest` field,
   in the same `<repository>@sha256:<64 hex>` form `docker image inspect --format
   '{{index .RepoDigests 0}}'` reports — the same form `packages/qmk-sandbox`'s `DockerSandbox`
   already uses to populate `build_image_digest` on every production build row, so the two never
   drift into two different notions of "the image's digest."
3. Commit the manifest change. The next matrix run's assertion step will pass because the local
   image now matches what the manifest names — not because CI rebuilt anything.

A QMK pin bump (`infra/qmk/manifest.json`'s `tag`/`commit` fields) is always a **new** catalog
version and a new build image, never an in-place mutation of the running one
(`ADR-0001-qmk-pin`) — the refresh process above applies identically whether the image changed
because of a base-image update or because of a pin bump.

**A scan finding a real, fixable vulnerability in the current image is a signal to run this
refresh process, not a sign the CI workflow is broken.** `ci-matrix.yml`'s `scan` job gates on
fixable high/critical findings in the build image; if it turns red because of, say, an outdated
Go toolchain baked into an upstream layer, the fix is refreshing the image via the steps above —
not loosening the scan's severity or `--ignore-unfixed` filters, and not adding a build step to
CI.

### The host-provisioned pinned inputs: the QMK tree and the published catalog

`actions/checkout` runs `git clean -ffdx` at the start of every run. `-x` removes ignored files,
so the gitignored `.cache/` (the pinned QMK tree, ~1.5 GB with submodules) and `/catalogs/` (the
published catalog, ~53 MB) are deleted from the workspace before every job. Neither can be
provisioned once inside the workspace and then reused.

They are therefore host-provisioned, outside any workspace, and treated exactly like the build
image above: refreshed by a human, asserted by CI, never produced by CI. The matrix job's
"Assert host-provisioned QMK tree and catalog match the manifest" step resolves both, checks the
catalog's `catalogVersion` and `qmkCommit` against `infra/qmk/manifest.json`, and exports
`QMK_SOURCE_PATH` / `QMK_CATALOG_PATH` for the compile step. A catalog left behind by an earlier
pin fails that assertion instead of compiling happily against data this manifest never named.

**Layout.** The default root is `/home/github-runner/qmk-ci` — inside the runner user's own home,
so provisioning needs no `sudo` and the runner keeps the unprivileged posture described above.
Set the `QMK_HOST_ROOT` repository variable to move it.

```
$QMK_HOST_ROOT/qmk/<manifest.commit>/                  the pinned QMK tree
$QMK_HOST_ROOT/catalogs/<manifest.catalog.version>/    the published catalog
```

**Provisioning, and refreshing after a pin bump.** Run as the runner user, from any clone of this
repository on the build host. Both scripts honour the same environment variables the workflow
asserts against, so they publish straight into the location CI reads — there is no copy step, and
therefore no opportunity for the two to drift:

```
export QMK_HOST_ROOT=/home/github-runner/qmk-ci
COMMIT="$(node -p "require('./infra/qmk/manifest.json').commit")"
VERSION="$(node -p "require('./infra/qmk/manifest.json').catalog.version")"

QMK_SOURCE_PATH="$QMK_HOST_ROOT/qmk/$COMMIT" pnpm qmk:fetch --submodules
QMK_SOURCE_PATH="$QMK_HOST_ROOT/qmk/$COMMIT" \
  QMK_CATALOG_PATH="$QMK_HOST_ROOT/catalogs/$VERSION" pnpm catalog:build
```

`catalog:build` takes roughly ten minutes and runs inside the build image, so refresh the image
first when both are changing. A pin bump changes `commit` and `catalog.version` together, so the
new inputs land in new directories rather than overwriting the running ones — the same
never-mutate-in-place rule `ADR-0001-qmk-pin` states for the image.

## When the runner is offline

Both required checks — `fast` and `matrix-result` — are attached to jobs that select
`runs-on: [self-hosted, qmk-build]` (`matrix-result` itself runs on a GitHub-hosted runner, but it
depends on `matrix` and `scan`, which do not). **If the runner is offline, neither `fast` nor a
gated-path `matrix-result` reports at all** — GitHub Actions leaves a job queued rather than
failing it, and branch protection waits on a check that never finishes exactly as
`docs/matrix-selection.md`'s sibling pitfall (RESEARCH.md Pitfall 2) describes for a
trigger-level path filter. Nothing merges while this is true.

There are exactly two ways out, and they are not interchangeable:

1. **Bring the runner back up.** This is the default, correct response almost every time — check
   the runner process on the build host, its `docker` group membership, and that the host itself
   is reachable and has disk space for the pinned image and QMK checkout.
2. **Temporarily lift the branch-protection requirement.** This is **not** a routine step to take
   whenever the runner happens to be down. It removes the one mechanical thing standing between
   an unverified generator/QMK-pin/template/build-image change and `main` (see the trust-boundary
   table in `05-06-PLAN.md`'s threat model). If this is ever done, **record the decision** — who
   made it, why, and when the requirement was restored — the same way any other deliberate
   security-control exception on this project is recorded. Lifting it silently is exactly the
   failure mode D-06/D-09 exist to prevent.

## Branch protection configuration

**Settings → Branches → branch protection rule on `main` → Require status checks to pass before
merging.** Select exactly these two checks:

- `fast` — from `.github/workflows/ci-fast.yml`'s job.
- `matrix-result` — from `.github/workflows/ci-matrix.yml`'s aggregating job.

**Do not select `matrix` itself.** It is the path-conditional job inside `ci-matrix.yml` — a
required check that only sometimes runs is exactly the failure mode `matrix-result` exists to
paper over correctly (D-09; RESEARCH.md Pattern 4/Pitfall 2). `matrix-result` is `if: always()`
and is the only job in either workflow designed to always report a real status, in all four
cases: gated paths changed and the matrix passed, gated paths untouched (not applicable), gated
paths changed and the matrix or scan failed, and a fork pull request (which fails explicitly —
see below).

## The two independent fork-pull-request controls

D-06 states the constraint in absolute terms: the self-hosted runner must never execute a fork
pull request. Given what `docker` group membership means on this host (see above), that is not a
defense-in-depth nicety — it is the load-bearing security property of running CI on this machine
at all. Two independent controls enforce it, and **neither is sufficient alone**:

1. **Repository setting: require approval for all outside collaborators.**
   **Settings → Actions → General → Fork pull request workflows → require approval for all
   outside collaborators.** This is GitHub's own gate on whether a fork PR's workflow run starts
   at all. It is a **human** control: GitHub's own guidance is explicit that approval does not
   eliminate the risk, because an approver can still be tricked into approving a malicious PR, and
   once approved, the runner executes whatever the workflow file says, exactly as it would for any
   other PR (RESEARCH.md, GitHub Community discussion #26722, cited there).
2. **The in-workflow guard.** Every job in either workflow that selects
   `runs-on: [self-hosted, qmk-build]` — `ci-fast.yml`'s `fast`, and `ci-matrix.yml`'s `matrix` and
   `scan` — compares `github.event.pull_request.head.repo.full_name` to `github.repository` before
   doing anything else on the runner. This is a **technical** control that does not depend on a
   human decision at approval time; it holds even if the repository setting above were ever
   misconfigured or temporarily relaxed.

**The guard stops the job's real work from running; on its own, that is not the same as making a
fork PR's required check report failure.** GitHub Actions reports a job **skipped by a job-level
`if:`** as a "success"/neutral status — which *satisfies* a required check. A guard implemented
that way would turn "open a pull request from a fork" into a way to bypass the check entirely: the
guard would become a bypass instead of a guard, exactly the "cannot satisfy the gate by being
skipped" case this plan's must_haves forbid. Both workflows avoid this the same way, at different
granularities:

- **`ci-fast.yml`** has only one job, so there is no separate aggregator to fail on its behalf.
  Its fork check runs as the job's **first step** (before `actions/checkout`, so a fork PR's code
  is never checked out) and explicitly `exit 1`s on a fork PR. A failing step fails the step's job
  — `fast` — outright; it does not skip it. The check reports "failure", which branch protection
  does not accept, rather than the "success" a job-level `if:` would have produced.
- **`ci-matrix.yml`** has two path-conditional jobs (`matrix`, `scan`) that genuinely need to skip
  entirely when the change set is not gated-path-relevant, so a step-level fail-fast inside them
  is not appropriate — a "not applicable" skip is a real, legitimate outcome for those two, unlike
  for `fast`. Its guard there stays a job-level `if:`, and the **separate** `matrix-result` job
  (`if: always()`) is what fails explicitly, with a message naming the constraint, when it detects
  a fork PR — regardless of whether `matrix`/`scan` ran, skipped, or failed.
