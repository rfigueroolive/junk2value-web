// src/app/api/consignment/photos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function looksLikeMissingColumn(err: any): boolean {
  const msg = (err?.message || err?.details || err?.hint || "").toString().toLowerCase();
  return msg.includes("could not find the") || msg.includes("schema cache") || msg.includes("does not exist");
}

// Your consignment_items owner column is unknown, so we try a small set quickly.
const OWNER_COLS = ["user_id", "client_id", "profile_id", "owner_id", "created_by"] as const;

/**
 * profiles: email-only (since your profiles table has no user_id)
 */
async function getOrCreateProfileIdByEmail(emailRaw: string): Promise<string> {
  const email = emailRaw.trim().toLowerCase();

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

/**
 * Verify the item belongs to the caller by trying:
 *  - ownerCol in OWNER_COLS
 *  - ownerValue in [authUserId, profileId]
 *
 * Returns which ownerCol/value matched, or null if not owned.
 */
async function assertItemOwned(itemId: string, ownerValues: string[]) {
  const tried: any[] = [];

  for (const ownerCol of OWNER_COLS) {
    for (const ownerValue of ownerValues) {
      const res = await supabaseServer
        .from("consignment_items")
        .select("id")
        .eq("id", itemId)
        .eq(ownerCol, ownerValue)
        .maybeSingle();

      if (!res.error && res.data?.id) {
        return { ok: true as const, match: { ownerCol, ownerValue }, tried };
      }

      tried.push({ ownerCol, ownerValue, err: res.error?.message });

      // If it's NOT a missing column error, return it (could be RLS, bad id column, etc.)
      if (res.error && !looksLikeMissingColumn(res.error)) {
        return { ok: false as const, error: res.error, tried };
      }
    }
  }

  return { ok: false as const, error: null as any, tried };
}

// -------------------------
// GET /api/consignment/photos?item_id=...
// Returns photos for an item (only if owned)
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const authUserId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const itemId = req.nextUrl.searchParams.get("item_id")?.trim();
    if (!itemId) return jsonError("item_id is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, profileId].filter(Boolean);

    const owned = await assertItemOwned(itemId, ownerValues);
    if (!owned.ok) {
      // if we hit a real DB error (not missing-column), show it
      if (owned.error) {
        return jsonError(owned.error.message ?? "Failed ownership check", 500, {
          debug: { tried: owned.tried },
        });
      }
      return jsonError("Not allowed (item does not belong to this user)", 403, {
        debug: { tried: owned.tried },
      });
    }

    const photosRes = await supabaseServer
      .from("consignment_photos")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });

    if (photosRes.error) {
      return jsonError(photosRes.error.message ?? "Failed to load photos", 500);
    }

    return NextResponse.json(
      { success: true, photos: photosRes.data ?? [], debug_match: owned.match },
      { status: 200 }
    );
  } catch (err: any) {
    return jsonError(err?.message ?? "Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}

// -------------------------
// POST /api/consignment/photos
// Body: { item_id, photo_url } OR { item_id, photo_urls: string[] }
// Inserts rows into consignment_photos (item_id, photo_url)
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const authUserId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const body = await req.json();

    const itemId = String(body.item_id ?? "").trim();
    if (!itemId) return jsonError("item_id is required", 400);

    const one = typeof body.photo_url === "string" ? body.photo_url.trim() : "";
    const many = Array.isArray(body.photo_urls) ? body.photo_urls.map((x: any) => String(x).trim()).filter(Boolean) : [];

    const urls = many.length ? many : (one ? [one] : []);
    if (!urls.length) return jsonError("photo_url or photo_urls is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, profileId].filter(Boolean);

    const owned = await assertItemOwned(itemId, ownerValues);
    if (!owned.ok) {
      if (owned.error) {
        return jsonError(owned.error.message ?? "Failed ownership check", 500, {
          debug: { tried: owned.tried },
        });
      }
      return jsonError("Not allowed (item does not belong to this user)", 403, {
        debug: { tried: owned.tried },
      });
    }

    const rows = urls.map((u) => ({ item_id: itemId, photo_url: u }));

    const ins = await supabaseServer
      .from("consignment_photos")
      .insert(rows)
      .select("*");

    if (ins.error) {
      return jsonError(ins.error.message ?? "Failed to insert photos", 500);
    }

    return NextResponse.json(
      { success: true, inserted: ins.data ?? [], debug_match: owned.match },
      { status: 201 }
    );
  } catch (err: any) {
    return jsonError(err?.message ?? "Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}
