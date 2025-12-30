// src/app/api/auth/signup/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/auth/signup
 *
 * Flow:
 *  - Validate fields
 *  - Create Supabase Auth user (service role)
 *  - Upsert profiles row
 *  - Create email verification code row
 *  - Send code via Mailgun
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

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Create Auth user (so login works)
    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // keep login working immediately
        user_metadata: {
          name: name.trim(),
          company: company ?? null,
          phone: phone ?? null,
          sms_opt_in: !!sms_opt_in,
        },
      });

    if (createErr || !created?.user) {
      return NextResponse.json(
        { success: false, message: createErr?.message || "Failed to create user." },
        { status: 400 }
      );
    }

    const userId = created.user.id;

    // 2) Upsert profile
    await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: name.trim(),
        company: company ?? null,
        phone: phone ?? null,
        sms_opt_in: !!sms_opt_in,
      },
      { onConflict: "id" }
    );

    // 3) Generate and store verification code
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    const { error: insertError } = await supabaseAdmin
      .from("email_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to create verification code. Please try again.",
        },
        { status: 500 }
      );
    }

    // 4) Send email with code
    const text = `Your Junk2Value verification code is: ${code}`;
    const html = `
<p>Your Junk2Value verification code is: <strong>${code}</strong></p>
<p>This code will expire in ${CODE_EXPIRY_MINUTES} minutes.</p>
<p>If you did not request this, you can ignore this email.</p>
`;

    await sendFromNoreply(
      email,
      "Your Junk2Value verification code",
      text,
      html
    );

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
