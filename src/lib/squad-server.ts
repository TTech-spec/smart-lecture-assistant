import { z } from "zod";

// ── Environment helpers ───────────────────────────────────────────────────────
function getEnv(key: string): string {
  // Try all common patterns: plain key, VITE_ prefix, and import.meta.env (for SSR builds)
  return (
    process.env[key] ||
    process.env[`VITE_${key}`] ||
    ""
  );
}

export function secretKey() {
  // Never VITE_*: those names can end up in the browser bundle.
  // Clean up common paste mistakes: spaces, quotes, a leading "Bearer ".
  const k = (process.env.SQUAD_SECRET_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!k || k.includes("REPLACE_WITH")) {
    console.warn("Squad secret key not configured. Payment features will be disabled.");
    return "";
  }
  return k;
}

/**
 * Sandbox keys only work on Squad's sandbox API and live keys only on the live
 * API; a mismatch gives "API key is empty or invalid". The key's own prefix
 * decides, and SQUAD_ENV is only used when the prefix doesn't say.
 */
const IS_PROD = () => {
  const k = secretKey();
  if (/^sandbox_/i.test(k)) return false;
  if (/^sk_/i.test(k)) return true;
  return (getEnv("SQUAD_ENV") || "sandbox").trim().toLowerCase() === "production";
};

function baseUrl() {
  return IS_PROD()
    ? "https://api-d.squadco.com"
    : "https://sandbox-api-d.squadco.com";
}

export function platformAccount() {
  return {
    accountNumber: getEnv("SQUAD_PLATFORM_ACCOUNT_NUMBER"),
    bankCode: getEnv("SQUAD_PLATFORM_BANK_CODE") || "000013", // GTBank (NIP code) default
  };
}

// ── Shared fetch helper ───────────────────────────────────────────────────────
export async function squadFetch(path: string, body: Record<string, unknown>) {
  const key = secretKey();
  if (!key) {
    throw new Error("Squad secret key not configured. Please set SQUAD_SECRET_KEY in your .env file.");
  }

  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
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

// ── Verify a transaction (server-only helper) ───────────────────────────────
export async function squadVerify(transactionRef: string): Promise<{ status: string; amountKobo: number }> {
  const key = secretKey();
  if (!key) throw new Error("Squad secret key not configured.");
  const res = await fetch(`${baseUrl()}/transaction/verify/${encodeURIComponent(transactionRef)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  let json: { data?: { transaction_status?: string; transaction_amount?: number } };
  try { json = JSON.parse(text); } catch { throw new Error(`Squad verify returned non-JSON (${res.status})`); }
  return {
    status: String(json.data?.transaction_status ?? "pending"),
    amountKobo: Number(json.data?.transaction_amount ?? 0),
  };
}

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

type PayoutInput = z.infer<typeof PayoutSchema>;

/** Plain (non-RPC) entry point — shared by the client-triggered server fn and the webhook. */
export async function runPayoutToLecturer(data: PayoutInput) {
  try {
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
  } catch (err) {
    console.error("Lecturer payout failed:", err);
    // Return success false but don't throw to avoid blocking the main flow
    return {
      status: 500,
      success: false,
      message: err instanceof Error ? err.message : "Payout failed",
      data: {},
    };
  }
}

// NOTE: there is deliberately no client-callable payout endpoint. A public
// server function that sends money lets anyone on the internet transfer the
// Squad balance to any account. Payouts must only be started by trusted
// server code that has verified the payment and reads the destination
// account from lecturer-only data. Until that exists, withdraw from the
// Squad dashboard.

// ── 4. Platform payout (₦1,000 → platform account) ───────────────────────────
const PlatformPayoutSchema = z.object({
  transferRef: z.string(),
  amountNGN:   z.number(),
  narration:   z.string().optional(),
});

type PlatformPayoutInput = z.infer<typeof PlatformPayoutSchema>;

/** Plain (non-RPC) entry point — shared by the client-triggered server fn and the webhook. */
export async function runPayoutToPlatform(data: PlatformPayoutInput) {
  const { accountNumber, bankCode } = platformAccount();
  if (!accountNumber) {
    // Platform account not configured — skip silently so lecturer payout isn't blocked
    return { status: 200, success: true, message: "Platform account not configured — skipped", data: {} };
  }

  try {
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
      success: boolean,
      message: string,
      data?: { transaction_reference?: string };
    };
  } catch (err) {
    console.error("Platform payout failed:", err);
    // Return success false but don't throw to avoid blocking the main flow
    return {
      status: 500,
      success: false,
      message: err instanceof Error ? err.message : "Platform payout failed",
      data: {},
    };
  }
}


