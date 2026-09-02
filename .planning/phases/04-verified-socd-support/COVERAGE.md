# API Coverage — Phase 4, Verified SOCD Support

No external API integration: this phase touches only first-party surfaces — the project's own
Fastify route `/v1/catalog/:catalogVersion/socd-capabilities/*`, the in-process domain module
registry, the Postgres-backed build queue, and a first-party QMK community module compiled from
source in the repository. No third-party API, SDK, or hosted service is called, wrapped, or
integrated, and the phase adds no external package (04-RESEARCH.md § Package Legitimacy Audit
verified this by diffing the workspace manifests).

The detector fires on this phase's plan text because of the phrases "the API can consume them"
(referring to this project's own API layer) and "hook API version" (referring to QMK's
community-module hook API, a compile-time interface of a vendored-by-pin source tree, not a network
service). Both are internal.
