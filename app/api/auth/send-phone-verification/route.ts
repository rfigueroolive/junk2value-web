// junk2value-web/app/api/auth/send-phone-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import twilio from "twilio";

const CODE_EXPIRY_MINUTES = 10;

// Generate a 6 digit numeric code like "123456"
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, message, ...(extra ?? {}) },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";

    if (!phoneRaw) {
      return jsonError("Phone is required.", 400);
    }

    // Twilio env vars
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return jsonError(
        "SMS is not configured on the server yet. (Missing Twilio credentials.)",
        500
      );
    }

    const code = generateCode();
    const expiresAt = new Date(
      Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    // ✅ IMPORTANT FIX:
    // Don't use upsert/onConflict unless the table has a UNIQUE constraint.
    // Instead: delete any existing codes for this phone, then insert a new one.
    const { error: deleteErr } = await supabaseServer
      .from("phone_verification_codes")
      .delete()
      .eq("phone", phoneRaw);

    if (deleteErr) {
      console.warn("phone_verification_codes delete warning:", deleteErr);
      // Not fatal — we can still try inserting a new code
    }

    const { error: insertErr } = await supabaseServer
      .from("phone_verification_codes")
      .insert({
        phone: phoneRaw,
        code,
        expires_at: expiresAt,
      });

    if (insertErr) {
      console.error("phone_verification_codes insert error:", insertErr);
      return jsonError("Failed to create phone verification code.", 500, {
        debug: {
          code: (insertErr as any).code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        },
      });
    }

    // Professional message (Twilio Trial will still prepend its trial disclaimer automatically)
    const smsBody =
      `Junk2Value: Your verification code is ${code}. ` +
      `It expires in ${CODE_EXPIRY_MINUTES} minutes. ` +
      `Reply STOP to opt out, HELP for help. Msg & data rates may apply.`;

    const client = twilio(accountSid, authToken);

    await client.messages.create({
      from: fromNumber,
      to: phoneRaw,
      body: smsBody,
    });

    return NextResponse.json(
      { success: true, message: "Verification code sent." },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("send-phone-verification error:", err);
    return jsonError("Failed to send verification code.", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
