import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// IMPORTANT:
// - Service role key is used to query DB
// - The user's access token is used ONLY to identify the user (auth.getUser(token))
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;

  // Accept: "Bearer <token>" (case-insensitive)
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  return match[1].trim();
}

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return jsonError("Missing Authorization bearer token", 401);

    // Validate token + get the user
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);

    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message ?? "Invalid token" });
    }

    const userId = userData.user.id;

    // Fetch ONLY this user's quotes
    const { data: quotes, error: qErr } = await supabase
      .from("quotes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (qErr) return jsonError("Failed to load quotes", 500, { error: qErr.message });

    // Your Android expects { quotes: [...] }
    return NextResponse.json({ success: true, quotes: quotes ?? [] });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
