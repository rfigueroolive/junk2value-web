// app/lib/twilio.ts
import Twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

// Simple guard so we don't blow up if env vars are missing in dev
if (!accountSid || !authToken || !fromNumber) {
  console.warn(
    "[Twilio] Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER. " +
      "SMS sending will be disabled."
  );
}

const twilioClient =
  accountSid && authToken ? Twilio(accountSid, authToken) : null;

/**
 * Send a simple numeric verification code via SMS.
 *
 * Returns true on success, false on failure.
 */
export async function sendVerificationSms(
  to: string,
  code: string
): Promise<boolean> {
  if (!twilioClient || !fromNumber) {
    console.warn("[Twilio] Client not initialized; skipping SMS send.");
    return false;
  }

  try {
    await twilioClient.messages.create({
      from: fromNumber,
      to,
      body: `Your Junk2Value verification code is: ${code}`,
    });
    return true;
  } catch (err) {
    console.error("[Twilio] Failed to send SMS", err);
    return false;
  }
}
