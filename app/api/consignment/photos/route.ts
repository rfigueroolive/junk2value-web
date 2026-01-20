// src/app/api/consignment/photos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// -------------------------
// Helpers
// -------------------------
function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;

  return token?.trim() || null;
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

async function getOrCreateProfileIdByEmail(email: string): Promise<string> {
  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) throw profileErr;
  if (profile?.id) return profile.id;

  const { data: created, error: createErr } = await supabaseServer
    .from("profiles")
    .insert([{ email }])
    .select("id")
    .single();

  if (createErr) throw createErr;
  return created.id as string;
}

/**
 * Confirm the consignment item belongs to this user before allowing photo insert.
 * We support either client_id or profile_id schemas.
 */
async function assertItemOwnershipOrThrow(itemId: string, profileId: string) {
  // Attempt 1: client_id
  const a = await supabaseServer
    .from("consignment_items")
    .select("id")
    .eq("id", itemId)
    .eq("client_id", profileId)
    .maybeSingle();

  if (!a.error && a.data?.id) return;

  // Attempt 2: profile_id
  const b = await supabaseServer
    .from("consignment_items")
    .select("id")
    .eq("id", itemId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!b.error && b.data?.id) return;

  // If the lookups themselves failed due to schema mismatch, we still treat as not-owned
  throw new Error("NOT_OWNED_OR_NOT_FOUND");
}

// -------------------------
// GET /api/consignment/photos?item_id=...
// Returns photos for a given item (must belong to user)
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);

    const { searchParams } = new URL(req.url);
    const itemId = (searchParams.get("item_id") ?? "").trim();
    if (!itemId) return jsonError("item_id is required", 400);

    // Ownership check
    await assertItemOwnershipOrThrow(itemId, profileId);

    const { data, error } = await supabaseServer
      .from("consignment_photos")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET consignment_photos error:", error);
      return jsonError("Failed to load photos", 500, { debug: { error: error.message } });
    }

    return NextResponse.json({ success: true, photos: data ?? [] }, { status: 200 });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg === "NOT_OWNED_OR_NOT_FOUND") {
      return jsonError("Item not found or not owned by this user", 404);
    }
    console.error("Unexpected error in GET /api/consignment/photos:", err);
    return jsonError("Server error", 500, { debug: { message: msg } });
  }
}

// -------------------------
// POST /api/consignment/photos
// Body:
// {
//   item_id: "uuid",
//   photo_url: "https://..."
// }
// OR
// {
//   item_id: "uuid",
//   photo_urls: ["https://...", "https://..."]
// }
//
// NOTE: This route stores URLs only.
// Uploading binaries to storage comes next.
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);

    const body = await req.json().catch(() => null);
    const itemId = (body?.item_id ?? "").toString().trim();

    if (!itemId) return jsonError("item_id is required", 400);

    // Ownership check (very important)
    await assertItemOwnershipOrThrow(itemId, profileId);

    const singleUrl = (body?.photo_url ?? "").toString().trim();
    const list = Array.isArray(body?.photo_urls) ? body.photo_urls : null;

    const urls: string[] = [];
    if (singleUrl) urls.push(singleUrl);
    if (list && list.length) {
      for (const u of list) {
        const s = (u ?? "").toString().trim();
        if (s) urls.push(s);
      }
    }

    if (urls.length === 0) return jsonError("photo_url or photo_urls is required", 400);

    const rows = urls.map((u) => ({
      item_id: itemId,
      photo_url: u,
    }));

    const { data, error } = await supabaseServer
      .from("consignment_photos")
      .insert(rows)
      .select();

    if (error) {
      console.error("POST consignment_photos error:", error);
      return jsonError("Failed to save photos", 500, { debug: { error: error.message } });
    }

    return NextResponse.json(
      { success: true, message: "Photos saved.", photos: data ?? [] },
      { status: 201 }
    );
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg === "NOT_OWNED_OR_NOT_FOUND") {
      return jsonError("Item not found or not owned by this user", 404);
    }
    console.error("Unexpected error in POST /api/consignment/photos:", err);
    return jsonError("Server error", 500, { debug: { message: msg } });
  }
}
