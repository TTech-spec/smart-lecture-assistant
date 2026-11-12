/**
 * Phone notifications (Web Push) without any extra library.
 * - The VAPID key pair is created on first use and stored in app_keys
 *   (service role only), so nothing needs setting up on Vercel beyond
 *   SUPABASE_SERVICE_ROLE_KEY.
 * - Each push is an empty "wake-up"; the phone's service worker then fetches
 *   the newest notice itself (so no payload encryption is needed).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, requireLecturer } from "./payments-adapters.server";

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

async function getVapidKeys(sb: SupabaseClient): Promise<VapidKeys> {
  const { data } = await sb.from("app_keys").select("value").eq("name", "vapid").maybeSingle();
  if (data?.value) return JSON.parse(data.value) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const keys: VapidKeys = { publicKey, privateJwk };
  // Insert only if nobody else made one at the same moment; then read back the winner
  await sb.from("app_keys").insert({ name: "vapid", value: JSON.stringify(keys) });
  const again = await sb.from("app_keys").select("value").eq("name", "vapid").maybeSingle();
  return again.data?.value ? (JSON.parse(again.data.value) as VapidKeys) : keys;
}

async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Students' phones need the public key to subscribe. */
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async (): Promise<{ ok: true; key: string } | { ok: false }> => {
  try {
    const keys = await getVapidKeys(adminClient());
    return { ok: true, key: keys.publicKey };
  } catch {
    return { ok: false };
  }
});

/** Lecturer: post a notice and wake every subscribed phone. */
export const sendNotice = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    accessToken: z.string().min(10),
    title: z.string().min(2).max(80),
    body: z.string().max(200).default(""),
    url: z.string().max(200).default("/"),
    origin: z.string().url().max(200),
  }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; sent: number; failed: number; removed: number } | { ok: false; message: string }> => {
    let sb: SupabaseClient;
    try { sb = adminClient(); } catch {
      return { ok: false, message: "Notifications need SUPABASE_SERVICE_ROLE_KEY on Vercel. Add it, then redeploy." };
    }
    let lecturerId: string;
    try { lecturerId = await requireLecturer(sb, data.accessToken); } catch {
      return { ok: false, message: "Sign in as a lecturer to send notices." };
    }
    const url = data.url.startsWith("/") ? data.url : "/";
    const ins = await sb.from("notices").insert({ title: data.title, body: data.body, url, created_by: lecturerId });
    if (ins.error) {
      return { ok: false, message: /does not exist|schema cache/i.test(ins.error.message) ? "Notifications aren't switched on yet: run push-notifications.sql in Supabase." : "Couldn't save the notice. Try again." };
    }

    const keys = await getVapidKeys(sb);
    const subject = new URL(data.origin).origin;
    let sent = 0, failed = 0, removed = 0;
    for (let from = 0; ; from += 1000) {
      const { data: subs } = await sb.from("push_subscriptions").select("endpoint").range(from, from + 999);
      if (!subs?.length) break;
      // 25 at a time so a big class doesn't overload the server
      for (let i = 0; i < subs.length; i += 25) {
        await Promise.all(subs.slice(i, i + 25).map(async ({ endpoint }) => {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: await vapidHeader(endpoint, keys, subject), TTL: "86400", Urgency: "high", "Content-Length": "0" },
            });
            if (res.status === 404 || res.status === 410) {
              await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
              removed++;
            } else if (res.ok) {
              sent++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }));
      }
      if (subs.length < 1000) break;
    }
    return { ok: true, sent, failed, removed };
  });
