/**
 * The curated module registry: the single source of truth for every fact
 * `REQ-curated-module-registry` demands about a supported QMK community module.
 *
 * claude.md § Curated module registry: "Treat every supported module as a product
 * feature, not a generic plugin upload. The registry must pin its source revision,
 * license, minimum QMK/community-module API version, generated configuration/template
 * version, compatibility tests, supported options, and any keyboard/firmware
 * prerequisites."
 *
 * Before this file, those seven facts were scattered: `qmk_module.json` (license),
 * `socd.ts` (options, the flat verified-keyboard set), the digest manifest in
 * `@qmk-web-app/qmk-socd-module` (source revision), and ADR 0005 (rationale, the
 * minimum hook API version). `socdCapabilitiesFor` and `validateConfiguration` now read
 * through this structure instead of a second, independently maintained list — see the
 * plan's `<assumption_delta_decision>` for why the flat set is demoted to a derived
 * view rather than kept alongside this registry.
 *
 * **Dependency direction:** `@qmk-web-app/qmk-socd-module` depends on
 * `@qmk-web-app/domain`, so this file must not import the module package — that would
 * be a cycle. The literal values below (`moduleVersion`, `digestedFiles`) are therefore
 * hand-pinned copies, and `packages/qmk-socd-module/src/module.test.ts` (which may
 * import both packages) cross-checks them against `SOCD_MODULE_VERSION` and
 * `SOCD_MODULE_DIGESTS` so the two cannot drift apart silently.
 */
import { SOCD_HORIZONTAL_PAIRS, SOCD_POLICIES, SOCD_VERTICAL_PAIRS } from './socd.ts';

/**
 * Two distinct strengths of claim, never flattened into one boolean (D-10). A
 * compile-verified board has been through the SOCD compile matrix; a
 * compile-and-hardware-verified board has additionally been flashed and its resolution
 * behaviour checked on real silicon.
 */
export type ModuleVerificationStrength = 'compile' | 'compile+hardware';

/**
 * One earned claim: this module, at this catalog version and pinned QMK commit, has
 * been verified to the stated strength on this keyboard. `evidence` names where the
 * proof lives so the claim is auditable, not asserted.
 */
export interface ModuleVerificationRecord {
  readonly catalogVersion: string;
  readonly qmkCommit: string;
  readonly keyboardId: string;
  readonly verification: ModuleVerificationStrength;
  readonly evidence: string;
}

/**
 * The entry's product-level launch state. `reason` is required when `enabled` is
 * false and forbidden when it is true — see `assertValidOfferState`.
 *
 * This field exists to reconcile two locked decisions that cannot both be standing
 * derived rules: D-10 ("SOCD is offered on compile-verified boards") is the per-keyboard
 * rule, and D-09 (if the hardware run cannot happen this cycle, every keyboard reports
 * `CAPABILITY_UNAVAILABLE`) is a deliberate switch thrown at phase close, not something
 * derivable from an empty hardware-verified list — deriving it that way would make the
 * compile matrix and this phase's own hardware artifact impossible to produce, since both
 * require building SOCD firmware before any hardware record can exist. `offered` is that
 * switch. It is enabled today; only a later phase plan may set it otherwise.
 */
export interface CuratedModuleOfferState {
  readonly enabled: boolean;
  readonly reason?: string;
}

/** Where a first-party module's source bytes are pinned (D-00e / SOCD_MODULE_DIGESTS). */
export interface CuratedModuleSourceRevision {
  readonly moduleVersion: string;
  readonly firstParty: true;
  readonly digestedFiles: readonly string[];
}

/** The generated-configuration/template version (D-00b: no C is generated). */
export interface CuratedModuleGeneratedContract {
  readonly kind: string;
  readonly version: string;
}

/** The user-selectable surface, referencing `socd.ts`'s frozen tables directly. */
export interface CuratedModuleSupportedOptions {
  readonly policies: typeof SOCD_POLICIES;
  readonly verticalPairs: typeof SOCD_VERTICAL_PAIRS;
  readonly horizontalPairs: typeof SOCD_HORIZONTAL_PAIRS;
}

/** The seven fields `REQ-curated-module-registry` demands, plus the offer switch. */
export interface CuratedModuleEntry {
  readonly moduleId: string;
  readonly sourceRevision: CuratedModuleSourceRevision;
  readonly license: string;
  readonly minimumHookApiVersion: string;
  readonly generatedContract: CuratedModuleGeneratedContract;
  readonly compatibilityTests: readonly string[];
  readonly supportedOptions: CuratedModuleSupportedOptions;
  readonly prerequisites: readonly string[];
  readonly verifiedFor: readonly ModuleVerificationRecord[];
  readonly offered: CuratedModuleOfferState;
}

/**
 * Throws unless `offered` is a legal shape: `reason` present iff `enabled` is false.
 * A not-enabled state without a reason would silently withdraw SOCD with nothing to
 * tell a user or a developer why.
 */
export function assertValidOfferState(offered: CuratedModuleOfferState): void {
  if (!offered.enabled && !offered.reason) {
    throw new Error('a disabled curated-module offer state must carry a reason');
  }
  if (offered.enabled && offered.reason !== undefined) {
    throw new Error('an enabled curated-module offer state must not carry a reason');
  }
}

function frozenEntry(entry: CuratedModuleEntry): CuratedModuleEntry {
  assertValidOfferState(entry.offered);
  Object.freeze(entry.sourceRevision);
  Object.freeze(entry.sourceRevision.digestedFiles);
  Object.freeze(entry.generatedContract);
  Object.freeze(entry.compatibilityTests);
  Object.freeze(entry.supportedOptions);
  Object.freeze(entry.prerequisites);
  entry.verifiedFor.forEach((record) => Object.freeze(record));
  Object.freeze(entry.verifiedFor);
  Object.freeze(entry.offered);
  return Object.freeze(entry);
}

/**
 * The curated module registry. Exactly one entry today (D-01, and
 * `.planning/REQUIREMENTS.md` § REQ-curated-module-registry scope for Phase 4: "the
 * registry ships with exactly one entry — SOCD Cleaner").
 */
export const MODULE_REGISTRY: Readonly<Record<'qmkweb/socd_cleaner', CuratedModuleEntry>> =
  Object.freeze({
    'qmkweb/socd_cleaner': frozenEntry({
      moduleId: 'qmkweb/socd_cleaner',

      // Mirrors @qmk-web-app/qmk-socd-module's SOCD_MODULE_VERSION and
      // SOCD_MODULE_FILES literally — see the dependency-direction note above for why
      // this is a hand-pinned copy rather than an import, and module.test.ts for the
      // cross-check that keeps the two in step.
      sourceRevision: {
        moduleVersion: '1.0.0',
        firstParty: true,
        digestedFiles: ['qmk_module.json', 'socd_cleaner.c', 'socd_resolve.h'],
      },

      // From packages/qmk-socd-module/module/qmkweb/socd_cleaner/qmk_module.json.
      license: 'GPL-2.0-or-later',

      // Mirrors ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1, 0, 0) in socd_cleaner.c —
      // the compile-time assertion that the module targets this hook API exactly.
      minimumHookApiVersion: '1.0.0',

      // D-00b: no C is generated. The only generated artifact is keymap.json's
      // `modules` array entry plus the four directional keycode tokens.
      generatedContract: {
        kind: 'keymap-modules-array-and-keycode-tokens',
        version: '1.0.0',
      },

      // The tests and commands that earn this entry's claims.
      compatibilityTests: [
        'packages/qmk-socd-module/src/socd-resolve.test.ts',
        'packages/domain/src/socd.test.ts',
        'packages/qmk-generator/src/generate.test.ts',
        'pnpm socd:matrix',
      ],

      // References socd.ts's frozen tables rather than restating their contents — a
      // fourth independently maintained copy is exactly what this project's
      // cross-checked-table discipline forbids.
      supportedOptions: {
        policies: SOCD_POLICIES,
        verticalPairs: SOCD_VERTICAL_PAIRS,
        horizontalPairs: SOCD_HORIZONTAL_PAIRS,
      },

      prerequisites: [
        "the pinned QMK tree's keymap schema supports a keymap.json \"modules\" array",
        'the pinned tree\'s community-module hook API meets minimumHookApiVersion',
        'the keyboard has a matching record in verifiedFor for the requested catalog version',
      ],

      // Seeded with the single claim earned so far (plan 04-01's socd:matrix run).
      // Do not add mode/m256wh here — plan 04 adds it after a real matrix run, and
      // plan 05 upgrades a record's strength after a hardware run.
      verifiedFor: [
        {
          catalogVersion: '0.33.13-1',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-1 (2026-09-02 run, both policies)',
        },
      ],

      // D-09's phase-close switch. Enabled today; only plan 05 may set this otherwise.
      offered: { enabled: true },
    }),
  });
