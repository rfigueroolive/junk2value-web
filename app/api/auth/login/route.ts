// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

function getSupabaseAuthClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE URL/ANON KEY env vars");
  }

  return createClient(url, anonKey);
}

// Supabase has returned different confirmation fields across versions.
// We treat any of these as "confirmed".
function isAuthEmailConfirmed(user: any): boolean {
  return Boolean(
    user?.email_confirmed_at ||
      user?.confirmed_at ||
      user?.confirmedAt ||
      user?.emailConfirmedAt
  );
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAuthClient();

    // 1) Attempt sign-in (using anon key is correct here)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.session || !data?.user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const userId = data.user.id;

    // 2) Determine email confirmation from Auth (source of truth)
    // Sometimes the session user object can be missing confirmation fields,
    // so we double-check via admin API (service role) for reliability.
    let authConfirmed = isAuthEmailConfirmed(data.user);

    if (!authConfirmed) {
      const { data: adminRes, error: adminErr } =
        await supabaseServer.auth.admin.getUserById(userId);

      if (!adminErr && adminRes?.user) {
        authConfirmed = isAuthEmailConfirmed(adminRes.user);
      }
    }

    // 3) Load app-level flags in profiles (used for phone gating + sync)
    const { data: profile, error: profileError } = await supabaseServer
      .from("profiles")
      .select("email_verified, phone_verified, sms_opt_in")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      // Don't allow login if profile isn't wired correctly
      try {
        await supabase.auth.signOut();
      } catch {}
      return NextResponse.json(
        { error: "Account not initialized. Please sign up again." },
        { status: 403 }
      );
    }

    const smsOptIn = profile.sms_opt_in === true;
    const phoneVerified = profile.phone_verified === true;

    // ✅ FIX:
    // Email verification must be based on Supabase Auth confirmation.
    // The profiles.email_verified flag is allowed to lag behind (we sync it best-effort).
    let emailVerified = authConfirmed || profile.email_verified === true;

    // Best-effort sync so your profiles table stays consistent (but never blocks login)
    if (authConfirmed && profile.email_verified !== true) {
      await supabaseServer
        .from("profiles")
        .update({
          email_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);
    }

    // 4) Enforce verification rules
    // If Auth isn't confirmed, block. (This should not happen in your case now.)
    if (!emailVerified) {
      try {
        await supabase.auth.signOut();
      } catch {}
      return NextResponse.json(
        { error: "Please verify your email before logging in." },
        { status: 403 }
      );
    }

    // Phone gating stays app-level (only if they opted into SMS)
    if (smsOptIn && !phoneVerified) {
      try {
        await supabase.auth.signOut();
      } catch {}
      return NextResponse.json(
        { error: "Please verify your phone before logging in." },
        { status: 403 }
      );
    }

    // 5) Return session (Android uses this token)
    return NextResponse.json(
      {
        user: data.user,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          token_type: data.session.token_type,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
