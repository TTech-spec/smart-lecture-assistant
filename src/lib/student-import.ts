/**
 * Student list import (from a Google Form / Sheet CSV) — runs in the lecturer's browser.
 *  - parseCsv: plain CSV, quoted cells, commas and line breaks inside quotes
 *  - guessColumns: finds each field from the heading wording
 *  - photoToFace: Drive link / file → small face photo + face fingerprint
 */
import { analyseFace, cropFacePhoto, loadFaceApi } from "./face";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type FieldKey = "fullName" | "utme" | "matric" | "department" | "level" | "gender" | "whatsapp" | "hostel" | "nextOfKin" | "nextOfKinPhone" | "photo";

export const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "fullName", label: "Full name", required: true },
  { key: "utme", label: "UTME reg number", required: true },
  { key: "department", label: "Department" },
  { key: "whatsapp", label: "WhatsApp number" },
  { key: "hostel", label: "Hostel address" },
  { key: "nextOfKin", label: "Next of kin" },
  { key: "nextOfKinPhone", label: "Next of kin's number (optional)" },
  { key: "photo", label: "Passport photo (Drive link)" },
  { key: "level", label: "Level (optional)" },
  { key: "gender", label: "Gender (optional)" },
  { key: "matric", label: "Matric number (optional)" },
];

const has = (h: string, ...w: RegExp[]) => w.some((r) => r.test(h));

/** Pick the column for each field from the heading wording (−1 = none). */
export function guessColumns(headers: string[]): Record<FieldKey, number> {
  const h = headers.map((x) => x.toLowerCase().trim());
  const used = new Set<number>();
  const find = (test: (s: string) => boolean) => {
    const i = h.findIndex((s, idx) => !used.has(idx) && test(s));
    if (i >= 0) used.add(i);
    return i;
  };
  // Order matters: the next-of-kin number before next of kin, etc.
  const nokPhone = find((s) => has(s, /kin|\bnok\b/) && has(s, /phone|number|no\b|tel|contact|mobile/));
  const nok = find((s) => has(s, /kin|\bnok\b/));
  const utme = find((s) => has(s, /utme|jamb|reg(istration)?\.?\s*(no|num)/));
  const matric = find((s) => has(s, /matric/));
  const photo = find((s) => has(s, /passport|photo|picture|image|upload/));
  const whatsapp = find((s) => has(s, /whats\s*app|phone|mobile|tel/));
  const hostel = find((s) => has(s, /hostel|address|residen|lodge/));
  const dept = find((s) => has(s, /depart|dept|course of study|programme|program/));
  const level = find((s) => has(s, /^level|\blevel\b/));
  const gender = find((s) => has(s, /gender|\bsex\b/));
  const name = find((s) => has(s, /full\s*name|^name|surname|names/));
  return { fullName: name, utme, matric, department: dept, level, gender, whatsapp, hostel, nextOfKin: nok, nextOfKinPhone: nokPhone, photo };
}

/** Google Drive file id from any Drive link (open?id=, /file/d/<id>/, uc?id=). */
export function driveFileId(link: string): string | null {
  const s = link.trim();
  const m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

export const cleanId = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** Bytes → something we can draw (photos, and the first page of a PDF). */
async function toCanvas(bytes: Uint8Array, contentType: string, name: string): Promise<HTMLCanvasElement> {
  const isPdf = /pdf/i.test(contentType) || /\.pdf$/i.test(name) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  const c = document.createElement("canvas");
  if (isPdf) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1400 / Math.max(vp0.width, vp0.height)) });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
    return c;
  }
  const blob = new Blob([bytes as BlobPart], { type: contentType || "image/jpeg" });
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); }
  catch { throw new Error(/heic|heif/i.test(contentType + name) ? "iphone_heic" : "not_a_photo"); }
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export type FaceResult = { descriptor: number[]; photo: string };

/** A passport file → small face photo + fingerprint. Throws a short reason. */
export async function photoToFace(bytes: Uint8Array, contentType: string, name: string): Promise<FaceResult> {
  await loadFaceApi();
  const c = await toCanvas(bytes, contentType, name);
  const f = await analyseFace(c, { withDescriptor: true });
  if (!f || f.descriptor.length !== 128) throw new Error("no_face");
  return { descriptor: Array.from(f.descriptor), photo: cropFacePhoto(c, f.box) };
}

export const PHOTO_PROBLEM: Record<string, string> = {
  no_link: "No photo link",
  not_shared: "Photo isn't shared (set the Drive folder to Anyone with the link)",
  not_found: "Photo not found in Drive",
  too_big: "Photo file is too big",
  iphone_heic: "iPhone HEIC photo — ask for a JPG",
  not_a_photo: "File isn't a photo or PDF",
  no_face: "No clear face found in the photo",
  not_signed_in: "Sign in again",
  error: "Couldn't download the photo",
};
