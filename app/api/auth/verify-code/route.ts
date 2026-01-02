// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailRaw = typeof body?.email === "string" ? body.email : "";
    const codeRaw = typeof body?.code === "string" ? body.code : "";

    const email = emailRaw.trim().toLowerCase();
    const code = codeRaw.trim();

    if (!email || !code) {
      return jsonError("Email and code are required", 400);
    }

    // 1) Find the matching code row (newest first)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", email)
      .eq("code", code)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr) {
      console.error("verify-code select error:", codeErr);
      return jsonError("Server error checking code", 500, {
        debug: { message: codeErr.message, details: (codeErr as any).details, hint: (codeErr as any).hint },
      });
    }

    if (!codeRow) {
      // Important: this means there is NO row in the table matching email+code
      return jsonError("Invalid or expired code", 400);
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 3) Find the profile by email (NO admin getUserByEmail needed)
    const { data: profile, error: profFindErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profFindErr) {
      console.error("verify-code profile lookup error:", profFindErr);
      return jsonError("Failed to find user profile", 500, {
        debug: {
          message: profFindErr.message,
          details: (profFindErr as any).details,
          hint: (profFindErr as any).hint,
        },
      });
    }

    if (!profile?.id) {
      return jsonError("User profile not found for this email", 404);
    }

    // 4) Mark email verified
    const { error: profUpdateErr } = await supabaseServer
      .from("profiles")
      .update({ email_verified: true })
      .eq("id", profile.id);

    if (profUpdateErr) {
      console.error("verify-code profile update error:", profUpdateErr);
      return jsonError("Failed to update profile", 500, {
        debug: {
          message: profUpdateErr.message,
          details: (profUpdateErr as any).details,
          hint: (profUpdateErr as any).hint,
        },
      });
    }

    // 5) Delete used code row (prevents reuse)
    const { error: delErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    if (delErr) {
      console.error("verify-code delete error:", delErr);
      // Not fatal to verification, but it’s cleaner to know
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return NextResponse.json({ success: false, error: "Failed to verify code" }, { status: 500 });
  }
}
