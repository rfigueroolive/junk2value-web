import { NextRequest, NextResponse } from "next/server";
import { sendFromNoreply } from "@/lib/mailgun";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to");

    if (!to) {
      return NextResponse.json(
        { error: "Missing 'to' query param" },
        { status: 400 }
      );
    }

    await sendFromNoreply(
      to,
      "Junk2Value test email",
      "If you see this, Mailgun + noreply@junk2value.com works!"
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Test email error:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
