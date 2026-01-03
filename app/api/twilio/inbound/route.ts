// app/api/twilio/inbound/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// Twilio expects TwiML (XML) responses for inbound SMS webhooks.
function twiml(message: string) {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Message>${escapeXml(message)}</Message></Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeXml(str: string) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeKeyword(body: string) {
  // Twilio sends the full body; we only care about the first "word" command.
  const first = body.trim().split(/\s+/)[0] ?? "";
  return first.toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    // Twilio sends application/x-www-form-urlencoded
    const raw = await req.text();
    const params = new URLSearchParams(raw);

    const from = (params.get("From") ?? "").trim(); // e.g. +19702082722
    const body = (params.get("Body") ?? "").trim();

    if (!from) {
      // If Twilio can't provide From, just respond politely.
      return twiml("Missing sender number.");
    }

    const keyword = normalizeKeyword(body);

    // STOP keywords per common carrier conventions
    const isStop =
      keyword === "STOP" ||
      keyword === "STOPALL" ||
      keyword === "UNSUBSCRIBE" ||
      keyword === "CANCEL" ||
      keyword === "END" ||
      keyword === "QUIT";

    const isStart = keyword === "START";
    const isHelp = keyword === "HELP";

    // ✅ IMPORTANT: supabaseServer is a client object in this codebase (NOT a function)
    const sb = supabaseServer;

    // Always log the inbound message + keep opt state in one place
    const nowIso = new Date().toISOString();

    if (isStop) {
      await sb.from("sms_opt_outs").upsert(
        {
          phone_e164: from,
          opted_out: true,
          opted_out_at: nowIso,
          last_inbound_body: body,
          last_inbound_at: nowIso,
        },
        { onConflict: "phone_e164" }
      );

      return twiml(
        "Junk2Value: You’re opted out and will no longer receive texts. Reply START to opt back in."
      );
    }

    if (isStart) {
      await sb.from("sms_opt_outs").upsert(
        {
          phone_e164: from,
          opted_out: false,
          // keep opted_out_at as last time they opted out; not critical either way
          last_inbound_body: body,
          last_inbound_at: nowIso,
        },
        { onConflict: "phone_e164" }
      );

      return twiml("Junk2Value: You’re opted back in. Reply STOP to opt out again.");
    }

    if (isHelp) {
      return twiml(
        "Junk2Value Help: Reply STOP to opt out, START to opt back in. For support, reply here or email support@junk2value.com."
      );
    }

    // Default behavior: don’t change opt status; just acknowledge
    await sb.from("sms_opt_outs").upsert(
      {
        phone_e164: from,
        // Do NOT force opted_out either way here; only set it on STOP/START.
        last_inbound_body: body,
        last_inbound_at: nowIso,
      },
      { onConflict: "phone_e164" }
    );

    return twiml("Junk2Value: Got it. Reply HELP for options.");
  } catch (_err) {
    // Never throw raw errors back to Twilio; just respond with TwiML.
    return twiml("Junk2Value: Sorry—something went wrong on our end.");
  }
}
