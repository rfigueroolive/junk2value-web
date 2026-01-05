import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Validate user JWT
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON);

// Query DB with service role
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function extractBearerToken(req: NextRequest): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isMissingColumnError(msg?: string | null) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("does not exist") || m.includes("column") && m.includes("not");
}

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return jsonError("Missing Authorization bearer token", 401);

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message ?? "Invalid token" });
    }

    const userId = userData.user.id;

    // Try likely owner columns WITHOUT schema introspection (PostgREST can't read information_schema).
    const candidates = ["profile_id", "customer_id", "created_by", "owner_id", "user_uuid"];

    let lastErr: any = null;

    for (const col of candidates) {
      const { data: quotes, error: qErr } = await supabaseAdmin
        .from("quotes")
        .select("*")
        .eq(col, userId)
        .order("created_at", { ascending: false });

      if (!qErr) {
        return NextResponse.json({
          success: true,
          owner_column_used: col, // debug: tells us which one worked
          quotes: quotes ?? [],
        });
      }

      lastErr = qErr;

      // If the column doesn't exist, try the next candidate
      if (isMissingColumnError(qErr.message)) continue;

      // If it's some other error (RLS, permissions, etc.), stop and show it
      return jsonError("Failed to load quotes", 500, { error: qErr.message });
    }

    return jsonError("Failed to load quotes", 500, {
      error: lastErr?.message ?? "No matching owner column found",
      tried: candidates,
    });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
