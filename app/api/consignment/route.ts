// src/app/api/consignment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function toCleanString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length ? s : null;
}

function parseOptionalPositiveInt(val: any): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const intVal = Math.floor(n);
  return intVal < 1 ? 1 : intVal;
}

function looksLikeMissingColumn(err: any): boolean {
  const msg = (err?.message || err?.details || err?.hint || "").toString().toLowerCase();
  return msg.includes("could not find the") || msg.includes("schema cache") || msg.includes("does not exist");
}

async function getOrCreateProfileIdByEmail(emailRaw: string): Promise<string> {
  const email = emailRaw.trim().toLowerCase();

  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) throw profileErr;
  if (profile?.id) return profile.id as string;

  const { data: created, error: createErr } = await supabaseServer
    .from("profiles")
    .insert([{ email }])
    .select("id")
    .single();

  if (!createErr && created?.id) return created.id as string;

  const { data: again, error: againErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (againErr) throw againErr;
  if (again?.id) return again.id as string;

  throw createErr ?? new Error("Failed to create profile");
}

// Keep this SMALL to avoid timeouts
const OWNER_COLS = ["user_id", "client_id", "profile_id", "owner_id", "created_by"] as const;
const TITLE_COLS = ["title", "item_title", "name", "item_name"] as const;

async function probeSelect(ownerCol: string, ownerValue: string) {
  return await supabaseServer.from("consignment_items").select("*").eq(ownerCol, ownerValue).limit(5);
}

async function probeInsert(payload: Record<string, any>) {
  return await supabaseServer.from("consignment_items").insert([payload]).select().single();
}

// -------------------------
// GET /api/consignment
// Fast-probe for correct owner column then return items.
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const authUserId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, profileId];

    const tried: any[] = [];

    for (const ownerCol of OWNER_COLS) {
      for (const ownerValue of ownerValues) {
        const res = await probeSelect(ownerCol, ownerValue);
        if (!res.error) {
          // Success — now fetch up to 200 with the same ownerCol
          const itemsRes = await supabaseServer
            .from("consignment_items")
            .select("*")
            .eq(ownerCol, ownerValue)
            .limit(200);

          if (itemsRes.error) {
            return jsonError(itemsRes.error.message ?? "Failed to load items", 500, {
              debug: { ownerCol, ownerValue, message: itemsRes.error.message },
            });
          }

          return NextResponse.json(
            { success: true, items: itemsRes.data ?? [], debug_match: { ownerCol, ownerValue } },
            { status: 200 }
          );
        }

        tried.push({ ownerCol, ownerValue, err: res.error?.message });
        if (!looksLikeMissingColumn(res.error)) {
          return jsonError(res.error.message ?? "Failed to load items", 500, {
            debug: { ownerCol, ownerValue, message: res.error.message },
          });
        }
      }
    }

    return jsonError("Could not determine owner column for consignment_items", 500, { debug: { tried } });
  } catch (err: any) {
    return jsonError(err?.message ?? "Server error", 500, { debug: { message: err?.message ?? String(err) } });
  }
}

// -------------------------
// POST /api/consignment
// Fast-probe for correct owner + title columns then insert ONE row.
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization header (Bearer token required)", 401);

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError("Invalid or expired session token", 401);

    const email = userData.user.email?.trim().toLowerCase();
    const authUserId = userData.user.id;
    if (!email) return jsonError("User email missing on session", 400);

    const body = await req.json();

    const itemTitle = toCleanString(body.item_title ?? body.title ?? body.itemName) ?? "";
    const itemDesc = toCleanString(body.item_description ?? body.description ?? body.itemDesc);
    const notes = toCleanString(body.notes ?? body.pickup_notes);
    const itemCount = parseOptionalPositiveInt(body.item_count ?? body.count ?? body.quantity);

    if (!itemTitle) return jsonError("item_title is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const ownerValues = [authUserId, profileId];

    const tried: any[] = [];

    for (const ownerCol of OWNER_COLS) {
      for (const ownerValue of ownerValues) {
        for (const titleCol of TITLE_COLS) {
          const payload: Record<string, any> = {
            [ownerCol]: ownerValue,
            [titleCol]: itemTitle,
          };

          // add common optional fields ONLY if they exist later (don’t guess — just omit for now)
          // keep it minimal to avoid column cache failures + speed
          const res = await probeInsert(payload);

          if (!res.error && res.data) {
            const createdId = (res.data as any)?.id ?? null;

            return NextResponse.json(
              {
                success: true,
                message: "Consignment request created.",
                item_id: createdId,
                id: createdId,
                item: res.data,
                debug_match: { ownerCol, ownerValue, titleCol },
              },
              { status: 201 }
            );
          }

          tried.push({ ownerCol, ownerValue, titleCol, err: res.error?.message });

          // if it’s NOT a missing-column issue, return immediately (real constraint / RLS / etc.)
          if (!looksLikeMissingColumn(res.error)) {
            return jsonError(res.error?.message ?? "Insert failed", 500, {
              debug: { ownerCol, ownerValue, titleCol, message: res.error?.message },
            });
          }
        }
      }
    }

    return jsonError("Could not determine schema for consignment_items insert", 500, { debug: { tried } });
  } catch (err: any) {
    const msg = err?.message ?? err?.error?.message ?? err?.error?.details ?? "Unknown error";
    return jsonError(msg, 500, { debug: { message: msg } });
  }
}
