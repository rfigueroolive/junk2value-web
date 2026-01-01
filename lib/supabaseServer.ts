// src/lib/supabaseServer.ts
import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY Supabase client (Service Role)
// ✅ Use this for inserts/updates that must bypass RLS (e.g., creating profiles during signup).
// 🚫 Never expose the Service Role key to the client/app.

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY || // optional fallback name
  "";

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE URL env var (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL).");
}

if (!serviceRoleKey) {
  throw new Error("Missing SUPABASE SERVICE ROLE KEY env var (SUPABASE_SERVICE_ROLE_KEY).");
}

export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
