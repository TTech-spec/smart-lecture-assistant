/**
 * The only payment endpoints the browser can call. Each one decides prices,
 * confirms payments and picks payout accounts on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { finalizePayment, payOutstanding, PaymentError, startPayment } from "./payments-core";
import { adminClient, platform, requireLecturer, squadClient, supabaseDb } from "./payments-adapters.server";

const PAID_PREFIX = "storage:materials-paid/";

/** Student: start paying for a material (amount comes from the database). */
export const startMaterialPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    materialId: z.string().min(1).max(100),
    matric: z.string().min(3).max(40),
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(30),
    origin: z.string().url().max(200),
  }).parse(d))
  .handler(async ({ data }) => {
    try {
      const db = supabaseDb(adminClient());
      const callbackUrl = `${new URL(data.origin).origin}/materials`;
      const r = await startPayment(db, squadClient, { materialId: data.materialId, matric: data.matric, name: data.name, phone: data.phone, callbackUrl });
      return { ok: true as const, ...r };
    } catch (e) {
      return { ok: false as const, code: e instanceof PaymentError ? e.code : "error", message: e instanceof Error ? e.message : "Could not start payment." };
    }
  });

/** Student: has this payment gone through? Returns an access token once it has. */
export const confirmMaterialPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ transactionRef: z.string().min(5).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const db = supabaseDb(adminClient());
    return finalizePayment(db, squadClient, data.transactionRef, platform());
  });

/** Student: a short-lived link to a paid file, for a valid purchase token. */
export const getMaterialLink = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ materialId: z.string().min(1).max(100), accessToken: z.string().min(20).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const sb = adminClient();
    const db = supabaseDb(sb);
    if (!(await db.findPurchase(data.materialId, data.accessToken))) return { ok: false as const, message: "No purchase found for this material." };
    const m = await db.getMaterial(data.materialId);
    if (!m) return { ok: false as const, message: "Material not found." };
    if (m.url.startsWith(PAID_PREFIX)) {
      const { data: signed, error } = await sb.storage.from("materials-paid").createSignedUrl(m.url.slice(PAID_PREFIX.length), 60 * 10);
      if (error || !signed) return { ok: false as const, message: "Could not open the file. Try again." };
      return { ok: true as const, url: signed.signedUrl };
    }
    return { ok: true as const, url: m.url };
  });

/** Lecturer: earnings, money still owed, and recent payouts. */
export const lecturerPaymentsSummary = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accessToken: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const sb = adminClient();
    try { await requireLecturer(sb, data.accessToken); } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : "not_lecturer" }; }
    const sales = (await sb.from("squad_payment_records").select("lecturer_amount, lecturer_paid").eq("status", "successful")).data ?? [];
    const payouts = (await sb.from("payouts").select("kind, amount, status, account_number, created_at, message").order("created_at", { ascending: false }).limit(15)).data ?? [];
    const earned = sales.reduce((t, s) => t + Number(s.lecturer_amount), 0);
    const owed = sales.filter((s) => !s.lecturer_paid).reduce((t, s) => t + Number(s.lecturer_amount), 0);
    return {
      ok: true as const,
      earned, salesCount: sales.length,
      owed, owedCount: sales.filter((s) => !s.lecturer_paid).length,
      payouts: payouts.map((p) => ({ ...p, account_number: p.account_number ? `••••${String(p.account_number).slice(-4)}` : null })),
    };
  });

/** Lecturer: pay out every sale whose automatic payout didn't go through. */
export const lecturerPayOutstanding = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accessToken: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const sb = adminClient();
    try { await requireLecturer(sb, data.accessToken); } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : "not_lecturer" }; }
    const r = await payOutstanding(supabaseDb(sb), squadClient);
    return { ok: true as const, ...r };
  });
