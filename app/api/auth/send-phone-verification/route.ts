// app/api/auth/send-phone-verification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import twilio from "twilio";

const CODE_EXPIRY_MINUTES = 10;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

// Simple helper to normalize phone into E.164 (US-biased)
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();

  // If user already typed +1970... just trust it
  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  // Strip everything that isn't a digit
  const digits = trimmed.replace(/\D/g, "");

  // 10 digits → assume US and prefix +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 → +1XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Fallback: just slap a + on it so Twilio gives a clear error
  return `+${digits}`;
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  if (!accountSid || !authToken || !fromNumber) {
    console.error("Twilio env vars missing.");
    return NextResponse.json(
      {
        success: false,
        message:
          "SMS is not configured on the server yet. (Missing Twilio credentials.)",
      },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as { phone?: string };

    let { phone } = body;
    if (!phone || !phone.trim()) {
      return NextResponse.json(
        { success: false, message: "Phone number is required." },
        { status: 400 }
      );
    }

    // Normalize for Twilio
    const normalizedPhone = normalizePhone(phone);
    console.log("Phone verification requested for:", {
      raw: phone,
      normalized: normalizedPhone,
    });

    // Generate code + expiry
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    const supabase = supabaseServer;

    // Store the code in Supabase
    const { error: insertError } = await supabase
      .from("phone_verification_codes")
      .insert({
        phone: normalizedPhone,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Supabase insert error (phone_verification_codes):", insertError);
      return NextResponse.json(
        {
          success: false,
          message: "Failed to create phone verification code. Please try again.",
        },
        { status: 500 }
      );
    }

    // Send SMS via Twilio
    const client = twilio(accountSid, authToken);

    try {
      const message = await client.messages.create({
        body: `Your Junk2Value phone verification code is: ${code}`,
        to: normalizedPhone,
        from: fromNumber,
      });

      console.log("Twilio SMS sent:", {
        sid: message.sid,
        status: message.status,
        to: message.to,
      });

      return NextResponse.json(
        {
          success: true,
          message: "Verification code SMS sent.",
          twilioStatus: message.status,
        },
        { status: 200 }
      );
    } catch (twErr: any) {
      console.error("Twilio send error:", twErr);

      // Twilio errors usually have twErr.code / twErr.message
      const msg =
        twErr?.message ||
        "SMS provider rejected the request. Check Twilio logs for details.";

      return NextResponse.json(
        {
          success: false,
          message: msg,
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error("Error in POST /api/auth/send-phone-verification:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected server error while sending SMS.",
      },
      { status: 500 }
    );
  }
}
