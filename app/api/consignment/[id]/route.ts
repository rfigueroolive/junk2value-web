import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function getOrCreateProfileIdByEmail(emailRaw: string): Promise<string> {
  const email = (emailRaw ?? "").trim().toLowerCase();

  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) throw profileErr;
  if (profile?.id) return profile.id as string;

  const { data: created, error: createErr } = await supabaseServer
    .from("profiles")
    .insert([{ email }])
    .select("id")
    .single();

  if (!createErr && created?.id) return created.id as string;

  // concurrent insert fallback
  const { data: again, error: againErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (againErr) throw againErr;
  if (again?.id) return again.id as string;

  throw createErr ?? new Error("Failed to create profile");
}

function isPickedUpStatus(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "picked up" || s === "picked_up" || s === "pickedup";
}

// (Not required for mobile, but harmless and helps some platforms)
export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization token", 401);

    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userRes?.user) return jsonError("Invalid or expired token", 401);

    const authUserId = String(userRes.user.id);
    const email = (userRes.user.email ?? "").trim().toLowerCase();
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, String(profileId)].filter(Boolean);

    const itemId = String(ctx?.params?.id ?? "").trim();
    if (!itemId) return jsonError("Missing item id", 400);

    // Fetch item
    const itemRes = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (itemRes.error) return jsonError(itemRes.error.message, 500);
    if (!itemRes.data) return jsonError("Item not found", 404);

    const item = itemRes.data as Record<string, any>;

    // Ownership check (schema-flexible)
    const ownerFieldCandidates = [
      "user_id",
      "owner_id",
      "created_by",
      "submitted_by",
      "account_id",
      "customer_id",
      "client_id",
      "profile_id",
    ];

    val@ run {
      for (f in ownerFieldCandidates) {
        if (Object.prototype.hasOwnProperty.call(item, f) && item[f] != null) {
          if (ownerValues.includes(String(item[f]))) return@val
        }
      }
      return jsonError("Not allowed: item does not belong to you", 403)
    }

    // Block if Picked Up (company locks it)
    const statusFieldCandidates = ["status", "state", "item_status", "job_status"];
    var statusVal: unknown = null;
    for (f in statusFieldCandidates) {
      if (Object.prototype.hasOwnProperty.call(item, f)) {
        statusVal = item[f];
        break;
      }
    }

    if (isPickedUpStatus(statusVal)) {
      return jsonError("Cannot cancel: item is already Picked Up", 409);
    }

    // Delete photos first (FK-safe)
    const photosDel = await supabaseServer
      .from("consignment_photos")
      .delete()
      .eq("item_id", itemId);

    if (photosDel.error) {
      return jsonError(`Failed to delete photos: ${photosDel.error.message}`, 500);
    }

    // Delete item
    const itemDel = await supabaseServer
      .from("consignment_items")
      .delete()
      .eq("id", itemId);

    if (itemDel.error) {
      return jsonError(`Failed to delete item: ${itemDel.error.message}`, 500);
    }

    return NextResponse.json(
      { success: true, message: "Consignment item canceled and deleted.", deleted_item_id: itemId },
      { status: 200 }
    );
  } catch (err: any) {
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
