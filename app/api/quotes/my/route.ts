import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use ANON key to validate user JWT (works for auth.getUser(token))
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON);

// Use SERVICE ROLE for DB reads (so RLS won't block server)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function extractBearerToken(req: NextRequest): { token: string | null; raw: string | null } {
  const raw =
    req.headers.get("authorization") ??
    req.headers.get("Authorization") ??
    null;

  if (!raw) return { token: null, raw: null };

  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return { token: null, raw };

  return { token: match[1].trim(), raw };
}

export async function GET(req: NextRequest) {
  try {
    const { token, raw } = extractBearerToken(req);

    if (!token) {
      // Small debug: tells you whether header is missing vs malformed
      return jsonError("Missing or malformed Authorization header", 401, {
        receivedAuthorization: raw ? raw.slice(0, 32) : null,
      });
    }

    // Validate token and get user id
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);

    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, {
        error: userErr?.message ?? "Invalid token",
        tokenStartsWith: token.slice(0, 10), // debug only (safe-ish)
      });
    }

    const userId = userData.user.id;

    const { data: quotes, error: qErr } = await supabaseAdmin
      .from("quotes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (qErr) return jsonError("Failed to load quotes", 500, { error: qErr.message });

    return NextResponse.json({ success: true, quotes: quotes ?? [] });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
