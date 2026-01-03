// src/app/api/auth/send-phone-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import twilio from "twilio";

const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

/**
 * Normalizes US numbers to E.164:
 *  - "9702082722" -> "+19702082722"
 *  - "(970) 208-2722" -> "+19702082722"
 *  - "+19702082722" -> "+19702082722"
 */
function normalizePhoneToE164(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Keep leading + if present, strip everything else non-digit
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");

  if (hasPlus) {
    // E.164 max is 15 digits after +
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // Assume US if they didn't include +
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phone = body?.phone;

    if (!phone || typeof phone !== "string") {
      return jsonError("Phone is required.", 400);
    }

    const to = normalizePhoneToE164(phone);
    if (!to) {
      return jsonError("Phone number must be a valid US number (10 digits) or E.164 (+...).", 400);
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return jsonError(
        "SMS is not configured on the server yet. (Missing Twilio credentials.)",
        500
      );
    }

    // 1) Create code + expiry
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // 2) Store code (so verify-phone-code can validate it)
    // Expected table: phone_verification_codes(phone text, code text, expires_at timestamptz, created_at timestamptz)
    // You can set a UNIQUE constraint on phone and use onConflict: "phone".
    const { error: insertErr } = await supabaseServer
      .from("phone_verification_codes")
      .upsert(
        {
          phone: to,
          code,
          expires_at: expiresAt,
        },
        { onConflict: "phone" }
      );

    if (insertErr) {
      return jsonError("Failed to create phone verification code.", 500, {
        debug: {
          code: (insertErr as any).code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        },
      });
    }

    // 3) Send SMS
    const client = twilio(accountSid, authToken);

    // Professional, short, and clear. (Trial prefix is unavoidable on Twilio trial.)
    const smsBody =
      `Junk2Value: Your phone verification code is ${code}. ` +
      `It expires in ${CODE_EXPIRY_MINUTES} minutes. ` +
      `Do not share this code. Reply STOP to opt out.`;

    await client.messages.create({
      from: fromNumber,
      to,
      body: smsBody,
    });

    return NextResponse.json(
      { success: true, message: "Phone verification code sent." },
      { status: 200 }
    );
  } catch (err: any) {
    return jsonError("Failed to send SMS code.", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}
