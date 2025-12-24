// lib/supabaseServer.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side Supabase client using the service role key.
// NEVER import this into client-side React components.
export const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey);
