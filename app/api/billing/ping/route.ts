import { NextResponse } from "next/server";

function paypalBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

/**
 * GET /api/billing/ping
 * Verifies server can get a PayPal OAuth access token.
 * Does NOT create charges or expose secrets.
 */
export async function GET() {
  try {
    const clientId = envOrThrow("PAYPAL_CLIENT_ID");
    const secret = envOrThrow("PAYPAL_CLIENT_SECRET");

    const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");

    const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });

    const raw = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: `PayPal token failed (${res.status})`, detail: raw },
        { status: 500 }
      );
    }

    // Don't return the token to the client. Just prove it worked.
    return NextResponse.json({ success: true, message: "PayPal OAuth OK" });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
