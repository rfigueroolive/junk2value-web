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

    const safeEmail = email.trim().toLowerCase();
    const safeCode = code.trim();

    // 1) Find matching code row (latest)
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", safeEmail)
      .eq("code", safeCode)
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
    // Some Supabase SDK versions don't have getUserByEmail(), so we list users and match.
    const { data: listData, error: listErr } =
      await supabaseServer.auth.admin.listUsers({ page: 1, perPage: 200 });

    if (listErr || !listData?.users) {
      return NextResponse.json(
        {
          error: "Failed to lookup user",
          debug: {
            code: listErr?.code,
            message: listErr?.message,
            details: (listErr as any)?.details,
            hint: (listErr as any)?.hint,
          },
        },
        { status: 500 }
      );
    }

    const foundUser = listData.users.find(
      (u) => (u.email ?? "").toLowerCase() === safeEmail
    );

    if (!foundUser) {
      return NextResponse.json(
        { error: "User not found for this email" },
        { status: 404 }
      );
    }

    const userId = foundUser.id;

    // 4) Mark profile as email verified
    // Upsert guarantees the profile exists.
    const { error: profErr } = await supabaseServer.from("profiles").upsert(
      {
        id: userId,
        email: safeEmail,
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
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
