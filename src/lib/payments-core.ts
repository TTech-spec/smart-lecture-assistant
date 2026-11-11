/**
 * Payment rules, independent of Supabase and Squad so they can be tested
 * with stand-ins. Everything that decides money — price, fees, whether a
 * payment really happened, and where payouts go — is decided here, on the
 * server, from data only lecturers can change.
 */
import { calcFees } from "./squad-fees";

export type MaterialRow = {
  id: string;
  title: string;
  accessType: string;
  price: number;
  url: string;
  accountNumber: string | null;
  bankCode: string | null;
  accountName: string | null;
};

export type PaymentRow = {
  transactionRef: string;
  materialId: string;
  materialTitle: string;
  chargedAmount: number;
  lecturerAmount: number;
  platformFee: number;
  status: string;
  customerName: string;
  matric: string;
  lecturerPaid: boolean;
};

export type Db = {
  getMaterial(id: string): Promise<MaterialRow | null>;
  insertPending(row: PaymentRow & { transferFee: number; squadFee: number; phone: string }): Promise<void>;
  getPayment(ref: string): Promise<PaymentRow | null>;
  /** pending → successful; returns the row only if this call made the change */
  markSuccessful(ref: string): Promise<PaymentRow | null>;
  markFailed(ref: string): Promise<void>;
  getPurchaseToken(ref: string): Promise<string | null>;
  insertPurchase(p: { materialId: string; name: string; matric: string; amount: number; token: string; ref: string }): Promise<void>;
  /** lecturer_paid false → true; returns true only if this call claimed it */
  claimLecturerPayout(ref: string): Promise<boolean>;
  releaseLecturerPayout(ref: string): Promise<void>;
  listUnpaidSales(): Promise<PaymentRow[]>;
  logPayout(p: { kind: string; ref: string | null; transferRef: string; amount: number; account: string | null; bank: string | null; ok: boolean; message: string }): Promise<void>;
  findPurchase(materialId: string, token: string): Promise<boolean>;
};

export type Squad = {
  initiate(p: { ref: string; amountNGN: number; email: string; name: string; title: string; callbackUrl: string }): Promise<string>;
  verify(ref: string): Promise<{ status: string; amountKobo: number }>;
  transfer(p: { transferRef: string; amountNGN: number; account: string; bank: string; accountName: string; remark: string }): Promise<{ ok: boolean; message: string }>;
};

export type PlatformAccount = { account: string; bank: string } | null;

export class PaymentError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const randomHex = (bytes: number) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

export function newTransactionRef(): string {
  return `ATT-${Date.now()}-${randomHex(4).toUpperCase()}`;
}

/** Start a payment: price and fees come from the database, not the browser. */
export async function startPayment(
  db: Db, squad: Squad,
  input: { materialId: string; matric: string; name: string; phone: string; callbackUrl: string },
): Promise<{ transactionRef: string; checkoutUrl: string; totalCharge: number }> {
  const m = await db.getMaterial(input.materialId);
  if (!m) throw new PaymentError("not_found", "Material not found.");
  if (m.accessType !== "paid" || !(m.price > 0)) throw new PaymentError("not_paid", "This material is free.");
  const matric = input.matric.trim().toUpperCase();
  if (matric.length < 3 || !input.name.trim() || !input.phone.trim()) throw new PaymentError("invalid", "Fill in your matric number, name and phone.");

  const fees = calcFees(m.price);
  const ref = newTransactionRef();
  await db.insertPending({
    transactionRef: ref, materialId: m.id, materialTitle: m.title,
    chargedAmount: fees.totalCharge, lecturerAmount: fees.lecturerPrice, platformFee: fees.platformFee,
    transferFee: fees.transferFee, squadFee: fees.squadFee,
    status: "pending", customerName: input.name.trim().slice(0, 120), matric, phone: input.phone.trim().slice(0, 30),
    lecturerPaid: false,
  });
  const email = `${matric.toLowerCase().replace(/[^a-z0-9]/g, "")}@student.attendly.app`;
  const checkoutUrl = await squad.initiate({ ref, amountNGN: fees.totalCharge, email, name: input.name.trim(), title: m.title, callbackUrl: input.callbackUrl });
  return { transactionRef: ref, checkoutUrl, totalCharge: fees.totalCharge };
}

export type FinalizeResult =
  | { state: "success"; materialId: string; accessToken: string }
  | { state: "pending" | "failed" | "not_found" | "amount_mismatch" };

/**
 * Confirm a payment with Squad and finish it exactly once: record the
 * purchase, pay the lecturer (account from the material, lecturer-only) and
 * the platform. Safe to call repeatedly and concurrently (poll + webhook).
 */
export async function finalizePayment(db: Db, squad: Squad, ref: string, platform: PlatformAccount): Promise<FinalizeResult> {
  const rec = await db.getPayment(ref);
  if (!rec) return { state: "not_found" };

  if (rec.status === "successful") {
    const token = await db.getPurchaseToken(ref);
    return token ? { state: "success", materialId: rec.materialId, accessToken: token } : { state: "pending" };
  }
  if (rec.status !== "pending") return { state: "failed" };

  const v = await squad.verify(ref);
  const status = v.status.toLowerCase();
  if (status === "failed" || status === "cancelled" || status === "abandoned") {
    await db.markFailed(ref);
    return { state: "failed" };
  }
  if (status !== "success") return { state: "pending" };
  if (!(v.amountKobo >= Math.round(rec.chargedAmount * 100))) return { state: "amount_mismatch" };

  const won = await db.markSuccessful(ref);
  if (!won) {
    // Another call (poll or webhook) finished it first
    const token = await db.getPurchaseToken(ref);
    return token ? { state: "success", materialId: rec.materialId, accessToken: token } : { state: "pending" };
  }

  const token = randomHex(24);
  await db.insertPurchase({ materialId: won.materialId, name: won.customerName, matric: won.matric, amount: won.lecturerAmount, token, ref });

  await payLecturer(db, squad, won, "sale");

  if (platform && won.platformFee > 0) {
    const transferRef = `PAY-PLAT-${ref}`;
    const r = await squad.transfer({ transferRef, amountNGN: won.platformFee, account: platform.account, bank: platform.bank, accountName: "Attendly Platform", remark: `Platform fee: ${won.materialTitle}` })
      .catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : "transfer failed" }));
    await db.logPayout({ kind: "platform", ref, transferRef, amount: won.platformFee, account: platform.account, bank: platform.bank, ok: r.ok, message: r.message });
  }

  return { state: "success", materialId: won.materialId, accessToken: token };
}

/** Pay the lecturer for one sale, once, to the account saved on the material. */
async function payLecturer(db: Db, squad: Squad, sale: PaymentRow, kind: "sale" | "retry"): Promise<{ paid: boolean; amount: number }> {
  const m = await db.getMaterial(sale.materialId);
  if (!m?.accountNumber || !m.bankCode) return { paid: false, amount: 0 };
  if (!(await db.claimLecturerPayout(sale.transactionRef))) return { paid: false, amount: 0 };

  const transferRef = kind === "sale" ? `PAY-LEC-${sale.transactionRef}` : `PAY-LEC-${sale.transactionRef}-R${Date.now()}`;
  const r = await squad.transfer({
    transferRef, amountNGN: sale.lecturerAmount, account: m.accountNumber, bank: m.bankCode,
    accountName: m.accountName || "Lecturer", remark: `Payout for: ${sale.materialTitle}`,
  }).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : "transfer failed" }));
  await db.logPayout({ kind, ref: sale.transactionRef, transferRef, amount: sale.lecturerAmount, account: m.accountNumber, bank: m.bankCode, ok: r.ok, message: r.message });
  if (!r.ok) {
    await db.releaseLecturerPayout(sale.transactionRef);
    return { paid: false, amount: 0 };
  }
  return { paid: true, amount: sale.lecturerAmount };
}

/** Lecturer-only: pay out every successful sale whose payout hasn't gone through. */
export async function payOutstanding(db: Db, squad: Squad): Promise<{ paidCount: number; paidAmount: number; failedCount: number }> {
  const sales = await db.listUnpaidSales();
  let paidCount = 0, paidAmount = 0, failedCount = 0;
  for (const s of sales) {
    const r = await payLecturer(db, squad, s, "retry");
    if (r.paid) { paidCount++; paidAmount += r.amount; } else failedCount++;
  }
  return { paidCount, paidAmount, failedCount };
}
