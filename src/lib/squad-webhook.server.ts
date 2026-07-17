import { supabase } from "./supabase";
import { secretKey, runPayoutToLecturer, runPayoutToPlatform } from "./squad-server";

/**
 * Squad signs the raw webhook body with HMAC-SHA512 using your secret key and
 * sends the hex digest in the `x-squad-encrypted-body` header (some Squad docs
 * call this `x-squad-signature` — we accept either header name).
 */
async function hmacSha512Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type SquadWebhookBody = {
  transaction_ref?: string;
  transaction_status?: string;
};

type SquadWebhookPayload = {
  Event?: string;
  TransactionRef?: string;
  Body?: SquadWebhookBody;
};

/**
 * Handles POST /api/squad/webhook. Wired up directly in src/server.ts, ahead of
 * the TanStack Start SSR handler, since this Cloudflare Worker entry is a plain
 * fetch(request) handler and the simplest place to add a raw HTTP endpoint.
 *
 * This is a safety net alongside the client-side poll in PaymentModal.tsx —
 * it finalizes a payment even if the student closes the checkout tab before
 * the poll picks up the "success" status.
 */
export async function handleSquadWebhook(request: Request): Promise<Response> {
  const key = secretKey();
  if (!key) return new Response("Squad not configured", { status: 500 });

  const rawBody = await request.text();
  const signature =
    request.headers.get("x-squad-encrypted-body") ||
    request.headers.get("x-squad-signature") ||
    "";
  if (!signature) return new Response("Missing signature", { status: 401 });

  const expected = await hmacSha512Hex(key, rawBody);
  if (expected.toLowerCase() !== signature.toLowerCase()) {
    console.error("Squad webhook: signature mismatch");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: SquadWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const event = payload.Event;
  const body = payload.Body || {};
  const ref = body.transaction_ref || payload.TransactionRef;
  const status = (body.transaction_status || "").toLowerCase();

  // Only "charge_successful" + "success" moves money — everything else is a
  // no-op ack so Squad doesn't keep retrying.
  if (event !== "charge_successful" || status !== "success" || !ref) {
    return new Response("ok", { status: 200 });
  }

  if (!supabase) return new Response("ok", { status: 200 });

  const { data: existing } = await supabase
    .from("squad_payment_records")
    .select("*")
    .eq("transaction_ref", ref)
    .maybeSingle();

  if (!existing) {
    console.warn(`Squad webhook: no payment record found for ${ref}`);
    return new Response("ok", { status: 200 });
  }
  if (existing.status === "successful") {
    // Already finalized — most likely by the client-side poll. Nothing to do.
    return new Response("ok", { status: 200 });
  }

  await supabase
    .from("squad_payment_records")
    .update({ status: "successful", updated_at: new Date().toISOString() })
    .eq("transaction_ref", ref);

  await supabase.from("material_purchases").upsert({
    id: crypto.randomUUID(),
    material_id: existing.material_id,
    student_name: existing.customer_name,
    matric_number: existing.customer_email,
    purchase_amount: existing.lecturer_amount,
    currency: existing.currency,
    purchased_at: new Date().toISOString(),
  });

  if (existing.lecturer_account_number && existing.lecturer_bank_code) {
    runPayoutToLecturer({
      transferRef: `PAY-LEC-${ref}`,
      amountNGN: existing.lecturer_amount,
      lecturerAccountNumber: existing.lecturer_account_number,
      lecturerBankCode: existing.lecturer_bank_code,
      lecturerAccountName: existing.lecturer_account_name || "Lecturer",
      narration: `Payout for: ${existing.material_title}`,
    }).catch((err: unknown) => console.error("Webhook lecturer payout failed:", err));
  }

  runPayoutToPlatform({
    transferRef: `PAY-PLAT-${ref}`,
    amountNGN: existing.platform_fee,
    narration: `Platform fee: ${existing.material_title}`,
  }).catch((err: unknown) => console.error("Webhook platform payout failed:", err));

  return new Response("ok", { status: 200 });
}
