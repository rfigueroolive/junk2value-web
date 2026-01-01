// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    if (
      !email ||
      typeof email !== "string" ||
      !code ||
      typeof code !== "string"
    ) {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    // 1) Find matching code row (latest)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", email)
      .eq("code", code)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !codeRow) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // 3) Get the auth user by email (service role)
    const { data: userData, error: userErr } =
      await supabaseServer.auth.admin.getUserByEmail(email);

    if (userErr || !userData?.user) {
      return NextResponse.json(
        { error: "User not found for this email" },
        { status: 404 }
      );
    }

    const userId = userData.user.id;

    // 4) Mark profile as email verified
    // NOTE: If the profile row doesn't exist yet, this update will affect 0 rows.
    // So we upsert a row to guarantee the profile exists.
    const { error: profErr } = await supabaseServer.from("profiles").upsert(
      {
        id: userId,
        email,
        email_verified: true,
      },
      { onConflict: "id" }
    );

    if (profErr) {
      console.error("profiles upsert error:", profErr);
      return NextResponse.json(
        {
          error: "Failed to update profile",
          debug: {
            code: profErr.code,
            message: profErr.message,
            details: profErr.details,
            hint: profErr.hint,
          },
        },
        { status: 500 }
      );
    }

    // 5) Delete the used code row (prevents reuse)
    await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return NextResponse.json({ error: "Failed to verify code" }, { status: 500 });
  }
}
