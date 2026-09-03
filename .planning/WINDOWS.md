---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-03T13:41:50.607Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | deviation | apps/api/src/builds/store-contract.test.ts |  | Pre-existing cross-file Postgres test-isolation gap (shared DB, no schema isolation between *-contract.test.ts files) surfaces as an intermittent builds_configuration_fk violation roughly 1 in 15-20 full-suite runs; admission-control logic itself verified correct via 15/15 clean isolated runs. See deferred-items.md. | open |  | 2026-09-03T13:41:50.607Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "05",
    "file": "apps/api/src/builds/store-contract.test.ts",
    "line": null,
    "description": "Pre-existing cross-file Postgres test-isolation gap (shared DB, no schema isolation between *-contract.test.ts files) surfaces as an intermittent builds_configuration_fk violation roughly 1 in 15-20 full-suite runs; admission-control logic itself verified correct via 15/15 clean isolated runs. See deferred-items.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-03T13:41:50.607Z",
    "resolved_at": null
  }
]
````
