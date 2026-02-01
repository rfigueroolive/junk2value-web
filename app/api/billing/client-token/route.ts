import { NextResponse } from "next/server";

function paypalBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function getAccessToken(): Promise<string> {
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
  if (!res.ok) throw new Error(`PayPal token failed (${res.status}): ${raw}`);

  const json = JSON.parse(raw);
  const access = json?.access_token as string | undefined;
  if (!access) throw new Error("PayPal response missing access_token");
  return access;
}

/**
 * POST /api/billing/client-token
 * Returns a PayPal client token for SDKs (safe to send to app).
 */
export async function POST() {
  try {
    const accessToken = await getAccessToken();

    const res = await fetch(`${paypalBase()}/v1/identity/generate-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: `generate-token failed (${res.status})`, detail: raw },
        { status: 500 }
      );
    }

    const json = JSON.parse(raw);
    const clientToken = json?.client_token as string | undefined;

    if (!clientToken) {
      return NextResponse.json(
        { success: false, message: "PayPal response missing client_token" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, client_token: clientToken });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
