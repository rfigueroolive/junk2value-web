// src/app/api/consignment/route.ts
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

function makeTrackingNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "J2V-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function toCleanString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length ? s : null;
}

function parseOptionalPositiveInt(val: any): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  const intVal = Math.floor(n);
  if (intVal < 1) return 1;
  return intVal;
}

/**
 * More reliable than email-only:
 * - Try profiles.user_id first
 * - Fall back to profiles.email
 * - Create with BOTH user_id + email when missing
 */
async function getOrCreateProfileId(args: { email: string; userId: string }): Promise<string> {
  const email = args.email.trim().toLowerCase();
  const userId = args.userId;

  // 1) by user_id (best)
  const byUserId = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (byUserId.error) throw byUserId.error;
  if (byUserId.data?.id) return byUserId.data.id as string;

  // 2) by email (fallback)
  const byEmail = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (byEmail.error) throw byEmail.error;
  if (byEmail.data?.id) return byEmail.data.id as string;

  // 3) create profile (include user_id so NOT NULL constraints don’t explode)
  const created = await supabaseServer
    .from("profiles")
    .insert([{ email, user_id: userId }])
    .select("id")
    .single();

  if (created.error) throw created.error;
  return created.data.id as string;
}

function looksLikeDuplicateTracking(err: any): boolean {
  const msg = (err?.message || err?.error_description || "").toString().toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique") || msg.includes("tracking");
}

async function tryInsertOnce(payload: Record<string, any>) {
  const { data, error } = await supabaseServer
    .from("consignment_items")
    .insert([payload])
    .select()
    .single();

  return { data, error };
}

/**
 * We try a bunch of payload variations to match whatever your table currently looks like:
 * - client_id vs profile_id
 * - with/without status
 * - item_title vs title
 * - item_description vs description
 * - item_count vs quantity
 * - with/without tracking_number
 */
async function insertConsignmentWithFallback(args: {
  ownerId: string;
  itemTitle: string;
  itemDesc?: string | null;
  itemCount?: number | null;
  notes?: string | null;
}) {
  const ownerKeys = ["client_id", "profile_id"] as const;

  const baseShapes: Array<{ name: string; payload: (ownerKey: string) => Record<string, any> }> = [
    {
      name: "snake_case",
      payload: (k) => ({
        [k]: args.ownerId,
        item_title: args.itemTitle,
        item_description: args.itemDesc ?? null,
        item_count: args.itemCount ?? null,
        notes: args.notes ?? null,
      }),
    },
    {
      name: "title/description + item_count",
      payload: (k) => ({
        [k]: args.ownerId,
        title: args.itemTitle,
        description: args.itemDesc ?? null,
        item_count: args.itemCount ?? null,
        notes: args.notes ?? null,
      }),
    },
    {
      name: "title/description + quantity",
      payload: (k) => ({
        [k]: args.ownerId,
        title: args.itemTitle,
        description: args.itemDesc ?? null,
        quantity: args.itemCount ?? null,
        notes: args.notes ?? null,
      }),
    },
    {
      name: "minimal_title",
      payload: (k) => ({
        [k]: args.ownerId,
        title: args.itemTitle,
      }),
    },
    {
      name: "minimal_item_title",
      payload: (k) => ({
        [k]: args.ownerId,
        item_title: args.itemTitle,
      }),
    },
  ];

  const statusVariants: Array<{ name: string; addStatus: boolean }> = [
    { name: "with_status", addStatus: true },
    { name: "no_status", addStatus: false },
  ];

  const trackingVariants: Array<{ name: string; usesTracking: boolean }> = [
    { name: "with_tracking", usesTracking: true },
    { name: "no_tracking", usesTracking: false },
  ];

  let lastError: any = null;

  for (const ownerKey of ownerKeys) {
    for (const shape of baseShapes) {
      for (const statusV of statusVariants) {
        for (const trackV of trackingVariants) {
          const maxTrackingRetries = trackV.usesTracking ? 6 : 1;

          for (let i = 0; i < maxTrackingRetries; i++) {
            const tracking = trackV.usesTracking ? makeTrackingNumber() : null;

            const base = shape.payload(ownerKey);
            const payload: Record<string, any> = { ...base };

            if (statusV.addStatus) payload.status = "pending";
            if (trackV.usesTracking) payload.tracking_number = tracking;

            const { data, error } = await tryInsertOnce(payload);

            if (!error && data) {
              return {
                data,
                tracking_number: (data as any).tracking_number ?? tracking,
                used_attempt: `${ownerKey} / ${shape.name} / ${statusV.name} / ${trackV.name}`,
              };
            }

            lastError = { attempt: `${ownerKey} / ${shape.name} / ${statusV.name} / ${trackV.name}`, error };

            if (!(trackV.usesTracking && looksLikeDuplicateTracking(error))) {
              break;
            }
          }
        }
      }
    }
  }

  throw lastError;
}

// -------------------------
// GET /api/consignment
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const userId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileId({ email, userId });

    // Try client_id first
    const primary = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("client_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!primary.error) {
      return NextResponse.json({ success: true, items: primary.data ?? [] }, { status: 200 });
    }

    // Fallback: profile_id
    const fallback1 = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!fallback1.error) {
      return NextResponse.json({ success: true, items: fallback1.data ?? [] }, { status: 200 });
    }

    // Fallback without ordering
    const fallback2 = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("client_id", profileId)
      .limit(200);

    if (!fallback2.error) {
      return NextResponse.json({ success: true, items: fallback2.data ?? [] }, { status: 200 });
    }

    console.error("GET consignment_items error:", primary.error, fallback1.error, fallback2.error);
    return jsonError("Failed to load consignment items", 500, {
      debug: {
        primary: primary.error?.message,
        fallback1: fallback1.error?.message,
        fallback2: fallback2.error?.message,
      },
    });
  } catch (err: any) {
    console.error("Unexpected error in GET /api/consignment:", err);
    return jsonError("Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}

// -------------------------
// POST /api/consignment
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const userId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const body = await req.json();

    const itemTitle = toCleanString(body.item_title ?? body.title ?? body.itemName) ?? "";
    const itemDesc = toCleanString(body.item_description ?? body.description ?? body.itemDesc);
    const notes = toCleanString(body.notes ?? body.pickup_notes);
    const itemCount = parseOptionalPositiveInt(body.item_count ?? body.count ?? body.quantity);

    if (!itemTitle) return jsonError("item_title is required", 400);

    const profileId = await getOrCreateProfileId({ email, userId });

    const created = await insertConsignmentWithFallback({
      ownerId: profileId,
      itemTitle,
      itemDesc,
      itemCount,
      notes,
    });

    const createdId = (created.data as any)?.id ?? null;

    return NextResponse.json(
      {
        success: true,
        message: "Consignment request created.",
        item_id: createdId,          // ✅ top-level for Android
        id: createdId,               // ✅ also top-level
        item: created.data,
        tracking_number: created.tracking_number,
        debug_used_attempt: created.used_attempt,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Unexpected error in POST /api/consignment:", err);

    const supaMsg =
      err?.error?.message ??
      err?.error?.details ??
      err?.message ??
      "Unknown error";

    // ✅ Return the real message so your Android toast is useful while debugging
    return jsonError(supaMsg, 500, {
      debug: {
        message: supaMsg,
        attempt: err?.attempt,
      },
    });
  }
}
