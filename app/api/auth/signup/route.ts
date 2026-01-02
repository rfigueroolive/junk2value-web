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
 *  2) Create Supabase Auth user (email_confirm=true so Supabase doesn't block sign-in)
 *  3) Create a minimal profile row (id + email) in `profiles`
 *     - This avoids breaking if your profiles table DOESN'T have the extra columns yet
 *     - Also includes a fallback to INSERT if UPSERT fails (missing unique/PK on id)
 *  4) Replace any previous email codes for this email, then insert a fresh code
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
      return jsonError("Phone is required when SMS consent is checked.", 400);
    }

    console.log("Signup request received:", {
      name: safeName,
      email: safeEmail,
      company: safeCompany,
      phone: safePhone,
      sms_opt_in: safeSmsOptIn,
    });

    // ----- Create Supabase Auth user -----
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
          // app-level flags (your app decides what "verified" means)
          email_verified: false,
          phone_verified: safeSmsOptIn ? false : true,
        },
      });

    if (createError || !created?.user) {
      console.error("Supabase auth.admin.createUser error:", createError);

      const msg =
        createError?.message?.toLowerCase().includes("already") === true
          ? "That email is already registered. Please log in instead."
          : "Failed to create user. Please try again.";

      return jsonError(msg, 400, {
        debug: {
          message: createError?.message,
          status: (createError as any)?.status,
        },
      });
    }

    const userId = created.user.id;

    // ----- Create profile row (MINIMAL + SAFE) -----
    // IMPORTANT: this avoids “column does not exist” errors if your profiles table
    // doesn’t have name/company/phone/etc yet.
    const minimalProfilePayload = {
      id: userId,
      email: safeEmail,
    };

    let profileAttempt: "upsert" | "insert" = "upsert";

    // Try upsert first (best case)
    let { error: profileError } = await supabaseServer
      .from("profiles")
      .upsert(minimalProfilePayload, { onConflict: "id" });

    // If upsert fails (ex: no unique constraint on id), try insert as a fallback
    if (profileError) {
      console.error("profiles upsert error, trying insert fallback:", profileError);

      profileAttempt = "insert";
      const insertRes = await supabaseServer
        .from("profiles")
        .insert(minimalProfilePayload);

      profileError = insertRes.error ?? null;
    }

    if (profileError) {
      console.error("Supabase profile write error:", profileError);

      // Cleanup: avoid orphaned auth user
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after profile error:", cleanupErr);
      }

      return jsonError("Failed to create user profile. Please try again.", 500, {
        debug: {
          attempted_profile_payload: minimalProfilePayload,
          attempt: profileAttempt,
          code: (profileError as any).code,
          message: profileError.message,
          details: (profileError as any).details,
          hint: (profileError as any).hint,
        },
      });
    }

    // ----- Email verification code -----
    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    // Delete any old codes for this email so only ONE code is valid at a time
    await supabaseServer.from("email_verification_codes").delete().eq("email", safeEmail);

    const { error: insertError } = await supabaseServer
      .from("email_verification_codes")
      .insert({
        email: safeEmail,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("email_verification_codes insert error:", insertError);

      // Cleanup to avoid "created but can't verify" accounts
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after code insert error:", cleanupErr);
      }

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

      // Cleanup so we don't keep accounts that never got a code
      try {
        await supabaseServer.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.error("Failed cleanup deleteUser after mail error:", cleanupErr);
      }

      return jsonError("Failed to send verification email. Please try again.", 500, {
        debug: {
          message: mailError?.message ?? String(mailError),
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Signup started. A verification code has been sent to your email.",
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
