import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ── Environment helpers ───────────────────────────────────────────────────────
function getEnv(key: string): string {
  return process.env[key] || process.env[`VITE_${key}`] || "";
}

const IS_PROD = () => (getEnv("SQUAD_ENV") || "sandbox") === "production";

function baseUrl() {
  return IS_PROD()
    ? "https://api-d.squadco.com"
    : "https://sandbox-api-d.squadco.com";
}

function secretKey() {
  const k = getEnv("SQUAD_SECRET_KEY");
  if (!k) throw new Error("SQUAD_SECRET_KEY is not set in environment variables.");
  return k;
}

function platformAccount() {
  return {
    accountNumber: getEnv("SQUAD_PLATFORM_ACCOUNT_NUMBER"),
    bankCode: getEnv("SQUAD_PLATFORM_BANK_CODE") || "058", // GTBank default
  };
}

// ── Shared fetch helper ───────────────────────────────────────────────────────
async function squadFetch(path: string, body: Record<string, unknown>) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Squad API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg =
      (json.message as string) ||
      (json.error as string) ||
      `Squad API error ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

// ── 1. Initiate payment (Squad payment modal / inline checkout) ───────────────
const InitiateSchema = z.object({
  transactionRef:       z.string(),
  /** Total amount student will pay, in NGN (NOT kobo — we convert here) */
  amountNGN:            z.number(),
  email:                z.string().email(),
  customerName:         z.string(),
  customerPhone:        z.string(),
  materialTitle:        z.string(),
  /** Redirect URL after payment */
  callbackUrl:          z.string(),
});

export const initiateSquadPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) => InitiateSchema.parse(d))
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = {
      email:             data.email,
      amount:            Math.round(data.amountNGN * 100), // kobo
      currency:          "NGN",
      initiate_type:     "inline",
      transaction_ref:   data.transactionRef,
      callback_url:      data.callbackUrl,
      pass_charge:       true, // charges passed to customer
      customer_name:     data.customerName,
      payment_channels:  ["card", "bank", "ussd", "bank_transfer"],
      metadata: {
        meta: [{ display_name: "Material", variable_name: "material", value: data.materialTitle }],
      },
    };

    const json = await squadFetch("/transaction/initiate", body);
    // json.data.checkout_url is the payment link
    return json as {
      status: number;
      success: boolean;
      message: string;
      data?: { checkout_url?: string; transaction_ref?: string };
    };
  });

// ── 2. Verify transaction ─────────────────────────────────────────────────────
const VerifySchema = z.object({ transactionRef: z.string() });

export const verifySquadTransaction = createServerFn({ method: "POST" })
  .validator((d: unknown) => VerifySchema.parse(d))
  .handler(async ({ data }) => {
    const url = `${baseUrl()}/transaction/verify/${data.transactionRef}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey()}` },
    });

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Squad verify returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    return json as {
      status: number;
      success: boolean;
      message: string;
      data?: {
        transaction_status?: string;  // "success" | "failed" | "pending"
        transaction_amount?: number;  // in kobo
        transaction_ref?: string;
      };
    };
  });

// ── 3. Payout transfer (after successful payment) ────────────────────────────
const PayoutSchema = z.object({
  /** Unique reference for this transfer */
  transferRef:           z.string(),
  /** Amount in NGN to send to the lecturer */
  amountNGN:             z.number(),
  /** Lecturer's bank account number */
  lecturerAccountNumber: z.string(),
  /** Lecturer's bank code */
  lecturerBankCode:      z.string(),
  /** Lecturer's account name (for narration) */
  lecturerAccountName:   z.string().optional(),
  /** What the payment is for */
  narration:             z.string().optional(),
});

export const payoutToLecturer = createServerFn({ method: "POST" })
  .validator((d: unknown) => PayoutSchema.parse(d))
  .handler(async ({ data }) => {
    // Squad Transfer API: POST /transfer/initiate
    const body: Record<string, unknown> = {
      transaction_reference: data.transferRef,
      amount:                Math.round(data.amountNGN * 100), // kobo
      bank_code:             data.lecturerBankCode,
      account_number:        data.lecturerAccountNumber,
      account_name:          data.lecturerAccountName || "Lecturer",
      currency_id:           "NGN",
      remark:                data.narration || "Lecture material payout — Attendly",
    };

    const json = await squadFetch("/transfer/initiate", body);
    return json as {
      status: number;
      success: boolean;
      message: string;
      data?: { transaction_reference?: string; amount?: number };
    };
  });

// ── 4. Platform payout (₦1,000 → platform account) ───────────────────────────
const PlatformPayoutSchema = z.object({
  transferRef: z.string(),
  amountNGN:   z.number(),
  narration:   z.string().optional(),
});

export const payoutToPlatform = createServerFn({ method: "POST" })
  .validator((d: unknown) => PlatformPayoutSchema.parse(d))
  .handler(async ({ data }) => {
    const { accountNumber, bankCode } = platformAccount();
    if (!accountNumber) {
      // Platform account not configured — skip silently so lecturer payout isn't blocked
      return { status: 200, success: true, message: "Platform account not configured — skipped", data: {} };
    }

    const body: Record<string, unknown> = {
      transaction_reference: data.transferRef,
      amount:                Math.round(data.amountNGN * 100),
      bank_code:             bankCode,
      account_number:        accountNumber,
      account_name:          "Attendly Platform",
      currency_id:           "NGN",
      remark:                data.narration || "Platform fee — Attendly",
    };

    const json = await squadFetch("/transfer/initiate", body);
    return json as {
      status: number;
      success: boolean;
      message: string;
      data?: { transaction_reference?: string };
    };
  });
