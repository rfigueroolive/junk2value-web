// app/api/consignment/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Auth helper: reads Bearer token, verifies it, returns the authed user.
 */
async function requireUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : auth.trim();

  if (!token) {
    return { user: null, error: "Missing Authorization token" };
  }

  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: "Invalid token" };
  }

  return { user: data.user, error: null };
}

/**
 * Generate a friendly tracking number like: J2V-9F3K2X7Q
 */
function makeTrackingNumber() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `J2V-${s}`;
}

/**
 * POST /api/consignment/create  (logged-in)
 *
 * Body (example):
 * {
 *   "title": "Xbox Series S",
 *   "description": "Works great, includes controller",
 *   "current_price": 180,
 *   "payout_percent": 0.30,
 *   "photo_urls": ["https://...","https://..."]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requireUser(req);
    if (!user) {
      return NextResponse.json({ success: false, message: error }, { status: 401 });
    }

    const body = await req.json();

    const title = (body?.title ?? "").toString().trim() || null;
    const description = (body?.description ?? "").toString().trim() || null;

    const current_price =
      body?.current_price === null || body?.current_price === undefined
        ? null
        : Number(body.current_price);

    const payout_percent =
      body?.payout_percent === null || body?.payout_percent === undefined
        ? null
        : Number(body.payout_percent);

    const photo_urls: string[] = Array.isArray(body?.photo_urls)
      ? body.photo_urls.map((x: any) => String(x)).filter((x: string) => x.length > 0)
      : [];

    // basic numeric sanity (don’t over-police it)
    if (current_price !== null && (Number.isNaN(current_price) || current_price < 0)) {
      return NextResponse.json(
        { success: false, message: "current_price must be a valid number" },
        { status: 400 }
      );
    }

    if (payout_percent !== null && (Number.isNaN(payout_percent) || payout_percent < 0 || payout_percent > 1)) {
      return NextResponse.json(
        { success: false, message: "payout_percent must be between 0 and 1" },
        { status: 400 }
      );
    }

    // We assume profiles.id == auth user.id (your current setup)
    const profileId = user.id;

    // Create a unique tracking number (try a few times)
    let tracking = "";
    let createdItem: any = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      tracking = makeTrackingNumber();

      const { data, error: insertErr } = await supabaseServer
        .from("consignment_items")
        .insert({
          profile_id: profileId,
          tracking_number: tracking,
          title,
          description,
          current_price,
          payout_percent: payout_percent ?? undefined, // let DB default if null
          status: "pending",
        })
        .select("*")
        .single();

      if (!insertErr && data) {
        createdItem = data;
        break;
      }

      // If collision on tracking_number unique constraint, just retry
      const msg = (insertErr as any)?.message?.toLowerCase?.() || "";
      if (msg.includes("tracking_number") && msg.includes("duplicate")) continue;

      // Any other error -> stop
      return NextResponse.json(
        {
          success: false,
          message: "Failed to create consignment item",
          debug: { error: (insertErr as any)?.message, hint: (insertErr as any)?.hint },
        },
        { status: 500 }
      );
    }

    if (!createdItem) {
      return NextResponse.json(
        { success: false, message: "Failed to generate a unique tracking number" },
        { status: 500 }
      );
    }

    // Insert photos (optional)
    if (photo_urls.length) {
      const rows = photo_urls.map((url) => ({
        consignment_item_id: createdItem.id,
        photo_url: url,
      }));

      const { error: photoErr } = await supabaseServer
        .from("consignment_item_photos")
        .insert(rows);

      if (photoErr) {
        // Don’t fail the whole request; item is created already.
        // We just return a warning so you can see it in logs.
        console.error("consignment_item_photos insert error:", photoErr);
      }
    }

    return NextResponse.json(
      { success: true, item: createdItem, tracking_number: tracking },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/consignment/create error:", err);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  }
}
