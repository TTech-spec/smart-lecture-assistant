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
  if (error && /rate|too many|seconds/i.test(error.message)) {
    throw new Error("Too many reset emails. Wait a minute, then try again.");
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

/** Subscribe to sign-in / sign-out changes (Supabase only). */
export function onLecturerAuthChange(cb: (signedIn: boolean) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => {
    if (!session) { cb(false); return; }
    accountIsLecturer().then(cb);
  });
  return () => data.subscription.unsubscribe();
}
