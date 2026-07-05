import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";

const PaymentRequestSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  orderId: z.string(),
  materialId: z.string(),
  materialTitle: z.string(),
  customerEmail: z.string(),
  customerName: z.string(),
  customerPhone: z.string(),
  payMethod: z.enum(["BankCard", "BankTransfer", "OpayWalletNg", "OpayWalletNgQR", "BankUssd"]).optional(),
});

const StatusCheckSchema = z.object({
  orderId: z.string(),
});

// Server-side OPay cashier payment creation (avoids CORS)
export const createOPayPaymentServer = createServerFn({ method: "POST" })
  .validator((input: unknown) => PaymentRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const OPAY_MERCHANT_ID = process.env.VITE_OPAY_MERCHANT_ID || process.env.OPAY_MERCHANT_ID;
    const OPAY_PUBLIC_KEY = process.env.VITE_OPAY_PUBLIC_KEY || process.env.OPAY_PUBLIC_KEY;
    const OPAY_SECRET_KEY = process.env.VITE_OPAY_SECRET_KEY || process.env.OPAY_SECRET_KEY;
    const OPAY_COUNTRY = process.env.VITE_OPAY_COUNTRY || process.env.OPAY_COUNTRY || "NG";
    const IS_PRODUCTION = (process.env.VITE_OPAY_ENV || process.env.OPAY_ENV || "staging") === "production";
    const OPAY_BASE_URL = IS_PRODUCTION
      ? "https://liveapi.opaycheckout.com"
      : "https://testapi.opaycheckout.com";
    const OPAY_CALLBACK_URL = process.env.VITE_OPAY_CALLBACK_URL || process.env.OPAY_CALLBACK_URL || "";
    const OPAY_RETURN_URL = process.env.VITE_OPAY_RETURN_URL || process.env.OPAY_RETURN_URL || "";

    if (!OPAY_MERCHANT_ID || !OPAY_PUBLIC_KEY) {
      throw new Error("OPay credentials not configured. Please set VITE_OPAY_MERCHANT_ID and VITE_OPAY_PUBLIC_KEY in your .env file.");
    }

    // OPay Cashier API request body
    const orderData: Record<string, unknown> = {
      reference: data.orderId,
      country: OPAY_COUNTRY,
      amount: {
        total: Math.round(data.amount * 100),
        currency: data.currency,
      },
      returnUrl: OPAY_RETURN_URL,
      userInfo: {
        userId: data.customerEmail,
        userName: data.customerName,
        userMobile: data.customerPhone,
        userEmail: data.customerEmail,
      },
      product: {
        name: data.materialTitle,
        description: `Payment for study material: ${data.materialTitle}`,
      },
      // payMethod is optional — omitting it lets OPay show all methods your account supports.
      // Only send it if explicitly set, to avoid "payMethod not supported" errors.
    };

    // Only include callbackUrl if provided — OPay requires either this or a webhook on the dashboard
    if (OPAY_CALLBACK_URL) {
      orderData.callbackUrl = OPAY_CALLBACK_URL;
    }

    const response = await fetch(`${OPAY_BASE_URL}/api/v1/international/cashier/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Cashier Create uses the raw Public Key — no HMAC
        "Authorization": `Bearer ${OPAY_PUBLIC_KEY}`,
        "MerchantId": OPAY_MERCHANT_ID,
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OPay API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Normalise the cashierUrl field name so the frontend always sees `cashierUrl`
    if (result.data?.cashierUrl) {
      result.data.cashUrl = result.data.cashierUrl;
    }

    return result;
  });

// Server-side OPay cashier status check
export const checkPaymentStatusServer = createServerFn({ method: "POST" })
  .validator((input: unknown) => StatusCheckSchema.parse(input))
  .handler(async ({ data }) => {
    const OPAY_MERCHANT_ID = process.env.VITE_OPAY_MERCHANT_ID || process.env.OPAY_MERCHANT_ID;
    const OPAY_SECRET_KEY = process.env.VITE_OPAY_SECRET_KEY || process.env.OPAY_SECRET_KEY;
    const OPAY_COUNTRY = process.env.VITE_OPAY_COUNTRY || process.env.OPAY_COUNTRY || "NG";
    const IS_PRODUCTION = (process.env.VITE_OPAY_ENV || process.env.OPAY_ENV || "staging") === "production";
    const OPAY_BASE_URL = IS_PRODUCTION
      ? "https://liveapi.opaycheckout.com"
      : "https://testapi.opaycheckout.com";

    if (!OPAY_MERCHANT_ID || !OPAY_SECRET_KEY) {
      throw new Error("OPay credentials not configured");
    }

    // Status query uses HMAC-SHA512 signature with the Private/Secret Key
    const requestData = {
      reference: data.orderId,
      country: OPAY_COUNTRY,
    };

    const signature = generateSignature(requestData, OPAY_SECRET_KEY);

    const response = await fetch(`${OPAY_BASE_URL}/api/v1/international/cashier/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${signature}`,
        "MerchantId": OPAY_MERCHANT_ID,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OPay API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  });

// Recursively sort all object keys alphabetically (OPay requirement)
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as object)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = deepSortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

// HMAC-SHA512 signature generation (server-side, synchronous)
// OPay requires: deep-sort all keys alphabetically, then sign the JSON string
function generateSignature(data: Record<string, unknown>, secretKey: string): string {
  const sorted = deepSortKeys(data);
  const jsonString = JSON.stringify(sorted);
  return crypto.createHmac("sha512", secretKey).update(jsonString).digest("hex");
}
