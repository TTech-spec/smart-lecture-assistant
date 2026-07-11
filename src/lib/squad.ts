import { supabase } from "./supabase";

// ── Fee constants ─────────────────────────────────────────────────────────────
// Squad local card/transfer: 1.2%, capped at ₦1,500
export const SQUAD_RATE        = 0.012;
export const SQUAD_FEE_CAP     = 1500;   // ₦
// Transfer payout fee (₦10–₦50 flat; we charge ₦50 to be safe)
export const TRANSFER_FEE      = 50;     // ₦
// Platform fee that goes to our account on every sale
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

// ── Types ─────────────────────────────────────────────────────────────────────
export type SquadPaymentStatus = "pending" | "successful" | "failed" | "cancelled";

export type SquadPaymentRecord = {
  id: string;
  transactionRef: string;
  materialId: string;
  materialTitle: string;
  /** Amount charged to student in NGN (full total) */
  chargedAmount: number;
  /** Lecturer's portion (chargedAmount - platformFee - transferFee - squadFee) */
  lecturerAmount: number;
  platformFee: number;
  transferFee: number;
  squadFee: number;
  currency: string;
  status: SquadPaymentStatus;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  lecturerAccountNumber?: string;
  lecturerBankCode?: string;
  lecturerAccountName?: string;
  payoutRef?: string;
  payoutStatus?: "pending" | "successful" | "failed";
  createdAt: string;
  updatedAt: string;
};

// ── LocalStorage helpers ──────────────────────────────────────────────────────
const PAYMENTS_KEY = "att.squad.payments.v1";

export function loadSquadPayments(): SquadPaymentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PAYMENTS_KEY) || "[]") as SquadPaymentRecord[];
  } catch {
    return [];
  }
}

export function saveSquadPayments(records: SquadPaymentRecord[]) {
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(records));
}

export async function saveSquadPayment(record: SquadPaymentRecord): Promise<void> {
  const all = loadSquadPayments();
  const idx = all.findIndex((r) => r.transactionRef === record.transactionRef);
  if (idx >= 0) all[idx] = record; else all.push(record);
  saveSquadPayments(all);

  if (supabase) {
    await supabase.from("squad_payment_records").upsert({
      id: record.id,
      transaction_ref: record.transactionRef,
      material_id: record.materialId,
      material_title: record.materialTitle,
      charged_amount: record.chargedAmount,
      lecturer_amount: record.lecturerAmount,
      platform_fee: record.platformFee,
      transfer_fee: record.transferFee,
      squad_fee: record.squadFee,
      currency: record.currency,
      status: record.status,
      customer_email: record.customerEmail,
      customer_name: record.customerName,
      customer_phone: record.customerPhone,
      lecturer_account_number: record.lecturerAccountNumber ?? null,
      lecturer_bank_code: record.lecturerBankCode ?? null,
      lecturer_account_name: record.lecturerAccountName ?? null,
      payout_ref: record.payoutRef ?? null,
      payout_status: record.payoutStatus ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }
}

export function hasUserPaidForMaterial(materialId: string, email: string): boolean {
  return loadSquadPayments().some(
    (p) =>
      p.materialId === materialId &&
      p.customerEmail.toLowerCase() === email.toLowerCase() &&
      p.status === "successful"
  );
}

export function generateTransactionRef(): string {
  return `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ── Nigerian bank list (for the lecturer bank selector) ───────────────────────
export const NG_BANKS: { code: string; name: string }[] = [
  { code: "044", name: "Access Bank" },
  { code: "063", name: "Access Bank (Diamond)" },
  { code: "050", name: "Ecobank" },
  { code: "214", name: "FCMB" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank" },
  { code: "058", name: "Guaranty Trust Bank (GTBank)" },
  { code: "030", name: "Heritage Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "033", name: "UBA" },
  { code: "032", name: "Union Bank" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
  { code: "50211", name: "Kuda MFB" },
  { code: "566", name: "VFD MFB" },
  { code: "303", name: "LOTUS Bank" },
  { code: "000016", name: "Opay" },
  { code: "000014", name: "Palmpay" },
  { code: "000013", name: "GTBank Mobile Money" },
];
