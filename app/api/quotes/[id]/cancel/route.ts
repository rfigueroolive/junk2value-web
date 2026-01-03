// src/app/api/quotes/[id]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token?.trim() || null;
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const quoteId = ctx.params.id;

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user?.email) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const email = userData.user.email.trim().toLowerCase();

    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (profileErr || !profile?.id) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("id, client_id, status")
      .eq("id", quoteId)
      .single();

    if (quoteErr || !quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    if (quote.client_id !== profile.id) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

    const status = String(quote.status || "").toLowerCase();
    if (status === "approved") {
      return NextResponse.json(
        { error: "This quote is approved and locked. You can no longer cancel it." },
        { status: 409 }
      );
    }

    const { data: cancelled, error: cancelErr } = await supabaseServer
      .from("quotes")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", quoteId)
      .select()
      .single();

    if (cancelErr) {
      console.error("Cancel quote error:", cancelErr);
      return NextResponse.json({ error: "Failed to cancel quote" }, { status: 500 });
    }

    return NextResponse.json(cancelled, { status: 200 });
  } catch (e) {
    console.error("POST /api/quotes/[id]/cancel error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
