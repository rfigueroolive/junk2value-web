// src/app/api/auth/send-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendFromNoreply } from "@/lib/mailgun";
import { supabaseServer } from "@/lib/supabaseServer";

const CODE_EXPIRY_MINUTES = 10;

function generateCode() {
  // 6-digit numeric code like 123456
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const code = generateCode();

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    const supabase = supabaseServer;

    const { error } = await supabase
      .from("email_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt,
        // created_at and consumed use defaults
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "Failed to save verification code" },
        { status: 500 }
      );
    }

    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
      <p>Your Junk2Value verification code is: <strong>${code}</strong></p>
      <p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `;

    await sendFromNoreply(
      email,
      "Your Junk2Value verification code",
      text,
      html
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("send-verification error:", err);
    return NextResponse.json(
      { error: "Failed to send verification email" },
      { status: 500 }
    );
  }
}
