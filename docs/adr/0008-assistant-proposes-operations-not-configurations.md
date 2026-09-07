# 8. The assistant proposes typed operations; code resolves, validates, and the user applies

Date: 2026-09-06

## Status

Accepted.

## Context

Users should be able to say "default QWERTY with SOCD on WASD and an Fn layer on right
Alt" and get it. A language model is the obvious tool. The risk is equally obvious in
this codebase: `claude.md` rule 4 forbids free-form text reaching C, Make, paths, or
arguments, rule 2 forbids inventing keyboard facts, and the SOCD rules forbid offering
anything not compile-verified. A model that writes configuration JSON directly, or
worse keymap source, would put a probabilistic component on the wrong side of every
one of those lines.

## Decision

1. **The model's only output is a `propose_changes` tool call** whose input is a list
   of small typed operations (`set_key`, `add_layer`, `set_socd`, `apply_default_keymap`,
   …) plus an explicit `unsupported[]` list. Tool choice is forced; there is no
   free-form channel. The schema is derived from the Zod contract
   (`packages/assistant/src/proposal.ts`), so the model's vocabulary and the resolver's
   cannot drift.

2. **References are loose only where a model is reliable and code can check.** A key
   may be named by legend, a layer by name, a keycode by alias or common name. Each is
   resolved against the current document and the catalog; an ambiguous legend (two
   space bars) is reported with the candidate positions, never picked. Keycodes resolve
   *into* the supported allowlist and cannot widen it.

3. **The resolver produces a candidate configuration that goes through
   `validateConfiguration`** — the same function every hand edit and every build passes
   through. The assistant therefore adds no new path to generation, storage, or the
   build queue. A SOCD request on an unverified keyboard resolves fine and is refused by
   the registry, exactly as it would be from the SOCD panel.

4. **The model is grounded in the catalog, not its memory.** The system text is the
   rendered context (`context.ts`): every physical key as `[position:legend]` per
   layer, the supported keycodes, SOCD availability and its hard limits, and whether a
   QMK default exists. "Default QWERTY" is `apply_default_keymap`, which reads the
   catalog's copy of QMK's own keymap (ADR 0007).

5. **Unsupported requests are a first-class result.** "Toggle SOCD with Fn+Del" cannot
   be expressed; the contract requires the model to say so in `unsupported`, the UI
   shows it under "Not possible here", and the list becomes product signal.

6. **The server never writes.** `POST /v1/configurations/:id/assistant` returns the
   candidate, the change list, issues, and validation verdict. The editor applies it as
   one undoable step; saving is the ordinary `PUT` with `If-Match`; building is the
   ordinary build request. The client may send its unsaved working document so the
   proposal builds on what the user sees; that document is parsed against the schema
   like any other untrusted input.

7. **One correction turn, then stop.** Resolution issues and validation errors go back
   to the model once, alongside its own proposal. Partial results are returned as
   partial, with the refused operations listed.

8. **Cost controls, not safety controls.** Per-session hourly quota, a global in-flight
   cap, a prompt length limit, and a wall-clock timeout (`ASSISTANT_LIMITS`). The
   assistant is opt-in by `QWA_ASSISTANT_API_KEY`; absent, the status route says so and
   the UI hides the panel. Only the system text and the prompt leave the process —
   never a session, owner, or configuration id.

9. **Provider is a seam.** `AssistantProvider` has one method. The Anthropic adapter
   uses the Messages API over `fetch` with `claude-haiku-4-5` by default — the cheapest
   hosted model with reliable tool use, chosen because this is a portfolio project with
   no real user base. Swapping providers touches one file.

### Addendum (2026-09-06): lexical retrieval over the pinned documentation

The model's phrasing of *concepts* (home row mods, tap-vs-hold, what KC_TRANSPARENT means) is
one place its memory can be stale or vague. Vector retrieval was considered and rejected: the
corpus is ~170 chunks of pinned markdown, OpenRouter serves no embeddings endpoint, and a second
paid provider on the proposal path is not justified for this size. Instead the catalog (extractor
v5) carries the curated docs — layers, mod-tap, tap-hold, macros, keycodes — chunked by heading,
and `buildDocSearch` runs in-process BM25 (k1=1.5, b=0.75, stop-worded) over the user's prompt,
injecting at most four excerpts as clearly-labelled *background* below the structured facts.
The rules still decide what may be proposed; the docs only sharpen the wording. A prompt with no
lexical overlap retrieves nothing.

## Consequences

- Prompt injection can waste money but cannot reach firmware: the resolver and
  validator sit between the model and every effect.
- Model quality shows up as `issues` and `unsupported` counts, which the smoke script
  (`pnpm assistant:try`) prints; that is the seed of an eval harness.
- Anything the assistant is repeatedly asked for and cannot do — shifted symbols, media
  keys, a SOCD toggle — is a feature request for the allowlist or the module, added the
  usual verified way, not by loosening the contract.
