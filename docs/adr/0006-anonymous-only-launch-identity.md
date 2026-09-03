# ADR 0006 — Anonymous-only is the launch identity model

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`.planning/ROADMAP.md` states Phase 5 criterion 5 as a fork: "either accounts exist and a user
can reach their configurations from a second device, or anonymous-only is a stated launch
constraint whose data-loss behaviour is visible in-product." This ADR takes the second branch and
records why it is defensible rather than merely cheap.

Two facts from [ADR 0001](0001-technology-stack.md) make anonymous-only safe to ship:

- **`ADR-0001-auth`** already put ownership-based authorization in the SQL predicate of every
  configuration, build, log, and artifact read and write, scoped by `ownerId`. Nothing about
  *authorization* changes when accounts arrive — only what `apps/api/src/session.ts` assigns to
  `ownerId` inside the session hook changes: a session UUID today, an account id later. No code in
  this application may assume `ownerId` is anonymous-only; this ADR restates that constraint so a
  reader of this document alone does not miss it.
- **The cookie's one-year `Max-Age`** (`apps/api/src/session.ts`, `MAX_AGE_SECONDS = 365 * 24 * 60
  * 60`) is deliberate, not an oversight. The loss window this decision creates is a user clearing
  cookies, switching browsers, or moving to a new device — never an expiry the product itself
  imposes.

## Decision

The launch identity model is **anonymous signed-cookie sessions only**. No authentication provider
and no accounts ship at launch. This is criterion 5's second branch, taken deliberately: anonymous-
only is a stated launch constraint, not an unfixed gap.

Two mitigations ship in the same plan that records this decision, not as promises for later:

1. **In-product disclosure (D-02).** `DataLossNotice` — a component that takes no props and can
   therefore not be dismissed or suppressed by any caller — renders a persistent, non-dismissable
   line on the configurations list (`apps/web/src/app/configurations/page.tsx`) and in the editor
   chrome (`apps/web/src/components/KeymapEditor.tsx`), stating plainly that the work belongs to
   this browser's cookie and that clearing it loses the work.
2. **Export/import as the way out (D-03).** `packages/domain/src/configuration-file.ts` defines a
   versioned export envelope (`CONFIGURATION_FILE_FORMAT_VERSION`) and a strict field-allowlist
   parser. A user can download a configuration as JSON and import it back as a **new**
   configuration through the existing `POST /v1/configurations` route — the same `asInput` field
   allowlist and the same `validateConfiguration` call every other write takes. No new endpoint and
   no new trust boundary is introduced.

## Consequences

Stated without softening:

- **A user who clears cookies, or who switches browsers or devices, loses their work.** There is no
  server-side account to recover it from.
- **There is no way for a user to reach their configurations from a second device.** Anonymous
  sessions are single-cookie, single-browser by construction.
- The mitigations are the in-product notice and the export/import path described above, both
  shipped by this same plan. They reduce the *severity* of the loss (a user who reads the notice
  and exports has a way out) but do not remove the underlying constraint.
- No code anywhere in this application may assume `ownerId` is anonymous-only — restating
  `ADR-0001-auth`'s constraint here so it is not missed by a reader who has seen only this
  document.

### Assumption-delta outcome: `ownerId` remains the right noun

Criterion 5's phrasing — "a user can reach their configurations from a **second** device" —
raised the question of whether `ownerId` still names the right noun once this ADR takes the
anonymous-only branch. It does. `ownerId` already names the authorization subject abstractly
rather than naming a session, and this decision is `no-change`: nothing about the noun moves.

What *would* change when accounts arrive is only what gets assigned to `ownerId` inside the
session hook — a session UUID today, an account id later — which is exactly the "only the identity
source changes" boundary `ADR-0001-auth` draws.

**The future move, if it is ever needed:** if one owner must hold more than one identity credential
at the same time — a cookie session and an account, or two devices being merged — the correct
change is a new `identities(owner_id, source, external_id)` table alongside the existing
`configurations.owner_id` and `builds.owner_id` columns, **never** a second owner column on those
tables. `ownerId` stays the subject; the `identities` table becomes the source. Recording this here
is deliberate: it is the thing a future author would otherwise have to re-derive under time
pressure.

### Revisit trigger

Revisit this decision when either becomes true:

- A user needs their configurations on a second device — the concrete trigger criterion 5's first
  branch names.
- A single owner needs to hold more than one identity credential at once (a cookie session plus an
  account, or two devices being merged) — the trigger for the `identities` table move described
  above.

### Correction to D-05's stated rationale

Phase 5's `05-CONTEXT.md` D-05 declined a UI contract on the ground that "`apps/web` already
carries the [Tailwind/Radix] patterns." It does not: `apps/web/package.json` declares neither
dependency, there is no `tailwind.config.*` anywhere in the app, and `apps/web/src/app/globals.css`
states outright that plain CSS was chosen deliberately for Phase 1, with Tailwind and Radix
deferred until there was an editor to style. That premise was never revisited through Phases 2–4.
The **conclusion** still stands — no UI contract is needed for this plan's controls — because the
notice and the export/import buttons are conventional and this app has an established, consistent
plain-CSS convention (`.provenance`, `.notice`, and now `.data-loss`) to follow instead.
