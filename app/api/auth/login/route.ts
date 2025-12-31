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

    const supabaseAuth = getSupabaseAuthClient();

    // Step 1: authenticate (password check)
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
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

    // Step 2: enforce verification status from profiles
    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("email_verified, phone_verified, sms_opt_in")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: "Profile not found for this user." },
        { status: 403 }
      );
    }

    // Email must be verified for everyone
    if (profile.email_verified !== true) {
      return NextResponse.json(
        { error: "Email not verified.", needs: "email" },
        { status: 403 }
      );
    }

    // Phone must be verified only if sms_opt_in is true
    if (profile.sms_opt_in === true && profile.phone_verified !== true) {
      return NextResponse.json(
        { error: "Phone not verified.", needs: "phone" },
        { status: 403 }
      );
    }

    // Step 3: return session for the Android app
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
