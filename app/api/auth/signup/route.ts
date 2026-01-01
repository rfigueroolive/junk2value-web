// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendFromNoreply } from "@/lib/mailgun";

const CODE_EXPIRY_MINUTES = 10;

// Generate a 6 digit numeric code like "123456"
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
 * POST /api/auth/signup
 *
 * Flow:
 *  1) Validate input
 *  2) Create Supabase Auth user (confirmed in Supabase, but "not verified" in our app until code checks pass)
 *  3) Create/Upsert profile row with verification flags
 *  4) Create email verification code row
 *  5) Send email via Mailgun
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
    const safeName = (name ?? "").trim();
    const safeEmail = (email ?? "").trim().toLowerCase();
    const safeCompany = company?.trim() || null;
    const safePhone = phone?.trim() || null;
    const safeSmsOptIn = sms_opt_in === true;

    if (!safeName) return jsonError("Name is required.", 400);
    if (!safeEmail) return jsonError("Email is required.", 400);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(safeEmail)) {
      return jsonError("Invalid email format.", 400);
    }

    if (!password) return jsonError("Password is required.", 400);

    // Strong password: at least 6 chars, 1 lower, 1 upper, 1 digit, 1 symbol
    const strongPasswordPattern =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

    if (!strongPasswordPattern.test(password)) {
      return jsonError(
        "Password must be 6+ chars with upper, lower, number, and symbol.",
        400
      );
    }

    // If they opted in to SMS, require a phone number
    if (safeSmsOptIn && !safePhone) {
      return jsonError(
        "Phone is required when SMS consent is checked.",
        400
      );
    }

    console.log("Signup request received:", {
      name: safeName,
      email: safeEmail,
      company: safeCompany,
      phone: safePhone,
      sms_opt_in: safeSmsOptIn,
    });

    // ----- Create Supabase Auth user -----
    // We set email_confirm=true so Supabase doesn't block sign-in on its own.
    // Your app's "real verification" is controlled by your code + profile flags.
    const { data: created, error: createError } =
      await supabaseServer.auth.admin.createUser({
        email: safeEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: safeName,
          company: safeCompany,
          phone: safePhone,
          sms_opt_in: safeSmsOptIn,
          // App-level verification flags (you can also mirror these in profiles)
          email_verified: false,
          phone_verified: safeSmsOptIn ? false : true,
        },
      });

    if (createError || !created?.user) {
      console.error("Supabase auth.admin.createUser error:", createError);

      // Common: email already registered
      const msg =
        createError?.message?.toLowerCase().includes("already") === true
          ? "That email is already registered. Please log in instead."
          : "Failed to create user. Please try again.";

      return jsonError(msg, 400);
    }

    const userId = created.user.id;

    // ----- Create/Upsert profile row -----
    // NOTE: These columns must exist in your profiles table:
    // id, email, name, company, phone, sms_opt_in, email_verified, phone_verified
    // If your column names differ, tell me the schema and I’ll adjust.
    const { error: profileError } = await supabaseServer.from("profiles").upsert(
      {
        id: userId,
        email: safeEmail,
        name: safeName,
        company: safeCompany,
        phone: safePhone,
        sms_opt_in: safeSmsOptIn,
        email_verified: false,
        phone_verified: safeSmsOptIn ? false : true,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.error("Supabase upsert error (profiles):", profileError);

      // If profile fails, we should clean up the auth user to avoid orphaned accounts
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after profile error:", cleanupErr);
      }

      return jsonError(
        "Failed to create user profile. Please try again.",
        500
      );
    }

    // ----- Generate and store email verification code -----
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    const { error: insertError } = await supabaseServer
      .from("email_verification_codes")
      .insert({
        email: safeEmail,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error(
        "Supabase insert error (email_verification_codes):",
        insertError
      );

      // Cleanup to avoid "created but can't verify" accounts
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after code insert error:", cleanupErr);
      }

      return jsonError(
        "Failed to create verification code. Please try again.",
        500
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
        safeEmail,
        "Your Junk2Value verification code",
        text,
        html
      );
    } catch (mailError: any) {
      console.error("Mailgun send error (signup):", mailError);

      // Cleanup so we don't keep accounts that never got a code
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after mail error:", cleanupErr);
      }

      return jsonError(
        "Failed to send verification email. Please try again.",
        500
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
