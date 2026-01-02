// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    const safeEmail = (typeof email === "string" ? email : "").trim().toLowerCase();
    const safeCode = (typeof code === "string" ? code : "").trim();

    if (!safeEmail || !safeCode) {
      return jsonError("Email and code are required", 400);
    }

    // 1) Get the MOST RECENT code row for this email (don’t filter by code in SQL)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, code, expires_at, created_at")
      .eq("email", safeEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !codeRow) {
      return jsonError("Invalid or expired code", 400, { debug: { codeErr: codeErr ?? null } });
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 3) Compare code in JS to avoid DB type mismatch (int vs string)
    const storedCode = String(codeRow.code).trim();
    if (storedCode !== safeCode) {
      return jsonError("Invalid or expired code", 400);
    }

    // 4) Get the auth user by email (service role)
    const { data: userData, error: userErr } =
      await supabaseServer.auth.admin.getUserByEmail(safeEmail);

    if (userErr || !userData?.user) {
      return jsonError("User not found for this email", 404, {
        debug: { userErr: userErr ?? null },
      });
    }

    const userId = userData.user.id;

    // 5) Mark profile as email verified (upsert so it works even if profile row is missing)
    const { error: profErr } = await supabaseServer.from("profiles").upsert(
      {
        id: userId,
        email: safeEmail,
        email_verified: true,
      },
      { onConflict: "id" }
    );

    if (profErr) {
      return jsonError("Failed to update profile", 500, {
        debug: {
          code: (profErr as any).code,
          message: profErr.message,
          details: (profErr as any).details,
          hint: (profErr as any).hint,
        },
      });
    }

    // 6) Delete the used code row
    await supabaseServer.from("email_verification_codes").delete().eq("id", codeRow.id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500);
  }
}
