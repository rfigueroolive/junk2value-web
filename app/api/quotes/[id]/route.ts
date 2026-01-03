// app/api/quotes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;

  const [scheme, token] = auth.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;

  return token?.trim() || null;
}

export async function PATCH(req: NextRequest, context: any) {
  try {
    // ✅ Works whether context.params is an object OR a Promise
    const { id: quoteId } = await Promise.resolve(context?.params);

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user?.email) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const email = userData.user.email.trim().toLowerCase();

    // Profile id
    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (profileErr || !profile?.id) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Quote ownership + status
    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("id, client_id, status")
      .eq("id", quoteId)
      .single();

    if (quoteErr || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.client_id !== profile.id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const status = String(quote.status || "").toLowerCase();

    // ✅ Approved = locked forever
    if (status === "approved") {
      return NextResponse.json(
        { error: "This quote is approved and locked. You can no longer edit it." },
        { status: 409 }
      );
    }

    // Also don’t allow editing cancelled quotes
    if (status === "cancelled") {
      return NextResponse.json(
        { error: "This quote is cancelled. You can’t edit it." },
        { status: 409 }
      );
    }

    const body = await req.json();

    // Only allow editing safe fields (expand later)
    const updates: Record<string, unknown> = {};

    if (typeof body.job_location_address === "string") {
      updates.job_location_address = body.job_location_address;
    }
    if (Number.isInteger(body.estimated_item_count)) {
      updates.estimated_item_count = body.estimated_item_count;
    }
    if (Number.isInteger(body.estimated_avg_weight)) {
      updates.estimated_avg_weight = body.estimated_avg_weight;
    }
    if (Number.isInteger(body.estimated_heaviest_weight)) {
      updates.estimated_heaviest_weight = body.estimated_heaviest_weight;
    }
    if (typeof body.notes === "string") {
      updates.notes = body.notes;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: updated, error: updateErr } = await supabaseServer
      .from("quotes")
      .update(updates)
      .eq("id", quoteId)
      .select()
      .single();

    if (updateErr) {
      console.error("Quote update error:", updateErr);
      return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (e) {
    console.error("PATCH /api/quotes/[id] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
