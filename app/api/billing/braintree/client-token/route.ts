// app/api/billing/braintree/client-token/route.ts
import { NextResponse } from "next/server";
import braintree from "braintree";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getGateway() {
  // "sandbox" or "production"
  const btEnv = (process.env.BRAINTREE_ENV || "sandbox").toLowerCase();

  return new braintree.BraintreeGateway({
    environment:
      btEnv === "production"
        ? braintree.Environment.Production
        : braintree.Environment.Sandbox,
    merchantId: env("BRAINTREE_MERCHANT_ID"),
    publicKey: env("BRAINTREE_PUBLIC_KEY"),
    privateKey: env("BRAINTREE_PRIVATE_KEY"),
  });
}

// GET /api/billing/braintree/client-token
export async function GET() {
  try {
    const gateway = getGateway();

    const result = await gateway.clientToken.generate({});
    return NextResponse.json({
      success: true,
      clientToken: result.clientToken,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        message: e?.message || "Failed to generate client token",
      },
      { status: 500 }
    );
  }
}
