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

function extractEmailFromText(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
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
    const userEmail = (userData.user.email || "").toLowerCase();

    // ✅ Load quote without referencing columns that may not exist
    const { data: quote, error: quoteErr } = await supabaseServer
      .from("quotes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (quoteErr) return jsonError("Failed to load quote", 500, { error: quoteErr.message });
    if (!quote) return jsonError("Quote not found", 404);

    // ✅ Try common owner columns (only if they actually exist on this row)
    const ownerCandidates = [
      "user_id",
      "user_uuid",
      "owner_id",
      "created_by",
      "customer_id",
      "profile_id",
      "account_id",
    ];

    let ownerKey: string | null = null;
    let ownerValue: string | null = null;

    for (const k of ownerCandidates) {
      if (Object.prototype.hasOwnProperty.call(quote, k) && (quote as any)[k] != null) {
        ownerKey = k;
        ownerValue = String((quote as any)[k]);
        break;
      }
    }

    // ✅ If no owner id column exists, fall back to email-based ownership.
    // This is a pragmatic bridge until you add a real user_id column to quotes.
    let emailMatched = false;

    if (!ownerKey || !ownerValue) {
      const possibleEmailFields = ["email", "customer_email", "account_email", "created_by_email"];

      // 1) Check real email columns if they exist
      for (const k of possibleEmailFields) {
        if (Object.prototype.hasOwnProperty.call(quote, k) && (quote as any)[k]) {
          const qEmail = String((quote as any)[k]).toLowerCase();
          if (userEmail && qEmail === userEmail) {
            emailMatched = true;
            break;
          }
        }
      }

      // 2) Check notes (your current app writes email in notes)
      if (!emailMatched) {
        const notes = String((quote as any).notes || "");
        const emailInNotes = extractEmailFromText(notes);
        if (userEmail && emailInNotes && emailInNotes === userEmail) {
          emailMatched = true;
        } else if (userEmail && notes.toLowerCase().includes(userEmail)) {
          // extra lenient: direct substring match
          emailMatched = true;
        }
      }

      if (!emailMatched) {
        return jsonError("Not allowed", 403, {
          error: "Quote is not linked to a user (no owner id column) and email fallback did not match",
          userId,
          userEmail,
          quoteKeys: Object.keys(quote),
        });
      }
    } else {
      // ✅ Owner id column exists: enforce it
      if (ownerValue !== userId) {
        return jsonError("Not allowed", 403, {
          error: "Quote does not belong to this user",
          ownerKey,
          ownerValue,
          userId,
        });
      }
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
