import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_TYPE = "pickup_sell_terms";
const VERSION = "v1";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

// GET /api/legal/pickup-sell/status
// Returns: { success: true, accepted: boolean, doc_type, version }
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token", 401);

    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userRes?.user?.id) return jsonError("Invalid/expired session token", 401);

    // Your project uses: profile_id = auth user id
    const profileId = userRes.user.id;

    const { data, error } = await supabaseServer
      .from("legal_acceptances")
      .select("id")
      .eq("profile_id", profileId)
      .eq("doc_type", DOC_TYPE)
      .eq("version", VERSION)
      .maybeSingle();

    if (error) return jsonError("Failed to check acceptance", 500, { error: error.message });

    return NextResponse.json(
      {
        success: true,
        accepted: !!data?.id,
        doc_type: DOC_TYPE,
        version: VERSION,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/legal/pickup-sell/status error:", err);
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
