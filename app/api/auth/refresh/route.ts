import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * POST /api/auth/refresh
 * Body: { refresh_token: string }
 *
 * Returns a fresh session:
 *  - access_token
 *  - refresh_token
 *  - expires_at (unix seconds)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const refresh_token = (body?.refresh_token ?? "").toString().trim();

    if (!refresh_token) {
      return NextResponse.json(
        { success: false, error: "Missing refresh_token" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseServer.auth.refreshSession({
      refresh_token,
    });

    if (error || !data?.session) {
      return NextResponse.json(
        { success: false, error: error?.message ?? "Refresh failed" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("POST /api/auth/refresh error:", e);
    return NextResponse.json(
      { success: false, error: "Server error" },
      { status: 500 }
    );
  }
}
