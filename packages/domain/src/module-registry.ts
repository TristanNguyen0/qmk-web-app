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
 *
 * **A second, real circular import (`socd.ts` <-> this file), and how it stays safe:**
 * `socd.ts`'s `socdCapabilitiesFor` reads `MODULE_REGISTRY`, and this file's
 * `supportedOptions` field reads `socd.ts`'s frozen tables (`SOCD_POLICIES` and
 * friends) rather than restating them. Whichever of the two files a given entry point
 * evaluates first would, if `supportedOptions` were a plain value computed eagerly at
 * this module's own top level, try to read the other's `const` export before that
 * export's declaration has run — a TDZ `ReferenceError`, not just a lint smell. Below,
 * `supportedOptions` is instead a getter, evaluated lazily on first access rather than
 * during this module's own top-level evaluation; `socd.ts`'s only reference to
 * `MODULE_REGISTRY` is likewise inside function bodies, not its top level. Neither side
 * needs the other's bindings until application code actually calls into either module,
 * by which point the whole module graph has finished loading — so the cycle is inert
 * regardless of which file a test or another package imports first.
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

/**
 * Builds a frozen entry from every field except `supportedOptions`, which is attached
 * separately as a lazy getter (see the circular-import note above) — computed and
 * frozen on first access rather than during this module's own evaluation.
 */
function buildFrozenEntry(base: Omit<CuratedModuleEntry, 'supportedOptions'>): CuratedModuleEntry {
  assertValidOfferState(base.offered);
  Object.freeze(base.sourceRevision);
  Object.freeze(base.sourceRevision.digestedFiles);
  Object.freeze(base.generatedContract);
  Object.freeze(base.compatibilityTests);
  Object.freeze(base.prerequisites);
  base.verifiedFor.forEach((record) => Object.freeze(record));
  Object.freeze(base.verifiedFor);
  Object.freeze(base.offered);

  const entry = base as CuratedModuleEntry;
  let cachedSupportedOptions: CuratedModuleSupportedOptions | undefined;
  Object.defineProperty(entry, 'supportedOptions', {
    enumerable: true,
    configurable: true,
    get(): CuratedModuleSupportedOptions {
      cachedSupportedOptions ??= Object.freeze({
        policies: SOCD_POLICIES,
        verticalPairs: SOCD_VERTICAL_PAIRS,
        horizontalPairs: SOCD_HORIZONTAL_PAIRS,
      });
      return cachedSupportedOptions;
    },
  });

  return Object.freeze(entry);
}

/**
 * The curated module registry. Exactly one entry today (D-01, and
 * `.planning/REQUIREMENTS.md` § REQ-curated-module-registry scope for Phase 4: "the
 * registry ships with exactly one entry — SOCD Cleaner").
 */
export const MODULE_REGISTRY: Readonly<Record<'qmkweb/socd_cleaner', CuratedModuleEntry>> =
  Object.freeze({
    'qmkweb/socd_cleaner': buildFrozenEntry({
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

      // supportedOptions is attached by buildFrozenEntry as a lazy getter over
      // socd.ts's frozen tables — see the circular-import note at the top of this
      // file for why it cannot be a plain field here.

      prerequisites: [
        "the pinned QMK tree's keymap schema supports a keymap.json \"modules\" array",
        'the pinned tree\'s community-module hook API meets minimumHookApiVersion',
        'the keyboard has a matching record in verifiedFor for the requested catalog version',
      ],

      // crkbd/rev1 (AVR) earned in plan 04-01's socd:matrix run; mode/m256wh
      // (ARM/STM32) earned in plan 04-04's real 4-build matrix run (D-06, D-10) —
      // both compile-only. Plan 05 upgrades a record's strength after a hardware
      // run; no record here may carry a hardware strength until then (D-09).
      verifiedFor: [
        {
          catalogVersion: '0.33.13-1',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-1 (2026-09-02 run, both policies)',
        },
        {
          catalogVersion: '0.33.13-1',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'mode/m256wh',
          verification: 'compile',
          evidence:
            'pnpm socd:matrix catalogs/0.33.13-1 (2026-09-02 run, both policies; first ' +
            'ARM/STM32 compile, .bin artifact, 64696 bytes)',
        },
        // Catalog 0.33.13-2 (extractor v2 / normalizer v2: default keymaps and the
        // keycode alias table) re-earned both records with a fresh matrix run rather
        // than inheriting them: the QMK commit is unchanged, but a verifiedFor record
        // is per catalog version by design, so the claim is re-proven, not assumed.
        {
          catalogVersion: '0.33.13-2',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-2 (2026-09-04 run, both policies; .hex, 59491 bytes)',
        },
        {
          catalogVersion: '0.33.13-2',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'mode/m256wh',
          verification: 'compile',
          evidence:
            'pnpm socd:matrix catalogs/0.33.13-2 (2026-09-04 run, both policies; .bin, 64696 bytes — ' +
            'byte-identical size to the 0.33.13-1 run, as expected for an unchanged QMK commit)',
        },
        // Catalog 0.33.13-3 (extractor v3 / normalizer v3: community-layout keymaps).
        {
          catalogVersion: '0.33.13-3',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-3 (2026-09-06 run, both policies; .hex, 59491 bytes, same sha256 as the 0.33.13-2 run)',
        },
        {
          catalogVersion: '0.33.13-3',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'mode/m256wh',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-3 (2026-09-06 run, both policies; .bin, 64696 bytes, same sha256 as the 0.33.13-2 run)',
        },
        // Catalog 0.33.13-4 (extractor v4 / normalizer v4: community-layout geometry).
        {
          catalogVersion: '0.33.13-4',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-4 (2026-09-06 run, both policies; .hex, 59491 bytes, same sha256 as the 0.33.13-3 run)',
        },
        {
          catalogVersion: '0.33.13-4',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'mode/m256wh',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-4 (2026-09-06 run, both policies; .bin, 64696 bytes, same sha256 as the 0.33.13-3 run)',
        },
        // Catalog 0.33.13-5 (extractor v5 / normalizer v5: curated documentation chunks).
        {
          catalogVersion: '0.33.13-5',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'crkbd/rev1',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-5 (2026-09-06 run, both policies; .hex, 59491 bytes, same sha256 as the 0.33.13-4 run)',
        },
        {
          catalogVersion: '0.33.13-5',
          qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
          keyboardId: 'mode/m256wh',
          verification: 'compile',
          evidence: 'pnpm socd:matrix catalogs/0.33.13-5 (2026-09-06 run, both policies; .bin, 64696 bytes, same sha256 as the 0.33.13-4 run)',
        },
      ],

      // D-09's phase-close switch. Enabled today; only plan 05 may set this otherwise.
      offered: { enabled: true },
    }),
  });
