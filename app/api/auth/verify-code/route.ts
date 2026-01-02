// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function normEmail(v: unknown) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = normEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    if (!email || !code) {
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

    // 3) Find the auth user by email (service role)
    // NOTE: Your supabase-js/types don't include getUserByEmail(), so we list and match.
    const { data: usersData, error: usersErr } =
      await supabaseServer.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (usersErr) {
      console.error("listUsers error:", usersErr);
      return NextResponse.json(
        {
          error: "Failed to look up user",
          debug: {
            code: usersErr.code,
            message: usersErr.message,
          },
        },
        { status: 500 }
      );
    }

    const user = usersData?.users?.find(
      (u) => (u.email ?? "").trim().toLowerCase() === email
    );

    if (!user) {
      return NextResponse.json(
        { error: "User not found for this email" },
        { status: 404 }
      );
    }

    const userId = user.id;

    // 4) Mark profile as email verified (upsert so it exists)
    const { error: profErr } = await supabaseServer.from("profiles").upsert(
      {
        id: userId,
        email,
        email_verified: true,
        updated_at: new Date().toISOString(),
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
    const { error: delErr } = await supabaseServer
      .from("email_verification_codes")
      .delete()
      .eq("id", codeRow.id);

    if (delErr) {
      // Not fatal, but good to know
      console.warn("Failed to delete used email code row:", delErr);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
