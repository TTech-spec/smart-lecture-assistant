import { supabase } from "@/lib/supabase";

/**
 * Lecturer authentication.
 *
 * With Supabase configured, lecturers sign in with the email + password of a
 * user created in Supabase → Authentication → Users. The database rules in
 * security-hardening.sql only let signed-in users read records or manage
 * links, so a password checked in the browser would not be enough.
 *
 * Without Supabase (local demo), a local password is used instead.
 */

const LOCAL_AUTH_KEY = "att.admin.auth.v1";
const LOCAL_PASS_KEY = "att.admin.pass.v1";
const LOCAL_DEFAULT_PASS = "lecturer123";

export const usesSupabaseAuth = Boolean(supabase);

/**
 * Whether the signed-in account is on the lecturers list (security-fixes.sql).
 * Databases without that file yet: any signed-in account counts, as before.
 */
async function accountIsLecturer(): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase.rpc("is_lecturer");
  if (error) return /does not exist|schema cache|Could not find/i.test(error.message);
  return data === true;
}

export async function isLecturerSignedIn(): Promise<boolean> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;
    return accountIsLecturer();
  }
  return typeof window !== "undefined" && sessionStorage.getItem(LOCAL_AUTH_KEY) === "1";
}

export async function signInLecturer(email: string, password: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      throw new Error(
        /invalid login/i.test(error.message)
          ? "Wrong email or password."
          : /email not confirmed/i.test(error.message)
            ? "This account's email is not confirmed yet. Confirm it in Supabase → Authentication → Users."
            : error.message,
      );
    }
    if (!(await accountIsLecturer())) {
      await supabase.auth.signOut();
      throw new Error("This account isn't a lecturer account. Ask your administrator to add you.");
    }
    return;
  }
  // Local fallback
  const stored = localStorage.getItem(LOCAL_PASS_KEY) || LOCAL_DEFAULT_PASS;
  if (password !== stored) throw new Error("Wrong password.");
  sessionStorage.setItem(LOCAL_AUTH_KEY, "1");
}

export async function signOutLecturer(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  if (typeof window !== "undefined") sessionStorage.removeItem(LOCAL_AUTH_KEY);
}

/** Change the lecturer password; verifies the current one first. */
export async function changeLecturerPassword(current: string, next: string): Promise<void> {
  if (next.length < 8) throw new Error("Use at least 8 characters.");
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new Error("You are not signed in.");
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) throw new Error("Wrong current password.");
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw new Error(error.message);
    return;
  }
  const stored = localStorage.getItem(LOCAL_PASS_KEY) || LOCAL_DEFAULT_PASS;
  if (current !== stored) throw new Error("Wrong current password.");
  localStorage.setItem(LOCAL_PASS_KEY, next);
}

/**
 * Email a password-reset link. Always reports success, so the form can't be
 * used to find out which emails have lecturer accounts.
 */
export async function sendLecturerPasswordReset(email: string): Promise<void> {
  if (!supabase) throw new Error("Password reset needs the online database.");
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Enter the email you sign in with.");
  const { error } = await supabase.auth.resetPasswordForEmail(clean, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) {
    console.warn("Password reset email:", error.message);
    // Don't reveal whether the email has an account, but do report sending problems
    const status = (error as { status?: number }).status ?? 0;
    if (status >= 500 || status === 429 || error.message.trim() === "{}" || /rate|too many|seconds|429|error sending|smtp|not authori[sz]ed|mail/i.test(error.message)) {
      throw new Error(`${explainEmailError(error.message, status)} ${supabaseDetail(error)}`);
    }
  }
}

/**
 * Open the reset link from the email: works for every link style Supabase
 * sends (#access_token=…, ?code=…, ?token_hash=…). True when the link is valid.
 */
let resetLinkCheck: Promise<boolean> | null = null;
export function openPasswordResetLink(): Promise<boolean> {
  // Read the link once: a second check would find it already cleared
  resetLinkCheck ??= readPasswordResetLink();
  return resetLinkCheck;
}

async function readPasswordResetLink(): Promise<boolean> {
  if (!supabase || typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  try {
    if (hash.get("access_token") && hash.get("refresh_token")) {
      const { error } = await supabase.auth.setSession({
        access_token: hash.get("access_token")!,
        refresh_token: hash.get("refresh_token")!,
      });
      if (error) console.warn("Password reset link:", error.message);
      return !error;
    }
    if (query.get("code")) {
      const { error } = await supabase.auth.exchangeCodeForSession(query.get("code")!);
      return !error;
    }
    if (query.get("token_hash")) {
      const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: query.get("token_hash")! });
      return !error;
    }
  } catch (e) {
    console.warn("Password reset link:", e);
    return false;
  } finally {
    // Don't leave the one-time link in the address bar or history
    window.history.replaceState(null, "", window.location.pathname);
  }
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/** Set the new password after opening the reset link. */
export async function setNewLecturerPassword(next: string): Promise<void> {
  if (!supabase) throw new Error("Password reset needs the online database.");
  if (next.length < 8) throw new Error("Use at least 8 characters.");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    throw new Error(/same|different/i.test(error.message)
      ? "Choose a password you haven't used before."
      : /expired|invalid|session/i.test(error.message)
        ? "This reset link has expired. Ask for a new one."
        : error.message);
  }
}

/** Supabase's own reply, shown in brackets so the exact cause can be checked */
function supabaseDetail(error: unknown): string {
  const e = error as { status?: number; code?: string; name?: string; message?: string };
  const parts = [e.status ? `status ${e.status}` : "", e.code ?? "", e.message && e.message !== "{}" ? e.message : e.name ?? ""].filter(Boolean);
  return parts.length ? `(Supabase: ${parts.join(" · ")})` : "";
}

/** Plain-language reason when Supabase can't send an auth email */
export function explainEmailError(message: string, status?: number): string {
  // Supabase answers a failed email send with a server error and no readable message
  if (!message.trim() || message.trim() === "{}" || (status ?? 0) >= 500) message = "error sending email";
  if (/rate|too many|seconds|429/i.test(message)) return "Too many emails were sent. Wait a few minutes, then try again.";
  if (/not authori[sz]ed|not allowed/i.test(message)) {
    return "Supabase's built-in email only sends to your own team's addresses. Set up your own sender in Supabase → Authentication → Emails → SMTP Settings.";
  }
  if (/error sending|smtp|send(ing)? (the )?(email|mail)|confirmation email|recovery email|mail ?server|535|authentication failed/i.test(message)) {
    return "Supabase couldn't send the email. Check Supabase → Authentication → Emails → SMTP Settings (host smtp.gmail.com, port 465, your Gmail as username, and a Google App password). Or switch custom SMTP off to use Supabase's own sender.";
  }
  if (/invalid|format/i.test(message) && /email/i.test(message)) return "That email address doesn't look right. Check it and try again.";
  return message;
}

/** The email the lecturer signs in with (null when not signed in) */
export async function currentLecturerEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

/**
 * Change the sign-in email. Checks the current password first. Supabase then
 * emails a confirmation link; the change happens once it is opened (and, if
 * "Secure email change" is on in Supabase, after the old address confirms too).
 */
export async function changeLecturerEmail(newEmail: string, password: string): Promise<{ pending: boolean }> {
  if (!supabase) throw new Error("Changing your email needs the online database.");
  const clean = newEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Enter a valid email address.");
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("You are not signed in.");
  if (email.toLowerCase() === clean) throw new Error("That's already your sign-in email.");
  const check = await supabase.auth.signInWithPassword({ email, password });
  if (check.error) throw new Error(/invalid login/i.test(check.error.message) ? "That isn't your current password." : explainEmailError(check.error.message));
  const { data: upd, error } = await supabase.auth.updateUser(
    { email: clean },
    { emailRedirectTo: `${window.location.origin}/admin` },
  );
  if (error) {
    console.warn("Change email:", error.message);
    throw new Error(/already|registered|exists/i.test(error.message)
      ? "Another account already uses that email."
      : `${explainEmailError(error.message, (error as { status?: number }).status)} ${supabaseDetail(error)}`);
  }
  return { pending: (upd.user?.email ?? "").toLowerCase() !== clean };
}

/** Sign in with the 6-digit code from the reset email (when the email template includes the code) */
export async function verifyPasswordResetCode(email: string, code: string): Promise<void> {
  if (!supabase) throw new Error("Password reset needs the online database.");
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6,10}$/.test(token)) throw new Error("Enter the code from the email.");
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "recovery" });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Ask for a new one." : error.message);
}

/** Subscribe to sign-in / sign-out changes (Supabase only). */
export function onLecturerAuthChange(cb: (signedIn: boolean) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => {
    if (!session) { cb(false); return; }
    accountIsLecturer().then(cb);
  });
  return () => data.subscription.unsubscribe();
}
