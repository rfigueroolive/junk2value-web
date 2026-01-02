// app/api/auth/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, error: message, message, ...(extra ?? {}) },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailRaw = body?.email;
    const codeRaw = body?.code;

    if (typeof emailRaw !== "string" || typeof codeRaw !== "string") {
      return jsonError("Email and code are required", 400);
    }

    // ✅ Normalize so it matches how signup/store likely saved it
    const email = emailRaw.trim().toLowerCase();
    const code = codeRaw.trim();

    if (!email || !code) {
      return jsonError("Email and code are required", 400);
    }

    // 1) Find a matching code row for this email + code
    const { data: codeRow, error: codeErr } = await supabaseServer
      .from("email_verification_codes")
      .select("id, expires_at")
      .eq("email", email)
      .eq("code", code)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr) {
      return jsonError("Database error looking up code", 500, {
        debug: {
          codeErr: {
            code: (codeErr as any).code,
            message: codeErr.message,
            details: (codeErr as any).details,
            hint: (codeErr as any).hint,
          },
        },
      });
    }

    // No row matched email+code
    if (!codeRow) {
      return jsonError("Invalid or expired code", 400, {
        debug: { codeErr: null },
      });
    }

    // 2) Expiry check
    const expiresAtMs = new Date(codeRow.expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return jsonError("Invalid or expired code", 400, {
        debug: { codeErr: null },
      });
    }

    // 3) Mark profile as email verified (no admin.getUserByEmail)
    const { data: updatedProfile, error: profErr } = await supabaseServer
      .from("profiles")
      .update({ email_verified: true })
      .eq("email", email)
      .select("id, email_verified")
      .maybeSingle();

    if (profErr) {
      return jsonError("Failed to update profile", 500, {
        debug: {
          profErr: {
            code: (profErr as any).code,
            message: profErr.message,
            details: (profErr as any).details,
            hint: (profErr as any).hint,
          },
        },
      });
    }

    // If update matched 0 rows, your profile row doesn’t exist (schema mismatch / signup failed earlier)
    if (!updatedProfile) {
      return jsonError("Profile row not found for this email", 500, {
        debug: { note: "No profiles row matched eq(email)" },
      });
    }

    // 4) Delete the used code so it can't be reused
    await supabaseServer.from("email_verification_codes").delete().eq("id", codeRow.id);

    return NextResponse.json(
      { success: true, message: "Email verified." },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("verify-code error:", err);
    return jsonError("Failed to verify code", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
