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
  // Example: J2V-8F3K29Q1
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
  if (intVal < 1) return 1; // clamp
  return intVal;
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

function looksLikeDuplicateTracking(err: any): boolean {
  const msg = (err?.message || err?.error_description || "").toString().toLowerCase();
  // covers typical Postgres unique constraint messages
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

async function insertConsignmentWithFallback(args: {
  clientId: string;
  itemTitle: string;
  itemDesc?: string | null;
  itemCount?: number | null;
  notes?: string | null;
}) {
  // We try a few common schemas (so you don’t have to babysit column naming right now)
  const attempts: Array<{ name: string; basePayload: Record<string, any>; usesTracking: boolean }> =
    [
      {
        name: "snake_case + tracking_number",
        usesTracking: true,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          item_title: args.itemTitle,
          item_description: args.itemDesc ?? null,
          item_count: args.itemCount ?? null,
          notes: args.notes ?? null,
        },
      },
      {
        name: "title/description + tracking_number",
        usesTracking: true,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          title: args.itemTitle,
          description: args.itemDesc ?? null,
          item_count: args.itemCount ?? null,
          notes: args.notes ?? null,
        },
      },
      {
        name: "title/description/quantity + tracking_number",
        usesTracking: true,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          title: args.itemTitle,
          description: args.itemDesc ?? null,
          quantity: args.itemCount ?? null,
          notes: args.notes ?? null,
        },
      },
      // If your table doesn't have tracking_number yet, these will still work:
      {
        name: "snake_case (no tracking_number)",
        usesTracking: false,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          item_title: args.itemTitle,
          item_description: args.itemDesc ?? null,
          item_count: args.itemCount ?? null,
          notes: args.notes ?? null,
        },
      },
      {
        name: "title/description (no tracking_number)",
        usesTracking: false,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          title: args.itemTitle,
          description: args.itemDesc ?? null,
          item_count: args.itemCount ?? null,
          notes: args.notes ?? null,
        },
      },
      {
        name: "minimal",
        usesTracking: false,
        basePayload: {
          client_id: args.clientId,
          status: "pending",
          title: args.itemTitle,
        },
      },
    ];

  let lastError: any = null;

  for (const attempt of attempts) {
    // If the schema supports tracking_number, retry a few times on collision
    const maxTrackingRetries = attempt.usesTracking ? 6 : 1;

    for (let i = 0; i < maxTrackingRetries; i++) {
      const tracking = attempt.usesTracking ? makeTrackingNumber() : null;

      const payload = attempt.usesTracking
        ? { ...attempt.basePayload, tracking_number: tracking }
        : { ...attempt.basePayload };

      const { data, error } = await tryInsertOnce(payload);

      if (!error && data) {
        return {
          data,
          tracking_number: (data as any).tracking_number ?? tracking,
          used_attempt: attempt.name,
        };
      }

      lastError = { attempt: attempt.name, error };

      // Only retry when it *looks* like a tracking collision (unique constraint etc.)
      if (!(attempt.usesTracking && looksLikeDuplicateTracking(error))) {
        break;
      }
    }
  }

  throw lastError;
}

// -------------------------
// GET /api/consignment
// Returns the user's consignment items
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

    // Try common schema: client_id + created_at ordering
    const primary = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("client_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!primary.error) {
      return NextResponse.json({ success: true, items: primary.data ?? [] }, { status: 200 });
    }

    // Fallback #1: profile_id instead of client_id
    const fallback1 = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!fallback1.error) {
      return NextResponse.json({ success: true, items: fallback1.data ?? [] }, { status: 200 });
    }

    // Fallback #2: sometimes created_at isn’t there (or RLS/column mismatch). Try without ordering.
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
// Creates a new Pickup & Sell request
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    if (!email) return jsonError("User email missing on session", 400);

    const body = await req.json();

    // Accept a few names from the app, so you can change UI without breaking backend
    const itemTitle = toCleanString(body.item_title ?? body.title ?? body.itemName) ?? "";
    const itemDesc = toCleanString(body.item_description ?? body.description ?? body.itemDesc);
    const notes = toCleanString(body.notes ?? body.pickup_notes);

    const itemCount = parseOptionalPositiveInt(body.item_count ?? body.count ?? body.quantity);

    if (!itemTitle) return jsonError("item_title is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);

    const created = await insertConsignmentWithFallback({
      clientId: profileId,
      itemTitle,
      itemDesc,
      itemCount,
      notes,
    });

    // Keep response stable for the app
    return NextResponse.json(
      {
        success: true,
        message: "Consignment request created.",
        item: created.data,
        tracking_number: created.tracking_number,
        // keep this for now while we’re wiring things; you can delete later
        debug_used_attempt: created.used_attempt,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Unexpected error in POST /api/consignment:", err);
    return jsonError("Invalid request or server error", 500, {
      debug: {
        message: err?.error?.message ?? err?.message ?? String(err),
        attempt: err?.attempt,
      },
    });
  }
}
