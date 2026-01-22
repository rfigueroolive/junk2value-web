// src/app/api/legal/pickup-sell/accept/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import crypto from "crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

// ✅ pdf-lib + crypto => run on Node (not Edge)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "legal-docs"; // ✅ use the bucket you already created
const DOC_TYPE = "pickup_sell_terms";
const VERSION = "v1";
const SALE_TIMEFRAME_DAYS = 30;
const PAYOUT_PERCENT = 25;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function toCleanString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length ? s : null;
}

function firstIpFromForwarded(forwarded: string | null): string | null {
  if (!forwarded) return null;
  // x-forwarded-for can be "ip, ip, ip"
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
}

function wrapText(text: string, maxLen: number): string[] {
  const out: string[] = [];
  const paragraphs = text.split("\n");

  for (const p of paragraphs) {
    const line = p.trim();
    if (!line) {
      out.push("");
      continue;
    }

    const words = line.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > maxLen) {
        if (cur) out.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
  }

  return out;
}

function buildTermsBodyText() {
  return `1) What Pickup & Sell Is
Pickup & Sell is a convenience service for items you want removed. Junk2Value may attempt to sell your item(s). Pickup & Sell is not a guaranteed sales service and is not intended for customers seeking maximum profit.

2) No Guarantee of Sale
Junk2Value does not guarantee that any item will sell.

3) Pricing & Timing Control
You authorize Junk2Value to determine the listing price, any markdowns/discounts over time, the platform(s) used to sell, and the schedule/timing of sales efforts. Junk2Value may reduce prices as needed to attempt a sale.

4) Payout Percentage
If an item sells, you will receive ${PAYOUT_PERCENT}% of the net sale proceeds. Net sale proceeds means the amount actually received after marketplace/payment fees, refunds, chargebacks, or similar deductions (if applicable).

5) Payout Timing
Payouts are typically issued within approximately 7 business days after the sale is finalized and funds are confirmed received/cleared.

6) Prohibited / Illegal Items
You represent that you have the legal right to provide the item(s) and that the items are not stolen and do not violate any laws or platform rules. Junk2Value may refuse any item for any reason.

7) Time Limit / Ownership After Time Limit
If an item is not sold within ${SALE_TIMEFRAME_DAYS} days from pickup, you authorize Junk2Value to dispose, donate, recycle, or keep the item at Junk2Value’s discretion. After this time limit, you waive any claim to the item.

8) Cancellation Policy
You may cancel a Pickup & Sell request only before the item status is marked “Picked Up.” Once marked “Picked Up,” the request cannot be canceled and the item cannot be returned.

9) No Storage Guarantee / No Return Promise
Junk2Value is not a storage company. Once picked up, return is not guaranteed.

10) Acceptance & Records
By agreeing, you confirm you read and accept these Terms. A record of acceptance (including a PDF copy) may be stored for compliance and dispute resolution.

Support: support@junk2value.com
`;
}

async function generateTermsPdfBytes(acceptedName: string, acceptedAtISO: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = [612, 792]; // US Letter
  const margin = 48;
  const lineHeight = 14;

  let page = doc.addPage(pageSize);
  let y = pageSize[1] - margin;

  const drawLine = (text: string, size = 10.5, bold = false) => {
    page.drawText(text, { x: margin, y, size, font: bold ? fontBold : font });
    y -= lineHeight;
  };

  const ensureRoom = (neededLines: number) => {
    const minY = margin + 40;
    if (y - neededLines * lineHeight < minY) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - margin;
    }
  };

  // Title
  ensureRoom(3);
  drawLine(`Junk2Value Pickup & Sell Terms (${VERSION})`, 16, true);
  y -= 10;

  // Meta
  const meta = `Accepted Name: ${acceptedName}\nAccepted At (UTC): ${acceptedAtISO}`;
  const metaLines = wrapText(meta, 90);
  ensureRoom(metaLines.length + 1);
  for (const line of metaLines) drawLine(line, 11, false);
  y -= 10;

  // Body
  const body = buildTermsBodyText();
  const lines = wrapText(body, 100);

  for (const line of lines) {
    if (line === "") {
      ensureRoom(1);
      y -= lineHeight;
      continue;
    }
    ensureRoom(1);
    drawLine(line, 10.5, false);
  }

  return await doc.save();
}

// POST /api/legal/pickup-sell/accept
// Body: { accepted_name: string }
// Auth: Authorization: Bearer <access_token>
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token", 401);

    const { data: userRes, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userRes?.user?.id) return jsonError("Invalid/expired session token", 401);

    const userId = userRes.user.id;
    const email = userRes.user.email ?? null;

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const acceptedName = toCleanString(body?.accepted_name);
    if (!acceptedName) return jsonError("accepted_name is required", 400);

    // ✅ Your project uses: profile_id = auth user id
    const profileId = userId;

    // 1) Already accepted?
    const existing = await supabaseServer
      .from("legal_acceptances")
      .select("id, pdf_path, accepted_at, version")
      .eq("profile_id", profileId)
      .eq("doc_type", DOC_TYPE)
      .eq("version", VERSION)
      .maybeSingle();

    if (existing.error) {
      return jsonError("Failed checking legal acceptance", 500, { error: existing.error.message });
    }

    if (existing.data?.pdf_path) {
      const signed = await supabaseServer.storage
        .from(BUCKET)
        .createSignedUrl(existing.data.pdf_path, 60 * 60 * 24 * 7);

      return NextResponse.json(
        {
          success: true,
          alreadyAccepted: true,
          doc_type: DOC_TYPE,
          version: VERSION,
          accepted_at: existing.data.accepted_at,
          pdf_path: existing.data.pdf_path,
          pdf_signed_url: signed.data?.signedUrl ?? null,
          payout_percent: PAYOUT_PERCENT,
          sale_timeframe_days: SALE_TIMEFRAME_DAYS,
          email,
        },
        { status: 200 }
      );
    }

    // 2) Generate PDF
    const acceptedAtISO = new Date().toISOString();
    const pdfBytes = await generateTermsPdfBytes(acceptedName, acceptedAtISO);

    // 3) Hash (proof)
    const sha256 = crypto.createHash("sha256").update(Buffer.from(pdfBytes)).digest("hex");

    // 4) Upload to Storage (private bucket recommended)
    const safeTimestamp = acceptedAtISO.replace(/[:.]/g, "-");
    const uuid = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
    const path = `pickup-sell/${VERSION}/${profileId}/${safeTimestamp}-${uuid}.pdf`;

    const up = await supabaseServer.storage.from(BUCKET).upload(path, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: false,
    });

    if (up.error) {
      return jsonError("Failed to store signed Terms PDF", 500, { error: up.error.message });
    }

    // 5) Insert acceptance record (handle race/duplicate gracefully)
    const ip = firstIpFromForwarded(req.headers.get("x-forwarded-for"));
    const ua = req.headers.get("user-agent");

    const ins = await supabaseServer.from("legal_acceptances").insert([
      {
        profile_id: profileId,
        doc_type: DOC_TYPE,
        version: VERSION,
        accepted_at: acceptedAtISO,
        accepted_name: acceptedName,
        pdf_path: path,
        pdf_sha256: sha256,
        ip_address: ip,
        user_agent: ua ?? null,
      },
    ]);

    if (ins.error) {
      // If unique index tripped, fetch existing and return it
      const msg = (ins.error.message ?? "").toLowerCase();
      const looksDuplicate = msg.includes("duplicate") || msg.includes("unique");

      if (looksDuplicate) {
        const again = await supabaseServer
          .from("legal_acceptances")
          .select("id, pdf_path, accepted_at, version")
          .eq("profile_id", profileId)
          .eq("doc_type", DOC_TYPE)
          .eq("version", VERSION)
          .maybeSingle();

        if (!again.error && again.data?.pdf_path) {
          const signed = await supabaseServer.storage
            .from(BUCKET)
            .createSignedUrl(again.data.pdf_path, 60 * 60 * 24 * 7);

          return NextResponse.json(
            {
              success: true,
              alreadyAccepted: true,
              doc_type: DOC_TYPE,
              version: VERSION,
              accepted_at: again.data.accepted_at,
              pdf_path: again.data.pdf_path,
              pdf_signed_url: signed.data?.signedUrl ?? null,
              payout_percent: PAYOUT_PERCENT,
              sale_timeframe_days: SALE_TIMEFRAME_DAYS,
              email,
            },
            { status: 200 }
          );
        }
      }

      return jsonError("Failed to record legal acceptance", 500, {
        error: ins.error.message,
        pdf_path: path,
      });
    }

    const signed = await supabaseServer.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);

    return NextResponse.json(
      {
        success: true,
        alreadyAccepted: false,
        doc_type: DOC_TYPE,
        version: VERSION,
        accepted_at: acceptedAtISO,
        pdf_path: path,
        pdf_signed_url: signed.data?.signedUrl ?? null,
        payout_percent: PAYOUT_PERCENT,
        sale_timeframe_days: SALE_TIMEFRAME_DAYS,
        email,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("POST /api/legal/pickup-sell/accept error:", err);
    return jsonError("Server error", 500, { error: err?.message ?? String(err) });
  }
}
