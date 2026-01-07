// junk2value-web/app/api/auth/verify-phone-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const phone = typeof body.phone === "string" ? body.phone.trim() : String(body.phone ?? "").trim();
    const code = typeof body.code === "string" ? body.code.trim() : String(body.code ?? "").trim();

    // ✅ We need email+password at the FINAL step to actually create the auth user.
    // Your VerifyPhoneActivity already HAS these values — it just needs to send them.
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!phone || !code) {
      return jsonError("phone and code are required", 400);
    }

    const nowIso = new Date().toISOString();

    // ----------------------------
    // 1) Validate phone verification code
    // ----------------------------
    let { data, error } = await supabaseServer
      .from("phone_verification_codes")
      .select("id, phone, code, expires_at")
      .eq("phone", phone)
      .eq("code", code)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback: match by last 10 digits (handles "+1" vs "970..." formatting)
    if ((!data || error) && digitsOnly(phone).length >= 10) {
      const last10 = digitsOnly(phone).slice(-10);

      const res = await supabaseServer
        .from("phone_verification_codes")
        .select("id, phone, code, expires_at")
        .eq("code", code)
        .gt("expires_at", nowIso)
        .order("expires_at", { ascending: false })
        .limit(10);

      if (res.data && res.data.length) {
        data = res.data.find((row) => {
          const rowDigits = digitsOnly(String(row.phone || ""));
          return rowDigits.slice(-10) === last10;
        }) as any;
        error = res.error ?? null;
      }
    }

    if (error || !data) {
      return jsonError("Invalid or expired code", 400);
    }

    // Mark used (only if column exists)
    try {
      await supabaseServer.from("phone_verification_codes").update({ used: true }).eq("id", data.id);
    } catch {}

    // ----------------------------
    // 2) Find the pending signup intent (NEW FLOW)
    // ----------------------------
    const phoneLast10 = digitsOnly(phone).slice(-10);

    let intent = null as any;

    // Try exact phone match first
    const exact = await supabaseServer
      .from("signup_intents")
      .select("id, email, name, company, phone, sms_opt_in, email_verified, phone_verified")
      .eq("phone", phone)
      .maybeSingle();

    if (!exact.error && exact.data) {
      intent = exact.data;
    } else {
      // Fallback: ends-with match (covers +1 formatting)
      if (phoneLast10.length === 10) {
        const fallback = await supabaseServer
          .from("signup_intents")
          .select("id, email, name, company, phone, sms_opt_in, email_verified, phone_verified")
          .ilike("phone", `%${phoneLast10}`)
          .limit(1)
          .maybeSingle();

        if (!fallback.error && fallback.data) {
          intent = fallback.data;
        }
      }
    }

    if (!intent) {
      return jsonError(
        "Signup not found for this phone. Please restart signup.",
        404,
        { debug: { phone, phoneLast10 } }
      );
    }

    // ----------------------------
    // 3) Mark phone verified on signup intent
    // ----------------------------
    const upd = await supabaseServer
      .from("signup_intents")
      .update({ phone_verified: true })
      .eq("id", intent.id);

    if (upd.error) {
      return jsonError("Server error updating phone verification.", 500, {
        debug: { message: upd.error.message },
      });
    }

    // Recompute “fully verified”
    const fullyVerified =
      intent.email_verified === true &&
      (intent.sms_opt_in !== true || true); // phone just got verified

    // If email isn’t verified yet, stop here.
    if (!fullyVerified) {
      return NextResponse.json(
        {
          success: true,
          message: "Phone verified. Please verify email to finish signup.",
          account_created: false,
        },
        { status: 200 }
      );
    }

    // ----------------------------
    // 4) FINAL STEP: Create Supabase Auth user + minimal profile
    // ----------------------------
    // We MUST have password to create the auth user (we are not storing it server-side)
    if (!email || !password) {
      return jsonError(
        "Phone verified, but password is required to finalize signup. Send {email,password} with this request.",
        400,
        { debug: { gotEmail: !!email, gotPassword: !!password } }
      );
    }

    const safeEmail = intent.email?.trim().toLowerCase();
    if (!safeEmail || safeEmail !== email) {
      return jsonError("Email mismatch for this signup intent.", 400, {
        debug: { intentEmail: safeEmail, providedEmail: email },
      });
    }

    // Create Auth user
    const { data: created, error: createErr } = await supabaseServer.auth.admin.createUser({
      email: safeEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: intent.name ?? null,
        company: intent.company ?? null,
        phone: intent.phone ?? null,
        sms_opt_in: intent.sms_opt_in === true,
        email_verified: true,
        phone_verified: true,
      },
    });

    // If already exists, we still consider signup finalized
    const already =
      createErr?.message?.toLowerCase().includes("already") ||
      createErr?.message?.toLowerCase().includes("registered");

    if (createErr && !already) {
      return jsonError("Failed to create user. Please try again.", 500, {
        debug: { message: createErr.message, status: (createErr as any)?.status },
      });
    }

    const userId = created?.user?.id;

    // Create minimal profile (safe even if extra columns don't exist)
    if (userId) {
      const minimalProfilePayload = { id: userId, email: safeEmail };

      // Try upsert, fallback to insert (same pattern as your old signup route)
      let { error: profileError } = await supabaseServer
        .from("profiles")
        .upsert(minimalProfilePayload, { onConflict: "id" });

      if (profileError) {
        const insertRes = await supabaseServer.from("profiles").insert(minimalProfilePayload);
        profileError = insertRes.error ?? null;
      }

      // If profile write fails, do NOT delete auth user here (it can be fixed later),
      // but return a useful error.
      if (profileError) {
        return jsonError("User created, but failed to create profile row.", 500, {
          debug: { message: profileError.message },
        });
      }
    }

    // Cleanup: remove intent so signup can’t be replayed
    await supabaseServer.from("signup_intents").delete().eq("id", intent.id);

    return NextResponse.json(
      {
        success: true,
        message: "Phone verified. Account created.",
        account_created: true,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/auth/verify-phone-code error:", err);
    return NextResponse.json(
      { success: false, message: "Server error", error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
