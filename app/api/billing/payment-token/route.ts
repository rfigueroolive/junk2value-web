import { NextRequest, NextResponse } from "next/server";

function paypalBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");

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
  if (!res.ok) throw new Error(`PayPal OAuth failed (${res.status}): ${raw}`);

  const json = JSON.parse(raw);
  const access = json?.access_token as string | undefined;
  if (!access) throw new Error("PayPal response missing access_token");
  return access;
}

/**
 * POST /api/billing/payment-token
 * Body: { "setup_token_id": "..." }
 * Returns: { success: true, payment_token_id: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const setupTokenId = (body?.setup_token_id || "").toString().trim();
    if (!setupTokenId) return jsonError("Missing setup_token_id");

    const accessToken = await getPayPalAccessToken();

    const res = await fetch(`${paypalBase()}/v3/vault/payment-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment_source: {
          token: {
            type: "SETUP_TOKEN",
            id: setupTokenId,
          },
        },
      }),
      cache: "no-store",
    });

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: `payment-token failed (${res.status})`, detail: raw },
        { status: 500 }
      );
    }

    const json = JSON.parse(raw);
    const paymentTokenId = (json?.id as string | undefined) || "";
    if (!paymentTokenId) return jsonError("PayPal response missing payment token id", 500);

    return NextResponse.json({ success: true, payment_token_id: paymentTokenId });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}
