import { supabase } from "./supabase";

// OPay Configuration
const OPAY_MERCHANT_ID = import.meta.env.VITE_OPAY_MERCHANT_ID as string | undefined;
const OPAY_SECRET_KEY = import.meta.env.VITE_OPAY_SECRET_KEY as string | undefined;
const OPAY_BASE_URL = import.meta.env.VITE_OPAY_BASE_URL || "https://api.opaycheckout.com";
const OPAY_CALLBACK_URL = import.meta.env.VITE_OPAY_CALLBACK_URL || "";

// Use a CORS proxy if available to avoid browser CORS restrictions
const CORS_PROXY = import.meta.env.VITE_CORS_PROXY || "";

export type OPayPaymentMethod = "BankCard" | "BankTransfer" | "OpayWalletNg" | "OpayWalletNgQR" | "BankUssd";

export type OPayPaymentStatus = "pending" | "successful" | "failed" | "cancelled";

export type OPayPaymentRequest = {
  amount: number;
  currency: string;
  orderId: string;
  materialId: string;
  materialTitle: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  payMethod?: OPayPaymentMethod;
};

export type OPayPaymentResponse = {
  code: number;
  message: string;
  data?: {
    cashUrl?: string;
    reference: string;
    orderNo: string;
  };
};

export type PaymentRecord = {
  id: string;
  orderId: string;
  materialId: string;
  materialTitle: string;
  amount: number;
  currency: string;
  status: OPayPaymentStatus;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  payMethod: OPayPaymentMethod | string;
  transactionId?: string;
  reference?: string;
  createdAt: string;
  updatedAt: string;
};

// Generate HMAC-SHA512 signature for OPay API
async function generateSignature(data: any, secretKey: string): Promise<string> {
  const crypto = window.crypto || (window as any).msCrypto;
  if (!crypto) throw new Error("Web Crypto API not supported");

  // Sort keys alphabetically
  const sortedKeys = Object.keys(data).sort();
  const sortedData: any = {};
  sortedKeys.forEach((key) => {
    sortedData[key] = data[key];
  });

  const jsonString = JSON.stringify(sortedData);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(jsonString);

  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Create payment order with OPay
export async function createOPayPayment(request: OPayPaymentRequest): Promise<OPayPaymentResponse> {
  if (!OPAY_MERCHANT_ID || !OPAY_SECRET_KEY) {
    throw new Error("OPay credentials not configured. Please add VITE_OPAY_MERCHANT_ID and VITE_OPAY_SECRET_KEY to your .env file.");
  }

  const orderData = {
    amount: {
      total: request.amount * 100, // Convert to kobo (100 kobo = 1 NGN)
      currency: request.currency,
    },
    product: {
      name: request.materialTitle,
      description: `Payment for study material: ${request.materialTitle}`,
    },
    customer: {
      name: request.customerName,
      email: request.customerEmail,
      phone: request.customerPhone,
    },
    reference: request.orderId,
    callbackUrl: OPAY_CALLBACK_URL || `${window.location.origin}/api/payment/callback`,
    payMethod: request.payMethod || "BankCard",
    country: "NG",
  };

  try {
    const signature = await generateSignature(orderData, OPAY_SECRET_KEY);

    // Use CORS proxy if configured, otherwise direct call
    const apiUrl = CORS_PROXY ? `${CORS_PROXY}${OPAY_BASE_URL}/api/v1/payment/order/create` : `${OPAY_BASE_URL}/api/v1/payment/order/create`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPAY_MERCHANT_ID}`,
        "Signature": signature,
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OPay API error:", response.status, errorText);
      throw new Error(`OPay API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("OPay payment creation error:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to create payment");
  }
}

// Check payment status
export async function checkPaymentStatus(orderId: string): Promise<OPayPaymentResponse> {
  if (!OPAY_MERCHANT_ID || !OPAY_SECRET_KEY) {
    throw new Error("OPay credentials not configured");
  }

  const data = {
    reference: orderId,
  };

  try {
    const signature = await generateSignature(data, OPAY_SECRET_KEY);

    // Use CORS proxy if configured, otherwise direct call
    const apiUrl = CORS_PROXY ? `${CORS_PROXY}${OPAY_BASE_URL}/api/v1/payment/order/query` : `${OPAY_BASE_URL}/api/v1/payment/order/query`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPAY_MERCHANT_ID}`,
        "Signature": signature,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OPay status check error:", response.status, errorText);
      throw new Error(`OPay status check error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("OPay status check error:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to check payment status");
  }
}

// Save payment record to database
export async function savePaymentRecord(record: PaymentRecord): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("payment_records").upsert({
      id: record.id,
      order_id: record.orderId,
      material_id: record.materialId,
      material_title: record.materialTitle,
      amount: record.amount,
      currency: record.currency,
      status: record.status,
      customer_email: record.customerEmail,
      customer_name: record.customerName,
      customer_phone: record.customerPhone,
      pay_method: record.payMethod,
      transaction_id: record.transactionId,
      reference: record.reference,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error) throw new Error(error.message);
  }

  // Also save to localStorage as backup
  const payments = loadPaymentRecords();
  payments.push(record);
  localStorage.setItem("att.payments.v1", JSON.stringify(payments));
}

// Load payment records from localStorage
export function loadPaymentRecords(): PaymentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("att.payments.v1") || "[]") as PaymentRecord[];
  } catch {
    return [];
  }
}

// Check if user has paid for a material
export function hasUserPaidForMaterial(materialId: string, email: string): boolean {
  const payments = loadPaymentRecords();
  return payments.some(
    (p) => p.materialId === materialId && p.customerEmail === email && p.status === "successful"
  );
}

// Generate unique order ID
export function generateOrderId(): string {
  return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
