// app/api/auth/send-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, message, ...(extra ?? {}) },
    { status }
  );
}

/**
 * POST /api/auth/send-verification
 * Body: { email: string }
 *
 * Purpose:
 *  - Resend a NEW email verification code
 *  - Make sure email normalization matches what you store (lowercase)
 *  - Keep only ONE active code per email (delete old rows first)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawEmail = body?.email;

    if (!rawEmail || typeof rawEmail !== "string") {
      return jsonError("Email is required.", 400);
    }

    const safeEmail = rawEmail.trim().toLowerCase();

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(safeEmail)) {
      return jsonError("Invalid email format.", 400);
    }

    // Create a new code + expiry
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    // IMPORTANT:
    // To stop “wrong code” issues when multiple codes exist,
    // delete old codes for this email before inserting the new one.
    const { error: deleteErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("email", safeEmail);

    if (deleteErr) {
      console.error("send-verification delete old codes error:", deleteErr);
      return jsonError("Failed to resend code.", 500, {
        debug: {
          step: "delete_old_codes",
          code: (deleteErr as any).code,
          message: deleteErr.message,
          details: (deleteErr as any).details,
          hint: (deleteErr as any).hint,
        },
      });
    }

    // Insert the new code row
    const { error: insertErr } = await supabaseServer
      .from("email_verification_codes")
      .insert({
        email: safeEmail,
        code,
        expires_at: expiresAt,
      });

    if (insertErr) {
      console.error("send-verification insert error:", insertErr);
      return jsonError("Failed to resend code.", 500, {
        debug: {
          step: "insert_new_code",
          code: (insertErr as any).code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        },
      });
    }

    // Send the email
    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
<p>Your Junk2Value verification code is: <strong>${code}</strong></p>
<p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
<p>If you did not request this, you can ignore this email.</p>
`;

    try {
      await sendFromNoreply(
        safeEmail,
        "Your Junk2Value verification code",
        text,
        html
      );
    } catch (mailErr: any) {
      console.error("send-verification mailgun error:", mailErr);
      return jsonError("Failed to resend code.", 500, {
        debug: {
          step: "mailgun_send",
          message: mailErr?.message ?? String(mailErr),
        },
      });
    }

    return NextResponse.json(
      { success: true, message: "Verification code sent." },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("send-verification fatal error:", err);
    return jsonError("Failed to resend code.", 500, {
      debug: { step: "catch", message: err?.message ?? String(err) },
    });
  }
}
