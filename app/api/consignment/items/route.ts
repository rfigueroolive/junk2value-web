import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization token.", 401);

    // Validate token + get user
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Not authorized.", 401, { debug: { message: userErr?.message } });
    }

    const userId = userData.user.id;

    const body = await req.json();
    const item_title = String(body?.item_title ?? "").trim();
    const item_description = String(body?.item_description ?? "").trim() || null;
    const pickup_notes = String(body?.pickup_notes ?? "").trim() || null;

    // item_count optional
    let item_count: number | null = null;
    if (body?.item_count !== undefined && body?.item_count !== null && String(body.item_count).trim() !== "") {
      const n = Number(body.item_count);
      if (!Number.isFinite(n) || n < 0) return jsonError("item_count must be a positive number.", 400);
      item_count = Math.floor(n);
    }

    if (!item_title) return jsonError("Item title is required.", 400);

    const { data, error } = await supabaseServer
      .from("consignment_items")
      .insert({
        user_id: userId,
        item_title,
        item_description,
        item_count,
        pickup_notes,
        status: "pending",
      })
      .select("id, tracking_number, status, created_at")
      .single();

    if (error) {
      return jsonError("Failed to create consignment item.", 500, {
        debug: { code: (error as any).code, message: error.message, details: (error as any).details },
      });
    }

    return NextResponse.json({ success: true, item: data }, { status: 200 });
  } catch (err: any) {
    console.error("POST /api/consignment/items error:", err);
    return NextResponse.json({ success: false, message: "Server error." }, { status: 500 });
  }
}
