import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function extractBearerToken(req: NextRequest): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const token = extractBearerToken(req);
    if (!token) return jsonError("Missing Authorization bearer token", 401);

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message ?? "Invalid token" });
    }

    const quoteId = ctx.params.id;

    // 1) Read the quote so we can enforce "only cancelled can be deleted"
    const { data: quote, error: readErr } = await supabaseAdmin
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .maybeSingle();

    if (readErr) return jsonError("Failed to read quote", 500, { error: readErr.message });
    if (!quote) return jsonError("Quote not found", 404);

    const status = String(quote.status ?? "").toLowerCase().trim();
    if (status !== "cancelled" && status !== "canceled") {
      return jsonError("Only cancelled quotes can be deleted.", 400);
    }

    // NOTE: we are NOT enforcing ownership yet because your table doesn't have a user_id column.
    // Once we know the correct owner column, we’ll add:
    // if (quote[OWNER_COL] !== userData.user.id) return jsonError("Forbidden", 403);

    const { error: delErr } = await supabaseAdmin.from("quotes").delete().eq("id", quoteId);
    if (delErr) return jsonError("Delete failed", 500, { error: delErr.message });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
