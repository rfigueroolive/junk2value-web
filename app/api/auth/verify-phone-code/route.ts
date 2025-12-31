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

    const phoneStr = String(phone).trim();
    const codeStr = String(code).trim();

    // Get the most recent matching code for this phone+code
    const { data, error } = await supabaseServer
      .from("phone_verification_codes")
      .select("id, phone, code, expires_at")
      .eq("phone", phoneStr)
      .eq("code", codeStr)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Expiry check
    const expiresMs = new Date(data.expires_at).getTime();
    if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Mark used (ignore if your table doesn't have `used`)
    try {
      await supabaseServer
        .from("phone_verification_codes")
        .update({ used: true })
        .eq("id", data.id);
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("POST /api/auth/verify-phone-code error:", err);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  }
}
