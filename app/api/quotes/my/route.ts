import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON);
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

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return jsonError("Missing Authorization bearer token", 401);

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message ?? "Invalid token" });
    }

    // TEMP DEBUG: fetch latest quotes WITHOUT filtering
    const { data: quotes, error: qErr } = await supabaseAdmin
      .from("quotes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);

    if (qErr) return jsonError("Failed to load quotes", 500, { error: qErr.message });

    return NextResponse.json({
      success: true,
      debug_user_id: userData.user.id,
      quotes: quotes ?? [],
    });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
