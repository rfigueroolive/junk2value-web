// src/app/api/consignment/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function isPickedUpStatus(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "picked up" || s === "picked_up" || s === "pickedup";
}

// ✅ Next.js in your build expects params to be a Promise
type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization token", 401);

    // Auth user
    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userRes?.user?.id) {
      return jsonError("Invalid or expired token", 401, { error: userErr?.message });
    }

    const userId = userRes.user.id;

    // ✅ await params
    const { id } = await context.params;
    const itemId = String(id ?? "").trim();
    if (!itemId) return jsonError("Missing item id", 400);

    // Load item (your schema uses profile_id = auth user id)
    const { data: item, error: itemErr } = await supabaseServer
      .from("consignment_items")
      .select("id, profile_id, status")
      .eq("id", itemId)
      .maybeSingle();

    if (itemErr) return jsonError(itemErr.message, 500);
    if (!item) return jsonError("Item not found", 404);

    if (String(item.profile_id) !== String(userId)) {
      return jsonError("Not allowed: item does not belong to you", 403);
    }

    if (isPickedUpStatus(item.status)) {
      return jsonError("Cannot cancel: item is already Picked Up", 409);
    }

    // Delete photos first (FK-safe)
    const { error: photosDelError } = await supabaseServer
      .from("consignment_photos")
      .delete()
      .eq("item_id", itemId);

    if (photosDelError) {
      return jsonError(`Failed to delete photos: ${photosDelError.message}`, 500);
    }

    // Delete the item
    const { error: itemDelError } = await supabaseServer
      .from("consignment_items")
      .delete()
      .eq("id", itemId);

    if (itemDelError) {
      return jsonError(`Failed to delete item: ${itemDelError.message}`, 500);
    }

    return NextResponse.json(
      { success: true, message: "Consignment item canceled and deleted.", deleted_item_id: itemId },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError("Server error", 500, { error: msg });
  }
}
