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

function getFirstExisting(item: Record<string, any>, keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(item, k)) return item[k];
  }
  return null;
}

async function getProfileIdByEmail(emailRaw: string): Promise<string | null> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email) return null;

  const { data, error } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  return data?.id ? String(data.id) : null;
}

// ✅ Your Next build expects params to be a Promise
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

    const userId = String(userRes.user.id);
    const email = String(userRes.user.email ?? "").trim().toLowerCase();

    // ✅ await params
    const { id } = await context.params;
    const itemId = String(id ?? "").trim();
    if (!itemId) return jsonError("Missing item id", 400);

    // Load item WITHOUT assuming columns exist
    const { data: item, error: itemErr } = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (itemErr) return jsonError(itemErr.message, 500);
    if (!item) return jsonError("Item not found", 404);

    const itemObj = item as Record<string, any>;

    // Build allowed owner values: auth user id + optional profile id (email-based)
    const ownerValues: string[] = [userId];
    const profileId = await getProfileIdByEmail(email);
    if (profileId) ownerValues.push(profileId);

    // Owner column could be any of these (we do NOT reference one directly)
    const ownerFieldCandidates = [
      "profile_id",
      "client_id",
      "user_id",
      "owner_id",
      "customer_id",
      "account_id",
      "created_by",
      "submitted_by",
    ];

    const ownerVal = getFirstExisting(itemObj, ownerFieldCandidates);
    if (ownerVal == null) {
      return jsonError(
        "Cannot verify ownership (no owner column found on item).",
        500,
        { debug: { tried: ownerFieldCandidates } }
      );
    }

    if (!ownerValues.includes(String(ownerVal))) {
      return jsonError("Not allowed: item does not belong to you", 403);
    }

    // Status could also vary
    const statusVal = getFirstExisting(itemObj, ["status", "state", "item_status", "job_status"]);
    if (isPickedUpStatus(statusVal)) {
      return jsonError("Cannot cancel: item is already Picked Up", 409);
    }

    // Delete photos first
    const { error: photosDelError } = await supabaseServer
      .from("consignment_photos")
      .delete()
      .eq("item_id", itemId);

    if (photosDelError) {
      return jsonError(`Failed to delete photos: ${photosDelError.message}`, 500);
    }

    // Delete item
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
