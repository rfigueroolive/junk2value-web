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

    // ✅ Load quote without referencing columns that may not exist
    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (quoteErr) return jsonError("Failed to load quote", 500, { error: quoteErr.message });
    if (!quote) return jsonError("Quote not found", 404);

    // ✅ Ownership check (only checks keys that actually exist on the row)
    const candidates = ["user_id", "profile_id", "customer_id", "created_by", "owner_id", "user_uuid"];
    let ownerKey: string | null = null;
    let ownerValue: string | null = null;

    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(quote, k) && (quote as any)[k] != null) {
        ownerKey = k;
        ownerValue = String((quote as any)[k]);
        break;
      }
    }

    if (!ownerKey || !ownerValue) {
      return jsonError("Not allowed", 403, {
        error: "Quote is not linked to a user (no owner column found on row)",
        tried: candidates,
      });
    }

    if (ownerValue !== userId) {
      return jsonError("Not allowed", 403, {
        error: "Quote does not belong to this user",
        ownerKey,
        ownerValue,
        userId,
      });
    }

    const status = String((quote as any).status || "").toLowerCase();

    // ✅ Business rule: approved quotes are locked
    if (status === "approved") {
      return jsonError("Not allowed", 403, { error: "Approved quotes cannot be cancelled" });
    }

    // ✅ Idempotent: if already cancelled, just return success
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
