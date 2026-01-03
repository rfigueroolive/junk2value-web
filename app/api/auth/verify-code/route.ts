// junk2value-web/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, message, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    const safeEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const safeCode = typeof code === "string" ? code.trim() : "";

    if (!safeEmail || !safeCode) {
      return jsonError("Email and code are required", 400);
    }

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
      return jsonError("Invalid or expired code", 400, {
        debug: { codeErr: codeErr ? { message: codeErr.message } : null },
      });
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 3) Get auth user by email (NO getUserByEmail in this supabase-js version)
    // We use listUsers() and search for the matching email.
    const { data: usersData, error: listErr } = await supabaseServer.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listErr) {
      return jsonError("Failed to look up user", 500, {
        debug: { message: listErr.message },
      });
    }

    const matchedUser = usersData?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === safeEmail
    );

    if (!matchedUser?.id) {
      return jsonError("User not found for this email", 404);
    }

    const userId = matchedUser.id;

    // 4) Mark profile as email verified (upsert guarantees row exists)
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

    // 5) Delete the used code row (prevents reuse)
    await supabaseServer.from("email_verification_codes").delete().eq("id", codeRow.id);

    return NextResponse.json({ success: true, message: "Email verified." }, { status: 200 });
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
