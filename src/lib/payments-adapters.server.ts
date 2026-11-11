/**
 * Server-only: connects the payment rules (payments-core.ts) to Supabase
 * (with the service role key — never sent to the browser) and to Squad.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Db, MaterialRow, PaymentRow, PlatformAccount, Squad } from "./payments-core";
import { platformAccount, runPayoutToLecturer, squadFetch, squadVerify } from "./squad-server";

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error("Payments aren't set up yet: SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const toPayment = (r: Row): PaymentRow => ({
  transactionRef: r.transaction_ref, materialId: r.material_id, materialTitle: r.material_title,
  chargedAmount: Number(r.charged_amount), lecturerAmount: Number(r.lecturer_amount), platformFee: Number(r.platform_fee),
  status: r.status, customerName: r.customer_name, matric: r.customer_email, lecturerPaid: Boolean(r.lecturer_paid),
});

export function supabaseDb(sb: SupabaseClient): Db {
  const must = <T,>(res: { data: T; error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };
  return {
    async getMaterial(id) {
      const r = must(await sb.from("materials").select("*").eq("id", id).maybeSingle()) as Row | null;
      if (!r) return null;
      const m: MaterialRow = {
        id: r.id, title: r.title, accessType: r.access_type, price: Number(r.price) || 0, url: r.url,
        accountNumber: r.lecturer_account_number ?? null, bankCode: r.lecturer_bank_code ?? null, accountName: r.lecturer_account_name ?? null,
      };
      return m;
    },
    async insertPending(p) {
      const now = new Date().toISOString();
      must(await sb.from("squad_payment_records").insert({
        id: crypto.randomUUID(), transaction_ref: p.transactionRef, material_id: p.materialId, material_title: p.materialTitle,
        charged_amount: p.chargedAmount, lecturer_amount: p.lecturerAmount, platform_fee: p.platformFee,
        transfer_fee: p.transferFee, squad_fee: p.squadFee, currency: "NGN", status: "pending",
        customer_email: p.matric, customer_name: p.customerName, customer_phone: p.phone,
        lecturer_paid: false, created_at: now, updated_at: now,
      }));
    },
    async getPayment(ref) {
      const r = must(await sb.from("squad_payment_records").select("*").eq("transaction_ref", ref).maybeSingle()) as Row | null;
      return r ? toPayment(r) : null;
    },
    async markSuccessful(ref) {
      const rows = must(await sb.from("squad_payment_records")
        .update({ status: "successful", updated_at: new Date().toISOString() })
        .eq("transaction_ref", ref).eq("status", "pending").select("*")) as Row[];
      return rows?.[0] ? toPayment(rows[0]) : null;
    },
    async markFailed(ref) {
      must(await sb.from("squad_payment_records").update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("transaction_ref", ref).eq("status", "pending"));
    },
    async getPurchaseToken(ref) {
      const r = must(await sb.from("material_purchases").select("access_token").eq("transaction_ref", ref).maybeSingle()) as Row | null;
      return r?.access_token ?? null;
    },
    async insertPurchase(p) {
      must(await sb.from("material_purchases").insert({
        id: crypto.randomUUID(), material_id: p.materialId, student_name: p.name, matric_number: p.matric,
        purchase_amount: p.amount, currency: "NGN", purchased_at: new Date().toISOString(),
        access_token: p.token, transaction_ref: p.ref,
      }));
    },
    async claimLecturerPayout(ref) {
      const rows = must(await sb.from("squad_payment_records").update({ lecturer_paid: true })
        .eq("transaction_ref", ref).eq("lecturer_paid", false).select("transaction_ref")) as Row[];
      return (rows?.length ?? 0) > 0;
    },
    async releaseLecturerPayout(ref) {
      must(await sb.from("squad_payment_records").update({ lecturer_paid: false }).eq("transaction_ref", ref));
    },
    async listUnpaidSales() {
      const rows = must(await sb.from("squad_payment_records").select("*").eq("status", "successful").eq("lecturer_paid", false)) as Row[];
      return (rows || []).map(toPayment);
    },
    async logPayout(p) {
      await sb.from("payouts").insert({
        kind: p.kind, transaction_ref: p.ref, transfer_ref: p.transferRef, amount: p.amount,
        account_number: p.account, bank_code: p.bank, status: p.ok ? "sent" : "failed", message: p.message.slice(0, 300),
      });
    },
    async findPurchase(materialId, token) {
      const r = must(await sb.from("material_purchases").select("id").eq("material_id", materialId).eq("access_token", token).maybeSingle());
      return Boolean(r);
    },
  };
}

export const squadClient: Squad = {
  async initiate(p) {
    const json = await squadFetch("/transaction/initiate", {
      email: p.email, amount: Math.round(p.amountNGN * 100), currency: "NGN", initiate_type: "inline",
      transaction_ref: p.ref, callback_url: p.callbackUrl, pass_charge: true, customer_name: p.name,
      payment_channels: ["card", "bank", "ussd", "bank_transfer"],
      metadata: { meta: [{ display_name: "Material", variable_name: "material", value: p.title }] },
    }) as { data?: { checkout_url?: string } };
    const url = json.data?.checkout_url;
    if (!url) throw new Error("Squad did not return a checkout link.");
    return url;
  },
  verify: squadVerify,
  async transfer(p) {
    const r = await runPayoutToLecturer({
      transferRef: p.transferRef, amountNGN: p.amountNGN, lecturerAccountNumber: p.account,
      lecturerBankCode: p.bank, lecturerAccountName: p.accountName, narration: p.remark,
    });
    return { ok: Boolean(r.success), message: String(r.message ?? "") };
  },
};

export function platform(): PlatformAccount {
  const p = platformAccount();
  return p.accountNumber ? { account: p.accountNumber, bank: p.bankCode } : null;
}

/** The signed-in lecturer for a Supabase access token, or an error. */
export async function requireLecturer(sb: SupabaseClient, accessToken: string): Promise<string> {
  const { data, error } = await sb.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("not_signed_in");
  const row = await sb.from("lecturers").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row.data) throw new Error("not_lecturer");
  return data.user.id;
}
