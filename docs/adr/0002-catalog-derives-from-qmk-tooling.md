# ADR 0002 — The catalog is derived by QMK's own tooling, not by a re-implemented parser

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

`claude.md` rule 2 forbids inventing keyboard metadata, and § Discovery process requires enumerating
keyboards "through QMK's own tooling where practical" and validating "with the QMK tool/schema
available at that revision".

QMK's `info.json`/`keyboard.json` model is not a flat file format. Resolving one keyboard's true
metadata involves directory-hierarchy inheritance, `data/mappings/*` defaults, keyboard aliases,
default-folder resolution, and layout macro expansion. Re-implementing that in TypeScript would
mean maintaining a second, silently divergent interpretation of QMK — exactly the fabrication risk
rule 2 exists to prevent.

## Decision

Discovery runs in two stages with a hard boundary between them:

1. **Extraction (inside the pinned build image, Python).** `infra/qmk/extract/extract_catalog.py`
   uses QMK's own `lib/python/qmk` API at the pinned revision to enumerate keyboards and resolve
   each one's info JSON. It emits a newline-delimited JSON dump plus a provenance header. It makes
   no product decisions — it does not filter, default, or repair anything.
2. **Normalization (TypeScript, `packages/qmk-catalog`).** The dump is parsed against a strict
   schema. Entries that are incomplete, ambiguous, or unresolvable are recorded as **unsupported
   with a reason**, never repaired. The output is an immutable, versioned catalog artifact.

The extractor's output is treated as untrusted input by the normalizer, per the working checklist
("treat all inputs, including catalog parsing output, as untrusted until validated").

## Consequences

- Catalog builds require the pinned build image; they are an offline administrative pipeline step,
  not a request-time operation.
- When QMK changes its metadata model, the extractor breaks loudly at a known seam instead of the
  normalizer quietly producing wrong data.
- The normalizer is fully testable against checked-in extractor dumps without Docker
  (`packages/qmk-fixtures`).
