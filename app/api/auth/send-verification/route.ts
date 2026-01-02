// app/api/auth/send-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

// Generate a 6 digit numeric code like "123456"
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

/**
 * POST /api/auth/send-verification
 * Body: { email: string }
 *
 * Generates ONE code, stores it, then emails that SAME code.
 * Also clears older codes for that email so there's no confusion.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailRaw = body?.email;

    const safeEmail = (typeof emailRaw === "string" ? emailRaw : "").trim().toLowerCase();
    if (!safeEmail) return jsonError("Email is required.", 400);

    // ✅ Generate the code ONCE and reuse it everywhere
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // 1) Delete any old codes for this email (prevents “which code is right?” problems)
    const { error: deleteErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("email", safeEmail);

    if (deleteErr) {
      console.error("send-verification delete old codes error:", deleteErr);
      return jsonError("Failed to resend code.", 500, {
        debug: {
          stage: "delete_old_codes",
          code: (deleteErr as any).code,
          message: deleteErr.message,
          details: (deleteErr as any).details,
          hint: (deleteErr as any).hint,
        },
      });
    }

    // 2) Insert the NEW code (this is the one we will email)
    const { error: insertErr } = await supabaseServer
      .from("email_verification_codes")
      .insert({
        email: safeEmail,
        // If your DB column is integer, Postgres will cast fine,
        // but to be extra safe you can switch this to: code: Number(code)
        code,
        expires_at: expiresAt,
      });

    if (insertErr) {
      console.error("send-verification insert code error:", insertErr);
      return jsonError("Failed to resend code.", 500, {
        debug: {
          stage: "insert_new_code",
          code: (insertErr as any).code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        },
      });
    }

    // 3) Email THAT SAME code
    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
      <p>Your Junk2Value verification code is: <strong>${code}</strong></p>
      <p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    try {
      await sendFromNoreply(safeEmail, "Your Junk2Value verification code", text, html);
    } catch (mailErr: any) {
      console.error("send-verification Mailgun error:", mailErr);

      // Optional cleanup: remove the code we just inserted so it can't be “dead”
      try {
        await supabaseServer.from("email_verification_codes").delete().eq("email", safeEmail);
      } catch (cleanupErr) {
        console.error("send-verification cleanup delete error:", cleanupErr);
      }

      return jsonError("Failed to resend code.", 500, {
        debug: { stage: "mailgun_send", message: mailErr?.message ?? String(mailErr) },
      });
    }

    return NextResponse.json(
      { success: true, message: "Verification code sent." },
      { status: 200 }
    );
  } catch (err) {
    console.error("send-verification error:", err);
    return NextResponse.json(
      { success: false, message: "Failed to resend code." },
      { status: 500 }
    );
  }
}
