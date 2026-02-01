import { NextRequest, NextResponse } from "next/server";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function paypalBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }

  const base = paypalBase();
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`PayPal token failed (${resp.status}): ${raw}`);
  }

  const json = JSON.parse(raw);
  const accessToken = json.access_token as string | undefined;
  if (!accessToken) throw new Error("PayPal access_token missing");
  return accessToken;
}

/**
 * POST /api/billing/setup-token
 * Returns: { success: true, setup_token_id: "..." }
 */
export async function POST(_req: NextRequest) {
  try {
    const accessToken = await getPayPalAccessToken();
    const base = paypalBase();

    // Create a Vault Setup Token for cards (empty card object).
    // Android SDK will attach the actual card details during vaulting.
    const resp = await fetch(`${base}/v3/vault/setup-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment_source: {
          card: {},
        },
      }),
    });

    const raw = await resp.text();
    if (!resp.ok) {
      return jsonError(`Setup-token failed (${resp.status}): ${raw}`, 500);
    }

    const json = JSON.parse(raw);
    const id = (json.id as string | undefined) || "";
    if (!id) return jsonError("PayPal setup token id missing in response", 500);

    return NextResponse.json({ success: true, setup_token_id: id });
  } catch (e: any) {
    return jsonError(e?.message || "Unknown server error", 500);
  }
}
