import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

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
    const nowIso = new Date().toISOString();

    // Try exact match first (and let DB enforce not-expired)
    let { data, error } = await supabaseServer
      .from("phone_verification_codes")
      .select("id, phone, code, expires_at")
      .eq("phone", phoneStr)
      .eq("code", codeStr)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback: match by last 10 digits (handles "+1" vs "970..." formatting)
    if ((!data || error) && digitsOnly(phoneStr).length >= 10) {
      const last10 = digitsOnly(phoneStr).slice(-10);

      const res = await supabaseServer
        .from("phone_verification_codes")
        .select("id, phone, code, expires_at")
        .eq("code", codeStr)
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
      return NextResponse.json(
        { success: false, message: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Mark used (only if column exists)
    try {
      await supabaseServer
        .from("phone_verification_codes")
        .update({ used: true })
        .eq("id", data.id);
    } catch {}

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("POST /api/auth/verify-phone-code error:", err);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  }
}
