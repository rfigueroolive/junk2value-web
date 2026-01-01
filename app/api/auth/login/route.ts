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

    // 2) Check our app-level verification flags in profiles
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

    const emailVerified = profile.email_verified === true;
    const smsOptIn = profile.sms_opt_in === true;
    const phoneVerified = profile.phone_verified === true;

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

    // 3) Return session (Android uses this token)
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
