import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

// GET /api/consignment/my
// Requires: Authorization: Bearer <access_token>
// Returns: consignment items owned by the current user (profile_id = auth user id)
export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

    if (!token) return jsonError("Missing Authorization token", 401);

    // ✅ Verify token + get user id
    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);

    if (userErr || !userRes?.user?.id) {
      return jsonError("Invalid token", 401, { error: userErr?.message });
    }

    const userId = userRes.user.id;

    // ✅ Fetch items for this user
    // NOTE: If your schema is slightly different, we’ll adjust after we see the exact error.
    const { data: items, error } = await supabaseServer
      .from("consignment_items")
      .select(
        `
        id,
        profile_id,
        tracking_number,
        title,
        description,
        current_price,
        payout_percent,
        status,
        created_at,
        updated_at,
        consignment_item_photos (
          id,
          photo_url,
          created_at
        )
      `
      )
      .eq("profile_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError("Failed to load consignment items", 500, { error: error.message });
    }

    return NextResponse.json({ success: true, items: items ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/consignment/my error:", err);
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
