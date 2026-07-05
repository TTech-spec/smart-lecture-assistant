import { createClient } from "@supabase/supabase-js";

// Support both VITE_ and NEXT_PUBLIC_ prefixes for flexibility
const url = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

// Debug logging to check if env vars are loaded
if (typeof window !== "undefined") {
  console.log("Supabase URL:", url ? "SET" : "NOT SET");
  console.log("Supabase Key:", key ? "SET" : "NOT SET");
  console.log("URL value:", url);
}

const configured = Boolean(url && key && !url.includes("your-project-id"));

function makeClient() {
  if (!configured) {
    console.error("Supabase not configured: URL or key missing");
    return null;
  }
  try {
    const client = createClient(url!, key!, { 
      auth: { 
        persistSession: false, 
        autoRefreshToken: false, 
        detectSessionInUrl: false 
      } 
    });
    console.log("Supabase client created successfully");
    return client;
  } catch (err) {
    console.error("Failed to create Supabase client:", err);
    return null;
  }
}

export const supabase = makeClient();
