// junk2value-web/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const safeEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const safeCode = typeof body.code === "string" ? body.code.trim() : "";

    if (!safeEmail || !safeCode) {
      return jsonError("Email and code are required.", 400);
    }

    // 1) Ensure a signup intent exists (new flow: account not created yet)
    const { data: intentRow, error: intentErr } = await supabaseServer
      .from("signup_intents")
      .select("email, phone, sms_opt_in, email_verified, phone_verified")
      .eq("email", safeEmail)
      .maybeSingle();

    if (intentErr) {
      return jsonError("Server error looking up signup intent.", 500, {
        debug: { message: intentErr.message },
      });
    }

    if (!intentRow) {
      return jsonError("Signup not found for this email. Please start signup again.", 404);
    }

    // 2) Find the matching email verification code
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", safeEmail)
      .eq("code", safeCode)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !codeRow) {
      return jsonError("Invalid or expired code.", 400, {
        debug: { codeErr: codeErr ? { message: codeErr.message } : null },
      });
    }

    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code.", 400);
    }

    // 3) Mark email verified on the intent (NOT on profiles/auth user anymore)
    const { error: updErr } = await supabaseServer
      .from("signup_intents")
      .update({ email_verified: true })
      .eq("email", safeEmail);

    if (updErr) {
      return jsonError("Failed to mark email verified.", 500, {
        debug: {
          message: updErr.message,
          details: (updErr as any).details,
          hint: (updErr as any).hint,
          code: (updErr as any).code,
        },
      });
    }

    // 4) Delete the used code row so it can’t be reused
    await supabaseServer.from("email_verification_codes").delete().eq("id", codeRow.id);

    const needsPhone =
      intentRow.sms_opt_in === true &&
      !!intentRow.phone &&
      intentRow.phone_verified !== true;

    return NextResponse.json(
      {
        success: true,
        message: "Email verified.",
        needs_phone_verification: needsPhone,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code.", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
