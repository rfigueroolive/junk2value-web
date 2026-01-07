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

// Some Supabase versions return email confirmation on different fields.
// We accept any of these as "confirmed".
function isAuthEmailConfirmed(user: any): boolean {
  return Boolean(
    user?.email_confirmed_at || user?.confirmed_at || user?.confirmedAt
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

    // 1) Attempt sign-in
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

    // 2) Load app-level verification flags in profiles
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
    let emailVerified = profile.email_verified === true;
    const phoneVerified = profile.phone_verified === true;

    // 🔥 Key fix:
    // If Supabase Auth says the email is confirmed, but our profile flag is still false,
    // automatically sync it so the user isn't stuck.
    const authConfirmed = isAuthEmailConfirmed(data.user);

    if (authConfirmed && !emailVerified) {
      const { error: syncErr } = await supabaseServer
        .from("profiles")
        .update({
          email_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (!syncErr) {
        emailVerified = true;
      }
      // If sync fails, we fall through and still enforce the flag (safer than letting it pass).
    }

    // 3) Enforce verification rules
    if (!emailVerified) {
      try {
        await supabase.auth.signOut();
      } catch {}
      return NextResponse.json(
        { error: "Please verify your email before logging in." },
        { status: 403 }
      );
    }

    if (smsOptIn && !phoneVerified) {
      try {
        await supabase.auth.signOut();
      } catch {}
      return NextResponse.json(
        { error: "Please verify your phone before logging in." },
        { status: 403 }
      );
    }

    // 4) Return session (Android uses this token)
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
