/**
 * Lecturer account changes done on the server with the service role key, so
 * Supabase never has to send a confirmation email.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { adminClient, requireLecturer } from "./payments-adapters.server";

type Result = { ok: true; email: string } | { ok: false; reason: "not_configured" | "not_signed_in" | "wrong_password" | "email_taken" | "same_email" | "error"; message: string };

export const changeEmailNow = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    accessToken: z.string().min(10),
    password: z.string().min(1).max(200),
    newEmail: z.string().email().max(200),
  }).parse(d))
  .handler(async ({ data }): Promise<Result> => {
    let admin;
    try { admin = adminClient(); } catch {
      return { ok: false, reason: "not_configured", message: "not_configured" };
    }
    let userId: string;
    try { userId = await requireLecturer(admin, data.accessToken); } catch {
      return { ok: false, reason: "not_signed_in", message: "Sign in again, then try changing your email." };
    }
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const current = u.user?.email ?? "";
    const next = data.newEmail.trim().toLowerCase();
    if (!current) return { ok: false, reason: "not_signed_in", message: "Sign in again, then try changing your email." };
    if (current.toLowerCase() === next) return { ok: false, reason: "same_email", message: "That's already your sign-in email." };

    // The server checks the current password itself (a stolen session alone can't change the email)
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const checker = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false, autoRefreshToken: false } });
    const check = await checker.auth.signInWithPassword({ email: current, password: data.password });
    if (check.error) return { ok: false, reason: "wrong_password", message: "That isn't your current password." };
    await checker.auth.signOut().catch(() => {});

    const { error } = await admin.auth.admin.updateUserById(userId, { email: next, email_confirm: true });
    if (error) {
      return /already|registered|exists|unique/i.test(error.message)
        ? { ok: false, reason: "email_taken", message: "Another account already uses that email." }
        : { ok: false, reason: "error", message: "Couldn't change your email. Try again in a minute." };
    }
    return { ok: true, email: next };
  });
