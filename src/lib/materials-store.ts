import { supabase } from "./supabase";

export type MaterialFileType = "pdf" | "video" | "doc" | "ppt" | "link";
export type MaterialAccessType = "free" | "paid";

export type Material = {
  id: string;
  title: string;
  description: string;
  fileType: MaterialFileType;
  accessType: MaterialAccessType;
  price: number;
  currency: string;
  url: string;
  courseCode: string;
  topic: string;
  uploadedAt: string;
  // Lecturer payout details (required for paid materials)
  lecturerAccountNumber?: string;
  lecturerBankCode?: string;
  lecturerAccountName?: string;
};

export type MaterialPurchase = {
  id: string;
  materialId: string;
  studentName: string;
  matricNumber: string;
  purchaseAmount: number;
  currency: string;
  purchasedAt: string;
};

const PURCHASE_KEY = "att.material.purchases.v1";

const MAT_KEY = "att.materials.v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function materialToDb(m: Material): Row {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    file_type: m.fileType,
    access_type: m.accessType,
    price: m.price,
    currency: m.currency,
    url: m.url,
    course_code: m.courseCode,
    topic: m.topic,
    uploaded_at: m.uploadedAt,
    lecturer_account_number: m.lecturerAccountNumber || null,
    lecturer_bank_code: m.lecturerBankCode || null,
    lecturer_account_name: m.lecturerAccountName || null,
  };
}

function materialFromDb(row: Row): Material {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    fileType: (row.file_type as MaterialFileType) || "link",
    accessType: (row.access_type as MaterialAccessType) || "free",
    price: row.price || 0,
    currency: row.currency || "NGN",
    url: row.url,
    courseCode: row.course_code || "",
    topic: row.topic || "",
    uploadedAt: row.uploaded_at,
    lecturerAccountNumber: row.lecturer_account_number || undefined,
    lecturerBankCode: row.lecturer_bank_code || undefined,
    lecturerAccountName: row.lecturer_account_name || undefined,
  };
}

export function loadMaterials(): Material[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(MAT_KEY) || "[]") as Material[];
  } catch {
    return [];
  }
}

export function saveMaterials(materials: Material[]) {
  localStorage.setItem(MAT_KEY, JSON.stringify(materials));
  window.dispatchEvent(new Event("att:materials"));
}

export async function addMaterial(m: Material): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("materials").upsert(materialToDb(m));
    if (error) throw new Error(error.message);
  }
  const all = loadMaterials();
  all.push(m);
  saveMaterials(all);
}

export function deleteMaterial(id: string) {
  saveMaterials(loadMaterials().filter((m) => m.id !== id));
  if (supabase) {
    Promise.resolve(supabase.from("materials").delete().eq("id", id)).catch(() => {});
  }
}

export async function syncMaterialsFromSupabase(): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.from("materials").select("*");
    if (data && data.length > 0) {
      localStorage.setItem(MAT_KEY, JSON.stringify(data.map(materialFromDb)));
      window.dispatchEvent(new Event("att:materials"));
    }
  } catch {
    // silently fail — local data remains
  }
}

// ── Material Purchases ──────────────────────────────────────────────────────────
export function loadPurchases(): MaterialPurchase[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(PURCHASE_KEY);
    if (!data) return [];
    return JSON.parse(data) as MaterialPurchase[];
  } catch (error) {
    console.error("Failed to load purchases:", error);
    return [];
  }
}

export function savePurchases(purchases: MaterialPurchase[]) {
  localStorage.setItem(PURCHASE_KEY, JSON.stringify(purchases));
  window.dispatchEvent(new Event("att:purchases"));
}

export async function addPurchase(purchase: MaterialPurchase): Promise<void> {
  if (supabase) {
    try {
      const { error } = await supabase.from("material_purchases").upsert({
        id: purchase.id,
        material_id: purchase.materialId,
        student_name: purchase.studentName,
        matric_number: purchase.matricNumber,
        purchase_amount: purchase.purchaseAmount,
        currency: purchase.currency,
        purchased_at: purchase.purchasedAt,
      });
      if (error) {
        console.error("Supabase purchase sync error:", error);
        // Continue with local storage even if Supabase fails
      }
    } catch (err) {
      console.error("Supabase purchase sync error:", err);
      // Continue with local storage even if Supabase fails
    }
  }
  const all = loadPurchases();
  all.push(purchase);
  savePurchases(all);
}

export function calculateTotalEarnings(): { amount: number; currency: string; salesCount: number } {
  try {
    const purchases = loadPurchases();
    const totalAmount = purchases.reduce((sum, p) => sum + (p.purchaseAmount || 0), 0);
    const currency = purchases.length > 0 ? purchases[0].currency : "NGN";
    return {
      amount: totalAmount,
      currency,
      salesCount: purchases.length,
    };
  } catch (error) {
    console.error("Failed to calculate earnings:", error);
    return {
      amount: 0,
      currency: "NGN",
      salesCount: 0,
    };
  }
}

// ── Supabase Storage file upload ──────────────────────────────────────────────
export async function uploadMaterialFile(file: File, id: string): Promise<string> {
  if (!supabase) throw new Error("Supabase not configured. Paste a URL instead of uploading a file.");

  const ext = file.name.split(".").pop() || "bin";
  const path = `${id}.${ext}`;

  const { error } = await supabase.storage
    .from("materials")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("materials").getPublicUrl(path);
  return data.publicUrl;
}
