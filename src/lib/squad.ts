import { supabase } from "./supabase";

export { SQUAD_RATE, SQUAD_FEE_CAP, TRANSFER_FEE, PLATFORM_FEE, calcFees } from "./squad-fees";

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

// ── Purchase tokens (issued by the server after Squad confirms payment) ──────
const TOKENS_KEY = "att.material.tokens.v1";

function loadTokens(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || "{}"); } catch { return {}; }
}

export function savePurchaseToken(materialId: string, token: string) {
  const all = loadTokens();
  all[materialId] = token;
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

export function getPurchaseToken(materialId: string): string | null {
  return loadTokens()[materialId] ?? null;
}

/**
 * Whether this phone holds a purchase token for the material. A token
 * typed in by hand doesn't help: the server checks it before handing out
 * the file link.
 */
export function hasUserPaidForMaterial(materialId: string, _matricNumber?: string): boolean {
  return Boolean(getPurchaseToken(materialId));
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
