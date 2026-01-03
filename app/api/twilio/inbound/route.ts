import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import twilio from "twilio";

/**
 * Twilio inbound SMS webhook
 *
 * Configure in Twilio Console:
 *  Messaging -> Services -> (your service) -> Inbound Settings
 *  "Incoming Messages" webhook:
 *    https://www.junk2value.com/api/twilio/inbound   (POST)
 *
 * What it does:
 *  - STOP / UNSUBSCRIBE / CANCEL / END / QUIT  -> mark opted_out=true
 *  - START / YES / UNSTOP                      -> mark opted_out=false
 *  - HELP / INFO                               -> reply with your help text
 *
 * NOTE: Twilio may also perform its own opt-out enforcement automatically.
 * This route makes it "real" in your database too.
 */

function normalize(s: string) {
  return s.trim().toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    // Twilio sends form-encoded fields
    const from = String(form.get("From") ?? "").trim();
    const body = String(form.get("Body") ?? "").trim();

    if (!from) {
      return new NextResponse("Missing From", { status: 400 });
    }

    const msg = normalize(body);

    const stopWords = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
    const startWords = new Set(["START", "YES", "UNSTOP"]);
    const helpWords = new Set(["HELP", "INFO"]);

    let reply = "";

    if (stopWords.has(msg)) {
      // Save opt-out in DB
      await supabaseServer.from("sms_preferences").upsert(
        { phone: from, opted_out: true, updated_at: new Date().toISOString() },
        { onConflict: "phone" }
      );

      reply =
        "Junk2Value: You’re opted out and will no longer receive text messages. Reply START to re-subscribe.";
    } else if (startWords.has(msg)) {
      await supabaseServer.from("sms_preferences").upsert(
        { phone: from, opted_out: false, updated_at: new Date().toISOString() },
        { onConflict: "phone" }
      );

      reply =
        "Junk2Value: You’re re-subscribed. Reply STOP to opt out again.";
    } else if (helpWords.has(msg)) {
      reply =
        "Junk2Value support: Reply STOP to opt out, START to re-subscribe. For help, email support@junk2value.com or call (970) 208-2722.";
    } else {
      // Optional: ignore everything else, or send a generic reply
      reply =
        "Junk2Value: Thanks! For help reply HELP. To stop messages reply STOP.";
    }

    // TwiML response
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    return new NextResponse(twiml.toString(), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e: any) {
    console.error("Twilio inbound webhook error:", e);
    return new NextResponse("Server error", { status: 500 });
  }
}
