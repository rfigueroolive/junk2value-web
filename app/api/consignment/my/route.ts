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

/**
 * profiles: email-only (your profiles table has no user_id)
 */
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

/**
 * We DO NOT assume consignment_items has profile_id/client_id/etc.
 * We fetch by an owner column if it exists, but we avoid querying missing columns by:
 *  - trying a small list
 *  - and if a column doesn't exist, we skip it safely
 */
const OWNER_COLS = ["user_id", "owner_id", "created_by", "submitted_by", "account_id", "customer_id", "client_id", "profile_id"] as const;

function looksLikeMissingColumn(err: any): boolean {
  const msg = (err?.message || err?.details || err?.hint || "").toString().toLowerCase();
  return (
    msg.includes("could not find the") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("unknown column")
  );
}

// GET /api/consignment/my
// Requires: Authorization: Bearer <access_token>
// Returns: consignment items owned by the current user
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization token", 401);

    // Verify token + get user
    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);

    if (userErr || !userRes?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message });
    }

    const authUserId = userRes.user.id;
    const email = (userRes.user.email ?? "").trim().toLowerCase();
    if (!email) return jsonError("User email missing on session", 400);

    // Your system: profiles are email-based
    const profileId = await getOrCreateProfileIdByEmail(email);

    // We'll accept either id depending on what your consignment_items table uses
    const ownerValues = [String(authUserId), String(profileId)].filter(Boolean);

    // Try to query consignment_items using whatever owner column exists
    let lastErr: any = null;
    let items: any[] | null = null;
    let usedOwner: { col: string; value: string } | null = null;

    for (const col of OWNER_COLS) {
      for (const value of ownerValues) {
        const res = await supabaseServer
          .from("consignment_items")
          .select("*")
          .eq(col, value)
          .order("created_at", { ascending: false });

        if (!res.error) {
          items = (res.data ?? []) as any[];
          usedOwner = { col, value };
          lastErr = null;
          break;
        }

        lastErr = res.error;

        // If the column doesn't exist, just skip it and try the next one
        if (!looksLikeMissingColumn(res.error)) {
          // Real error (RLS, etc.) -> stop and return it
          return jsonError("Failed to load consignment items", 500, { error: res.error.message });
        }
      }
      if (items) break;
    }

    if (!items) {
      return jsonError("Failed to load consignment items", 500, {
        error: lastErr?.message ?? "No usable owner column found on consignment_items",
      });
    }

    // Attach photos from consignment_photos (your real table)
    const itemIds = items.map((it) => it?.id).filter(Boolean);
    let photosByItem: Record<string, any[]> = {};

    if (itemIds.length) {
      const photosRes = await supabaseServer
        .from("consignment_photos")
        .select("id, item_id, photo_url, created_at")
        .in("item_id", itemIds)
        .order("created_at", { ascending: true });

      if (!photosRes.error) {
        photosByItem = {};
        (photosRes.data ?? []).forEach((p: any) => {
          const key = String(p.item_id);
          if (!photosByItem[key]) photosByItem[key] = [];
          photosByItem[key].push(p);
        });
      }
    }

    const itemsWithPhotos = items.map((it: any) => ({
      ...it,
      photos: photosByItem[String(it.id)] ?? [],
    }));

    return NextResponse.json(
      {
        success: true,
        items: itemsWithPhotos,
        debug_owner_match: usedOwner,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/consignment/my error:", err);
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
