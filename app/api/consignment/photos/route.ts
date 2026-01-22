// app/api/consignment/photos/route.ts
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

/**
 * profiles: email-only
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
 * Ownership check WITHOUT querying unknown columns:
 * 1) Fetch item row by id
 * 2) Inspect fields on the row and compare to allowed owner values
 */
async function assertItemOwnedByFetch(itemId: string, ownerValues: string[]) {
  // Fetch item row
  const itemRes = await supabaseServer
    .from("consignment_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (itemRes.error) return { ok: false as const, code: 500 as const, message: itemRes.error.message };
  if (!itemRes.data) return { ok: false as const, code: 404 as const, message: "Item not found" };

  const item: Record<string, unknown> = itemRes.data as any;

  // Possible owner fields that might exist on your table
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

  // Find the first candidate field that exists on the row
  let matchedField: string | null = null;
  let matchedValue: string | null = null;

  for (const field of ownerFieldCandidates) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      const v = item[field];
      if (v !== null && v !== undefined) {
        const sv = String(v);
        // If it matches ANY of our allowed owner values, we're good
        if (ownerValues.includes(sv)) {
          matchedField = field;
          matchedValue = sv;
          break;
        }
      }
    }
  }

  if (!matchedField) {
    // No owner field matched our user -> not owned
    return {
      ok: false as const,
      code: 403 as const,
      message: "Not allowed (item does not belong to this user)",
      debug: {
        availableKeys: Object.keys(item).sort(),
        ownerValuesTried: ownerValues,
      },
    };
  }

  return {
    ok: true as const,
    item,
    match: { ownerField: matchedField, ownerValue: matchedValue },
  };
}

// -------------------------
// GET /api/consignment/photos?item_id=...
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

    const owned = await assertItemOwnedByFetch(itemId, ownerValues);
    if (!owned.ok) {
      return jsonError(owned.message, owned.code, (owned as any).debug ? { debug: (owned as any).debug } : undefined);
    }

    const photosRes = await supabaseServer
      .from("consignment_photos")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });

    if (photosRes.error) return jsonError(photosRes.error.message ?? "Failed to load photos", 500);

    return NextResponse.json(
      { success: true, photos: photosRes.data ?? [], debug_match: (owned as any).match },
      { status: 200 }
    );
  } catch (err: any) {
    return jsonError(err?.message ?? "Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}

// -------------------------
// POST /api/consignment/photos
// Body: { item_id, photo_url } OR { item_id, photo_urls: string[] }
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

    const body: any = await req.json();

    const itemId = String(body.item_id ?? "").trim();
    if (!itemId) return jsonError("item_id is required", 400);

    const one = typeof body.photo_url === "string" ? body.photo_url.trim() : "";
    const many: string[] = Array.isArray(body.photo_urls)
      ? body.photo_urls.map((x: unknown) => String(x).trim()).filter((x: string) => Boolean(x))
      : [];

    const urls: string[] = many.length ? many : (one ? [one] : []);
    if (!urls.length) return jsonError("photo_url or photo_urls is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, profileId].filter(Boolean);

    const owned = await assertItemOwnedByFetch(itemId, ownerValues);
    if (!owned.ok) {
      return jsonError(owned.message, owned.code, (owned as any).debug ? { debug: (owned as any).debug } : undefined);
    }

    const rows = urls.map((u: string) => ({ item_id: itemId, photo_url: u }));

    const ins = await supabaseServer.from("consignment_photos").insert(rows).select("*");
    if (ins.error) return jsonError(ins.error.message ?? "Failed to insert photos", 500);

    return NextResponse.json(
      { success: true, inserted: ins.data ?? [], debug_match: (owned as any).match },
      { status: 201 }
    );
  } catch (err: any) {
    return jsonError(err?.message ?? "Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}
