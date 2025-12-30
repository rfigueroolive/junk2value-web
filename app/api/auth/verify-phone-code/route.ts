// app/api/auth/verify-phone-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json();

    if (!phone || !code) {
      return NextResponse.json(
        { success: false, message: "phone and code are required" },
        { status: 400 }
      );
    }

    // Find a matching, unexpired code
    const { data, error } = await supabaseServer
      .from("phone_verification_codes")
      .select("id, phone, code, expires_at, used")
      .eq("phone", phone)
      .eq("code", code)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Expiry check
    const expiresAt = new Date(data.expires_at).getTime();
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Used check (if your table has it)
    if (data.used === true) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Mark used (safe even if column doesn't exist? if it doesn't, remove this block)
    await supabaseServer
      .from("phone_verification_codes")
      .update({ used: true })
      .eq("id", data.id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("POST /api/auth/verify-phone-code error:", err);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  }
}
