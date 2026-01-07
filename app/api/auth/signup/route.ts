// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      name,
      email,
      password, // we validate strength, but we do NOT store it server-side
      company,
      phone,
      sms_opt_in,
    }: {
      name?: string;
      email?: string;
      password?: string;
      company?: string | null;
      phone?: string | null;
      sms_opt_in?: boolean | null;
    } = body;

    const safeName = (name ?? "").trim();
    const safeEmail = (email ?? "").trim().toLowerCase();
    const safeCompany = company?.trim() || null;
    const safePhone = phone?.trim() || null;
    const safeSmsOptIn = sms_opt_in === true;

    if (!safeName) return jsonError("Name is required.", 400);
    if (!safeEmail) return jsonError("Email is required.", 400);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(safeEmail)) return jsonError("Invalid email format.", 400);

    if (!password) return jsonError("Password is required.", 400);

    const strongPasswordPattern =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
    if (!strongPasswordPattern.test(password)) {
      return jsonError(
        "Password must be 6+ chars with upper, lower, number, and symbol.",
        400
      );
    }

    if (safeSmsOptIn && !safePhone) {
      return jsonError("Phone is required when SMS consent is checked.", 400);
    }

    // 1) Upsert pending signup intent (NO auth user creation yet)
    const { error: intentErr } = await supabaseServer
      .from("signup_intents")
      .upsert(
        {
          email: safeEmail,
          name: safeName,
          company: safeCompany,
          phone: safePhone,
          sms_opt_in: safeSmsOptIn,
          email_verified: false,
          phone_verified: safeSmsOptIn ? false : true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

    if (intentErr) {
      return jsonError("Failed to start signup.", 500, {
        debug: { message: intentErr.message, code: (intentErr as any).code },
      });
    }

    // 2) Create email code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    await supabaseServer.from("email_verification_codes").delete().eq("email", safeEmail);

    const { error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .insert({ email: safeEmail, code, expires_at: expiresAt });

    if (codeErr) {
      return jsonError("Failed to create verification code. Please try again.", 500, {
        debug: { message: codeErr.message, code: (codeErr as any).code },
      });
    }

    // 3) Send email
    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
      <p>Your Junk2Value verification code is: <strong>${code}</strong></p>
      <p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    await sendFromNoreply(safeEmail, "Your Junk2Value verification code", text, html);

    return NextResponse.json(
      {
        success: true,
        message: "Signup started. A verification code has been sent to your email.",
        next_step: safeSmsOptIn ? "phone_after_email" : "done_after_email",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error in POST /api/auth/signup:", err);
    return NextResponse.json(
      { success: false, message: "Invalid request or server error." },
      { status: 500 }
    );
  }
}
