// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  // Return BOTH keys so either client style can read it:
  // - Android helper reads "error"
  // - Other callers might read "message"
  return NextResponse.json(
    { success: false, error: message, message, ...(extra ?? {}) },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    const safeEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const safeCode = typeof code === "string" ? code.trim() : "";

    if (!safeEmail || !safeCode) {
      return jsonError("Email and code are required", 400);
    }

    // 1) Find matching code row (latest)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", safeEmail)
      .eq("code", safeCode)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !codeRow) {
      return jsonError("Invalid or expired code", 400, {
        debug: { codeErr: codeErr?.message ?? null },
      });
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 3) Find the profile row by email (this avoids getUserByEmail which breaks builds)
    const { data: profileRow, error: profFindErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", safeEmail)
      .limit(1)
      .maybeSingle();

    if (profFindErr) {
      return jsonError("Failed to look up profile", 500, {
        debug: {
          message: profFindErr.message,
          code: (profFindErr as any).code,
          details: (profFindErr as any).details,
          hint: (profFindErr as any).hint,
        },
      });
    }

    if (!profileRow?.id) {
      return jsonError("User profile not found for this email", 404);
    }

    // 4) Mark profile as email verified
    const { error: updateErr } = await supabaseServer
      .from("profiles")
      .update({ email_verified: true })
      .eq("id", profileRow.id);

    if (updateErr) {
      return jsonError("Failed to update profile", 500, {
        debug: {
          message: updateErr.message,
          code: (updateErr as any).code,
          details: (updateErr as any).details,
          hint: (updateErr as any).hint,
        },
      });
    }

    // 5) Delete the used code row (prevents reuse)
    const { error: deleteErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    if (deleteErr) {
      // Not fatal, but useful to know
      return NextResponse.json(
        {
          success: true,
          warning: "Email verified but failed to delete code row",
          debug: { message: deleteErr.message },
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
