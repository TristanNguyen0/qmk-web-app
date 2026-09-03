/**
 * The persistent, non-dismissable data-loss disclosure (phase 5 D-02).
 *
 * Deliberately takes no props at all — no `dismissible`, no `onDismiss`, no
 * `variant`. That is the mechanical enforcement of "non-dismissable": there is no API
 * through which a caller could hide it, so a future page cannot quietly opt out.
 * Dismissible was rejected outright — the dismissal would have to live in the very
 * cookie that is at risk, so the user most likely to be harmed by losing that cookie
 * is exactly the one who would never see the notice again.
 */
import { DATA_LOSS_NOTICE } from '../lib/notices.ts';

export function DataLossNotice() {
  return <p className="data-loss">{DATA_LOSS_NOTICE}</p>;
}
