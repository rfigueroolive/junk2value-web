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

    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header", 401);

    // ✅ Validate token + get user
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message });
    }

    const userId = userData.user.id;

    // ✅ Load quote
    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("id,status,profile_id,customer_id,created_by,owner_id,user_uuid")
      .eq("id", id)
      .maybeSingle();

    if (quoteErr) return jsonError("Failed to load quote", 500, { error: quoteErr.message });
    if (!quote) return jsonError("Quote not found", 404);

    // ✅ Determine which owner column exists + is populated
    const ownerCandidates = ["profile_id", "customer_id", "created_by", "owner_id", "user_uuid"] as const;

    const ownerKey = ownerCandidates.find((k) => (quote as any)[k] != null) ?? null;
    const ownerValue = ownerKey ? String((quote as any)[ownerKey]) : "";

    // If quote isn't tied to a user, don't allow cancel from authenticated route
    if (!ownerKey || !ownerValue) {
      return jsonError("Not allowed", 403, {
        error: "Quote is not linked to a user (missing owner column value)",
        tried: ownerCandidates,
      });
    }

    // ✅ Ownership check
    if (ownerValue !== userId) {
      return jsonError("Not allowed", 403, {
        error: `Quote does not belong to this user`,
        ownerKey,
        ownerValue,
        userId,
      });
    }

    const status = String(quote.status || "").toLowerCase();

    // ✅ Business rule: approved quotes are locked
    if (status === "approved") {
      return jsonError("Not allowed", 403, { error: "Approved quotes cannot be cancelled" });
    }

    // ✅ Already cancelled? Fine—return success (idempotent)
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
