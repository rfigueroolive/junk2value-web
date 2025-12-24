// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    if (!email || typeof email !== "string" || !code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    const supabase = supabaseServer;

    // Get the most recent code for this email
    const { data, error } = await supabase
      .from("email_verification_codes")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("Supabase select error:", error);
      return NextResponse.json(
        { error: "Verification lookup failed" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "No verification code found for this email" },
        { status: 400 }
      );
    }

    // Check code matches
    if (data.code !== code) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 }
      );
    }

    // Check not expired
    const now = new Date();
    const expiresAt = new Date(data.expires_at);

    if (expiresAt.getTime() < now.getTime()) {
      return NextResponse.json(
        { error: "Verification code has expired" },
        { status: 400 }
      );
    }

    // Check not already used
    if (data.consumed) {
      return NextResponse.json(
        { error: "Verification code has already been used" },
        { status: 400 }
      );
    }

    // Mark as consumed
    const { error: updateError } = await supabase
      .from("email_verification_codes")
      .update({ consumed: true })
      .eq("id", data.id);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Failed to mark code as used" },
        { status: 500 }
      );
    }

    // All good 🎉
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("verify-code error:", err);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
