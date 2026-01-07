import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // ✅ Must be logged in (valid JWT)
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message });
    }

    // ✅ Load quote safely (no guessing columns)
    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();

    if (quoteErr) return jsonError("Failed to load quote", 500, { error: quoteErr.message });
    if (!quote) return jsonError("Quote not found", 404);

    const status = String(quote.status || "").toLowerCase();

    // ✅ Approved quotes are locked
    if (status === "approved") {
      return jsonError("Not allowed", 403, { error: "Approved quotes cannot be cancelled" });
    }

    // ✅ Idempotent: already cancelled => ok
    if (status === "cancelled" || status === "canceled") {
      return NextResponse.json({ success: true });
    }

    // ✅ Cancel it
    const { error: updErr } = await supabaseServer
      .from("quotes")
      .update({ status: "cancelled" })
      .eq("id", id);

    if (updErr) return jsonError("Cancel quote failed", 500, { error: updErr.message });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
