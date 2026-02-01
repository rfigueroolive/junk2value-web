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
    const clientId = envOrThrow("AfPtntUAyU3LnazOBNf1FXg2rJNDSinJrWiftvqmsZb5aKPxv4x4_ZjH9gr5ln5ypKX6l5-ubTePCaCI");
    const secret = envOrThrow("EJxb5oggDkUcqKIcKQeQ2Z_Oy8SohlPnZoQr6yhdeAHD0rNj8eoOqyZuIHFjmniZZ2MNqY8oBj_gYDEM");

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
