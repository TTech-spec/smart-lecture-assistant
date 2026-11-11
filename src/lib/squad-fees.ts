/** Fee maths shared by the browser (display) and the server (what is charged). */
// ── Fee constants ─────────────────────────────────────────────────────────────
// Squad local card/transfer: 1.2%, capped at ₦1,500
export const SQUAD_RATE        = 0.012;
export const SQUAD_FEE_CAP     = 1500;   // ₦
// Transfer payout fee (₦10–₦50 flat; we charge ₦50 to be safe)
export const TRANSFER_FEE      = 50;     // ₦
// Payment gateway processing fee charged to the student on every transaction
export const PLATFORM_FEE      = 1000;   // ₦

/**
 * Given the lecturer's listed price (what they want to receive),
 * return the full breakdown of what the student pays.
 *
 *  Student pays  = lecturerPrice + platformFee + transferFee + squadFee
 *  squadFee      = 1.2% of (lecturerPrice + platformFee + transferFee), capped ₦1,500
 */
export function calcFees(lecturerPrice: number): {
  lecturerPrice: number;
  platformFee: number;
  transferFee: number;
  squadFee: number;
  totalCharge: number;
} {
  const base      = lecturerPrice + PLATFORM_FEE + TRANSFER_FEE;
  const squadFee  = Math.min(Math.round(base * SQUAD_RATE), SQUAD_FEE_CAP);
  const total     = base + squadFee;
  return {
    lecturerPrice,
    platformFee: PLATFORM_FEE,
    transferFee: TRANSFER_FEE,
    squadFee,
    totalCharge: total,
  };
}

