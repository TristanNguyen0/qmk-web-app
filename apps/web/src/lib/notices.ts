/**
 * The data-loss disclosure copy (phase 5 launch-identity decision D-01/D-02).
 *
 * Kept as data in a plain `.ts` module — not inline JSX — because that is what makes
 * it unit-testable without a DOM: `vitest.config.ts` includes `apps/**\/*.test.ts`
 * only, and this repository has no jsdom and no testing-library. A source assertion
 * against this string plus the two render sites is the whole test surface, and it is
 * deterministic in a way a DOM snapshot would not add anything to.
 *
 * The copy states two facts plainly — this work belongs to this browser's cookie, and
 * clearing that cookie loses it — and names the escape hatch (export) so the warning
 * is not just an apology with no remedy. It does not call this temporary and does not
 * imply accounts are coming: D-01 is a launch decision, not a stopgap, and softening
 * it with a qualifier would misrepresent the decision this notice exists to state
 * honestly.
 */
export const DATA_LOSS_NOTICE =
  'Your configurations are tied to this browser’s cookie — there are no accounts. ' +
  'Clearing cookies, switching browsers, or using a different device loses this work permanently. ' +
  'Export a configuration to keep a copy you can import back later.';
