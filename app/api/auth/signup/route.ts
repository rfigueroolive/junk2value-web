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
 * NEW FLOW (NO ACCOUNT CREATED YET):
 *  1) Validate input
 *  2) Create/Update a pending row in `signup_intents` (NOT Supabase Auth)
 *     - This is the "temporary holding pen" until verification is complete
 *  3) Replace any previous email codes for this email, then insert a fresh code
 *  4) Send email via Mailgun
 *
 * Next step:
 *  - /api/auth/verify-code should mark signup_intents.email_verified = true
 *  - If sms_opt_in == true, /api/auth/verify-phone-code should mark phone_verified = true
 *  - After last required verification, /api/auth/complete-signup should create the real Auth user
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      name,
      email,
      password, // NOTE: we validate strength here but we do NOT store it
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
      return jsonError("Phone is required when SMS consent is checked.", 400);
    }

    console.log("Signup intent request received:", {
      name: safeName,
      email: safeEmail,
      company: safeCompany,
      phone: safePhone,
      sms_opt_in: safeSmsOptIn,
    });

    // ----- Create/Update pending signup intent -----
    // IMPORTANT:
    // - We do NOT create a Supabase Auth user here.
    // - We also do NOT store plaintext password in DB.
    // - The app will pass password forward, and /complete-signup will receive it again.
    //
    // Required DB table: `signup_intents` (you will create it).
    //
    // We reset verification flags each time signup is started for that email.
    const intentPayload = {
      email: safeEmail,
      name: safeName,
      company: safeCompany,
      phone: safePhone,
      sms_opt_in: safeSmsOptIn,
      email_verified: false,
      phone_verified: safeSmsOptIn ? false : true, // if no sms, phone is considered "not required"
      updated_at: new Date().toISOString(),
    };

    // Upsert by email so repeated signup attempts overwrite the intent cleanly.
    const { data: intentRow, error: intentErr } = await supabaseServer
      .from("signup_intents")
      .upsert(intentPayload, { onConflict: "email" })
      .select("id,email,sms_opt_in,phone")
      .single();

    if (intentErr || !intentRow) {
      console.error("signup_intents upsert error:", intentErr);
      return jsonError("Failed to start signup. Please try again.", 500, {
        debug: {
          message: intentErr?.message,
          details: (intentErr as any)?.details,
          hint: (intentErr as any)?.hint,
          code: (intentErr as any)?.code,
        },
      });
    }

    // ----- Email verification code -----
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    // Delete any old codes for this email so only ONE code is valid at a time
    await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("email", safeEmail);

    const { error: insertError } = await supabaseServer
      .from("email_verification_codes")
      .insert({
        email: safeEmail,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("email_verification_codes insert error:", insertError);
      return jsonError("Failed to create verification code. Please try again.", 500, {
        debug: {
          code: (insertError as any).code,
          message: insertError.message,
          details: (insertError as any).details,
          hint: (insertError as any).hint,
        },
      });
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
      return jsonError("Failed to send verification email. Please try again.", 500, {
        debug: { message: mailError?.message ?? String(mailError) },
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Signup started. A verification code has been sent to your email.",
        intent_id: intentRow.id,
        requires_phone_verification: safeSmsOptIn && !!safePhone,
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
