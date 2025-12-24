// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

// Generate a 6 digit numeric code like "123456"
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/auth/signup
 *
 * Current flow:
 *  - Validate incoming fields from the client
 *  - (No profiles upsert yet. We will wire real accounts later.)
 *  - Create a row in email_verification_codes
 *  - Send the code to the email using Mailgun
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      name,
      email,
      password,
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

    // ----- Basic validation -----
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, message: "Name is required." },
        { status: 400 }
      );
    }

    if (!email || !email.trim()) {
      return NextResponse.json(
        { success: false, message: "Email is required." },
        { status: 400 }
      );
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return NextResponse.json(
        { success: false, message: "Invalid email format." },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { success: false, message: "Password is required." },
        { status: 400 }
      );
    }

    // Strong password: at least 6 chars, 1 lower, 1 upper, 1 digit, 1 symbol
    const strongPasswordPattern =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

    if (!strongPasswordPattern.test(password)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Password must be 6+ chars with upper, lower, number, and symbol.",
        },
        { status: 400 }
      );
    }

    console.log("Signup request received:", {
      name,
      email,
      company,
      phone,
      sms_opt_in,
    });

    const supabase = supabaseServer;

    // ----- Generate and store verification code -----
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    const { error: insertError } = await supabase
      .from("email_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error(
        "Supabase insert error (email_verification_codes):",
        insertError
      );
      return NextResponse.json(
        {
          success: false,
          message: "Failed to create verification code. Please try again.",
        },
        { status: 500 }
      );
    }

    // ----- Send email with code -----
    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
<p>Your Junk2Value verification code is: <strong>${code}</strong></p>
<p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
<p>If you did not request this, you can ignore this email.</p>
`;

    try {
      await sendFromNoreply(
        email,
        "Your Junk2Value verification code",
        text,
        html
      );
    } catch (mailError: any) {
      console.error("Mailgun send error (signup):", mailError);
      return NextResponse.json(
        {
          success: false,
          message: "Failed to send verification email. Please try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message:
          "Signup started. A verification code has been sent to your email.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in POST /api/auth/signup:", err);
    return NextResponse.json(
      { success: false, message: "Invalid request or server error." },
      { status: 500 }
    );
  }
}
