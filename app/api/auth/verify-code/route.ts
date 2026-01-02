// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Normalize inputs so casing/spaces never cause mismatches
    const rawEmail = typeof body?.email === "string" ? body.email : "";
    const rawCode = typeof body?.code === "string" ? body.code : "";

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();

    if (!email || !code) {
      return NextResponse.json(
        { success: false, error: "Email and code are required" },
        { status: 400 }
      );
    }

    // 1) Find matching code row (latest)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", email)
      .eq("code", code)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !codeRow) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // 3) Mark profile as email verified (NO auth.admin.getUserByEmail needed)
    // We update by email because that's stable and avoids admin API differences.
    const { data: updatedProfile, error: profErr } = await supabaseServer
      .from("profiles")
      .update({ email_verified: true })
      .eq("email", email)
      .select("id, email, email_verified")
      .maybeSingle();

    if (profErr) {
      console.error("profiles update error:", profErr);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to update profile",
          debug: {
            code: (profErr as any).code,
            message: profErr.message,
            details: (profErr as any).details,
            hint: (profErr as any).hint,
          },
        },
        { status: 500 }
      );
    }

    if (!updatedProfile) {
      // This means the user exists in auth but no profile row exists (or email mismatch).
      return NextResponse.json(
        {
          success: false,
          error: "Profile not found for this email",
          debug: { email },
        },
        { status: 404 }
      );
    }

    // 4) Delete the used code row (prevents reuse)
    const { error: delErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    if (delErr) {
      // Not fatal, but log it so you can clean up later
      console.error("email_verification_codes delete error:", delErr);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
