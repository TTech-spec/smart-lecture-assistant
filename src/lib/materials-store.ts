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
};

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
