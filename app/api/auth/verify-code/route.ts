// app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, message, error: message, ...(extra ?? {}) },
    { status }
  );
}

async function createAuthUserFromIntent(intent: any, password: string) {
  // Create the Supabase Auth user (confirmed immediately because code verified)
  const { data: created, error } = await supabaseServer.auth.admin.createUser({
    email: intent.email,
    password,
    email_confirm: true,
    user_metadata: {
      name: intent.name,
      company: intent.company,
      phone: intent.phone,
      sms_opt_in: intent.sms_opt_in === true,
      email_verified: true,
      phone_verified: intent.sms_opt_in ? intent.phone_verified === true : true,
    },
  });

  if (error || !created?.user) {
    return { user: null, error };
  }

  const userId = created.user.id;

  // ✅ IMPORTANT:
  // Keep our profiles table in sync with the reality of verification.
  // This prevents login/API gating or UI badges from getting stuck.
  const smsOptIn = intent.sms_opt_in === true;
  const phoneVerified = smsOptIn ? intent.phone_verified === true : true;

  const { error: upsertErr } = await supabaseServer
    .from("profiles")
    .upsert(
      {
        id: userId,
        email: intent.email,
        // sync flags
        email_verified: true,
        sms_opt_in: smsOptIn,
        phone_verified: phoneVerified,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

  // If this fails, we still created the auth user; return error so you can see it.
  if (upsertErr) {
    return { user: created.user, error: upsertErr };
  }

  return { user: created.user, error: null };
}

export async function POST(req: NextRequest) {
  try {
    const { email, code, password } = await req.json();

    const safeEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const safeCode = typeof code === "string" ? code.trim() : "";

    if (!safeEmail || !safeCode)
      return jsonError("Email and code are required", 400);

    // 1) Validate code
    const { data: codeRow } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", safeEmail)
      .eq("code", safeCode)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!codeRow) return jsonError("Invalid or expired code", 400);

    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 2) Load signup intent
    const { data: intent, error: intentErr } = await supabaseServer
      .from("signup_intents")
      .select("*")
      .eq("email", safeEmail)
      .maybeSingle();

    if (intentErr || !intent) {
      return jsonError(
        "Signup not found for this email. Please sign up again.",
        404
      );
    }

    // 3) Mark email verified on the intent (recordkeeping)
    await supabaseServer
      .from("signup_intents")
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq("email", safeEmail);

    // 4) Consume code
    await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    // 5) If phone required, stop here (last step is phone)
    if (intent.sms_opt_in === true) {
      // NOTE: Account creation happens after phone verification in your flow.
      return NextResponse.json(
        { success: true, next_step: "phone" },
        { status: 200 }
      );
    }

    // 6) Otherwise email is the last step -> finalize account creation NOW
    const pw = typeof password === "string" ? password : "";
    if (!pw) {
      return jsonError(
        "Email verified, but password is required to finalize signup. Send {email, code, password}.",
        400
      );
    }

    const { user, error } = await createAuthUserFromIntent(intent, pw);

    if (error) {
      const msg =
        (error as any)?.message?.toLowerCase().includes("already")
          ? "Account already exists."
          : "Failed to finalize signup.";
      return jsonError(msg, 400, {
        debug: { message: (error as any)?.message ?? String(error) },
        user_created: Boolean(user),
      });
    }

    // Cleanup intent
    await supabaseServer.from("signup_intents").delete().eq("email", safeEmail);

    return NextResponse.json({ success: true, finalized: true }, { status: 200 });
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Server error", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
