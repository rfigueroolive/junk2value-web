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
      return jsonError("Invalid or expired code", 400);
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400);
    }

    // 3) Get userId (prefer profiles lookup because listUsers paging can miss)
    let userId: string | null = null;

    const profLookup = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", safeEmail)
      .maybeSingle();

    if (profLookup.data?.id) {
      userId = profLookup.data.id as string;
    }

    // Fallback: listUsers and match by email
    if (!userId) {
      const { data: usersData, error: listErr } = await supabaseServer.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (listErr) {
        return jsonError("Failed to look up user", 500, { debug: { message: listErr.message } });
      }

      const matchedUser = usersData?.users?.find((u) => (u.email ?? "").toLowerCase() === safeEmail);
      if (matchedUser?.id) userId = matchedUser.id;
    }

    if (!userId) {
      return jsonError("User not found for this email", 404);
    }

    // 4) Update SUPABASE AUTH USER METADATA ✅ (this is what your login gate is checking)
    const { data: authUserRes, error: getErr } = await supabaseServer.auth.admin.getUserById(userId);
    if (getErr || !authUserRes?.user) {
      return jsonError("Failed to load auth user", 500, { debug: { message: getErr?.message } });
    }

    const prevMeta = (authUserRes.user.user_metadata ?? {}) as Record<string, any>;

    const { error: updateErr } = await supabaseServer.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...prevMeta,
        email_verified: true,
      },
    });

    if (updateErr) {
      return jsonError("Failed to update auth metadata", 500, { debug: { message: updateErr.message } });
    }

    // 5) Best-effort: also mark in profiles (don’t hard-fail if column doesn’t exist)
    try {
      await supabaseServer
        .from("profiles")
        .update({ email_verified: true })
        .eq("id", userId);
    } catch {
      // ignore
    }

    // 6) Delete the used code row (prevents reuse)
    await supabaseServer.from("email_verification_codes").delete().eq("id", codeRow.id);

    return NextResponse.json({ success: true, message: "Email verified." }, { status: 200 });
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
