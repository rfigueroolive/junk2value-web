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

async function getOrCreateProfileIdByEmail(email: string): Promise<string> {
  // Prefer existing profile row
  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) throw profileErr;
  if (profile?.id) return profile.id;

  // Create minimal row if missing
  const { data: created, error: createErr } = await supabaseServer
    .from("profiles")
    .insert([{ email }])
    .select("id")
    .single();

  if (createErr) throw createErr;
  return created.id as string;
}

async function insertConsignmentWithFallback(args: {
  clientId: string;
  itemTitle: string;
  itemDesc?: string | null;
  itemCount?: number | null;
  notes?: string | null;
}) {
  const tracking = makeTrackingNumber();

  // We try a few common schemas (so you don’t have to babysit column naming right now)
  const attempts: Array<{ name: string; payload: Record<string, any> }> = [
    {
      name: "snake_case + tracking_number",
      payload: {
        client_id: args.clientId,
        status: "pending",
        item_title: args.itemTitle,
        item_description: args.itemDesc ?? null,
        item_count: args.itemCount ?? null,
        notes: args.notes ?? null,
        tracking_number: tracking,
      },
    },
    {
      name: "title/description + tracking_number",
      payload: {
        client_id: args.clientId,
        status: "pending",
        title: args.itemTitle,
        description: args.itemDesc ?? null,
        item_count: args.itemCount ?? null,
        notes: args.notes ?? null,
        tracking_number: tracking,
      },
    },
    {
      name: "title/description/quantity + tracking_number",
      payload: {
        client_id: args.clientId,
        status: "pending",
        title: args.itemTitle,
        description: args.itemDesc ?? null,
        quantity: args.itemCount ?? null,
        notes: args.notes ?? null,
        tracking_number: tracking,
      },
    },
    // If your table doesn't have tracking_number yet, these will still work:
    {
      name: "snake_case (no tracking_number)",
      payload: {
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
      payload: {
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
      payload: {
        client_id: args.clientId,
        status: "pending",
        title: args.itemTitle,
      },
    },
  ];

  let lastError: any = null;

  for (const attempt of attempts) {
    const { data, error } = await supabaseServer
      .from("consignment_items")
      .insert([attempt.payload])
      .select()
      .single();

    if (!error && data) {
      return {
        data,
        tracking_number: (data as any).tracking_number ?? tracking, // if table stored it, great; else return generated
        used_attempt: attempt.name,
      };
    }

    lastError = { attempt: attempt.name, error };
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

    const { data, error } = await supabaseServer
      .from("consignment_items")
      .select("*")
      .eq("client_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      // Some schemas might use profile_id instead of client_id
      const fallback = await supabaseServer
        .from("consignment_items")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (fallback.error) {
        console.error("GET consignment_items error:", error, fallback.error);
        return jsonError("Failed to load consignment items", 500, {
          debug: { error: error.message, fallback: fallback.error.message },
        });
      }

      return NextResponse.json({ success: true, items: fallback.data ?? [] }, { status: 200 });
    }

    return NextResponse.json({ success: true, items: data ?? [] }, { status: 200 });
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
    const itemTitle: string =
      (body.item_title ?? body.title ?? body.itemName ?? "").toString().trim();

    const itemDesc: string | null =
      (body.item_description ?? body.description ?? body.itemDesc ?? null)?.toString()?.trim?.() ??
      null;

    const notes: string | null =
      (body.notes ?? body.pickup_notes ?? null)?.toString()?.trim?.() ?? null;

    const rawCount = body.item_count ?? body.count ?? body.quantity ?? null;
    const itemCount =
      rawCount === null || rawCount === undefined || String(rawCount).trim() === ""
        ? null
        : Number(rawCount);

    if (!itemTitle) return jsonError("item_title is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);

    const created = await insertConsignmentWithFallback({
      clientId: profileId,
      itemTitle,
      itemDesc,
      itemCount: Number.isFinite(itemCount as any) ? (itemCount as number) : null,
      notes,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Consignment request created.",
        item: created.data,
        tracking_number: created.tracking_number,
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
