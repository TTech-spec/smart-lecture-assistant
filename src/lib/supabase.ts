import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const configured = Boolean(url && key && !url.includes("your-project-id"));

function makeClient() {
  if (!configured) return null;
  try {
    return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  } catch {
    return null;
  }
}

export const supabase = makeClient();
