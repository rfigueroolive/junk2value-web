// app/api/consignment/my/route.ts
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

  if (!token) return { user: null as any, error: "Missing Authorization token" };

  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user) return { user: null as any, error: "Invalid token" };

  return { user: data.user, error: null };
}

/**
 * GET /api/consignment/my  (logged-in)
 *
 * Returns the user's consignment items + attached photo URLs.
 */
export async function GET(req: NextRequest) {
  try {
    const { user, error } = await requireUser(req);
    if (!user) {
      return NextResponse.json({ success: false, message: error }, { status: 401 });
    }

    const profileId = user.id;

    // 1) Get items
    const { data: items, error: itemsErr } = await supabaseServer
      .from("consignment_items")
      .select(
        "id, profile_id, tracking_number, title, description, current_price, payout_percent, status, created_at"
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (itemsErr) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch consignment items",
          debug: { error: itemsErr.message, hint: (itemsErr as any).hint },
        },
        { status: 500 }
      );
    }

    const safeItems = items ?? [];
    const itemIds = safeItems.map((x) => x.id).filter(Boolean);

    // 2) Get photos for these items (if any)
    let photos: Array<{ consignment_item_id: string; photo_url: string }> = [];
    if (itemIds.length) {
      const { data: photoRows, error: photosErr } = await supabaseServer
        .from("consignment_item_photos")
        .select("consignment_item_id, photo_url")
        .in("consignment_item_id", itemIds)
        .order("created_at", { ascending: true });

      if (photosErr) {
        // Don't hard-fail; items still useful without photos
        console.error("consignment_item_photos fetch error:", photosErr);
      } else {
        photos = (photoRows ?? []) as any;
      }
    }

    // 3) Attach photo_urls onto each item
    const photosByItem = new Map<string, string[]>();
    for (const p of photos) {
      const id = String(p.consignment_item_id);
      if (!photosByItem.has(id)) photosByItem.set(id, []);
      photosByItem.get(id)!.push(String(p.photo_url));
    }

    const hydrated = safeItems.map((it) => ({
      ...it,
      photo_urls: photosByItem.get(String(it.id)) ?? [],
    }));

    return NextResponse.json({ success: true, items: hydrated }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/consignment/my error:", err);
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}
