// src/app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, error: message, message, ...(extra ?? {}) },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    const safeEmail = (typeof email === "string" ? email : "").trim().toLowerCase();
    const safeCode = (typeof code === "string" ? code : "").trim();

    if (!safeEmail || !safeCode) {
      return jsonError("Email and code are required", 400);
    }

    // 1) Pull recent codes for this email (don’t assume latest is the one they typed)
    const { data: rows, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, code, expires_at, created_at")
      .eq("email", safeEmail)
      .order("created_at", { ascending: false })
      .limit(20);

    if (codeErr || !rows || rows.length === 0) {
      return jsonError("Invalid or expired code", 400, {
        debug: { codeErr: codeErr ?? null, found: rows?.length ?? 0 },
      });
    }

    // 2) Find a matching NON-expired row
    const now = Date.now();
    const match = rows.find((r) => {
      const stored = String(r.code ?? "").trim();
      const expMs = new Date(r.expires_at).getTime();
      const notExpired = Number.isFinite(expMs) && now <= expMs;
      return notExpired && stored === safeCode;
    });

    if (!match) {
      return jsonError("Invalid or expired code", 400, {
        debug: { found: rows.length, note: "No non-expired match among recent codes" },
      });
    }

    // 3) Get auth user by email (service role)
    const { data: userData, error: userErr } =
      await supabaseServer.auth.admin.getUserByEmail(safeEmail);

    if (userErr || !userData?.user) {
      return jsonError("User not found for this email", 404, {
        debug: { userErr: userErr ?? null },
      });
    }

    const userId = userData.user.id;

    // 4) Mark profile email verified (upsert so it works even if profile row is missing)
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

    // 5) Delete the code that matched (and optionally clean up old ones)
    await supabaseServer.from("email_verification_codes").delete().eq("id", match.id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500);
  }
}
