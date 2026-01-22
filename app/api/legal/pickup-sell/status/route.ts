// src/app/api/legal/pickup-sell/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// keep consistent with your accept route
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
// Auth: Authorization: Bearer <access_token>
// Returns: { success: true, accepted: boolean, doc_type, version, accepted_at? }
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token", 401);

    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userRes?.user?.id) return jsonError("Invalid/expired session token", 401);

    const profileId = userRes.user.id; // ✅ your project uses: profile_id = auth user id

    const { data, error } = await supabaseServer
      .from("legal_acceptances")
      .select("id, accepted_at")
      .eq("profile_id", profileId)
      .eq("doc_type", DOC_TYPE)
      .eq("version", VERSION)
      .maybeSingle();

    if (error) {
      return jsonError("Failed checking legal acceptance status", 500, { error: error.message });
    }

    return NextResponse.json(
      {
        success: true,
        accepted: !!data?.id,
        doc_type: DOC_TYPE,
        version: VERSION,
        accepted_at: data?.accepted_at ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/legal/pickup-sell/status error:", err);
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
