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
    if (typeof window === "undefined") return [];
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
/**
 * Banks for payouts, using the 6-digit NIBSS (NIP) institution codes that
 * transfer APIs such as Squad expect. Lecturers can also type any other code
 * via "Other bank". Checked against Squad's bank list. Moniepoint is not in it: use Other bank.
 */
export const NG_BANKS: { code: string; name: string }[] = [
  { code: "000014", name: "Access Bank" },
  { code: "000005", name: "Access Bank (Diamond)" },
  { code: "000009", name: "Citibank" },
  { code: "000010", name: "Ecobank" },
  { code: "090551", name: "FairMoney MFB" },
  { code: "000003", name: "FCMB" },
  { code: "000007", name: "Fidelity Bank" },
  { code: "000016", name: "First Bank" },
  { code: "000027", name: "Globus Bank" },
  { code: "100022", name: "GoMoney" },
  { code: "000013", name: "Guaranty Trust Bank (GTBank)" },
  { code: "000020", name: "Heritage Bank" },
  { code: "120002", name: "HopePSB" },
  { code: "000006", name: "Jaiz Bank" },
  { code: "000002", name: "Keystone Bank" },
  { code: "090267", name: "Kuda MFB" },
  { code: "000029", name: "Lotus Bank" },
  { code: "120003", name: "MoMo PSB" },
  { code: "120001", name: "9PSB" },
  { code: "100026", name: "One Finance (Carbon)" },
  { code: "100004", name: "OPay" },
  { code: "000036", name: "Optimus Bank" },
  { code: "100002", name: "Paga" },
  { code: "100033", name: "PalmPay" },
  { code: "000008", name: "Polaris Bank" },
  { code: "000031", name: "PremiumTrust Bank" },
  { code: "000023", name: "Providus Bank" },
  { code: "090198", name: "RenMoney MFB" },
  { code: "000034", name: "Signature Bank" },
  { code: "120004", name: "SmartCash PSB" },
  { code: "090325", name: "Sparkle" },
  { code: "000012", name: "Stanbic IBTC Bank" },
  { code: "000021", name: "Standard Chartered" },
  { code: "000001", name: "Sterling Bank" },
  { code: "000022", name: "SunTrust Bank" },
  { code: "000026", name: "Taj Bank" },
  { code: "000025", name: "Titan Trust Bank" },
  { code: "000004", name: "UBA" },
  { code: "000018", name: "Union Bank" },
  { code: "000011", name: "Unity Bank" },
  { code: "090110", name: "VFD MFB" },
  { code: "000017", name: "Wema Bank (ALAT)" },
  { code: "000015", name: "Zenith Bank" },
];

export const OTHER_BANK = "__other__";
