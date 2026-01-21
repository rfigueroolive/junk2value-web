// src/app/api/consignment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// -------------------------
// Helpers
// -------------------------
function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;

  return token?.trim() || null;
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function makeTrackingNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "J2V-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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
  if (intVal < 1) return 1;
  return intVal;
}

function looksLikeMissingColumn(err: any): boolean {
  const msg = (err?.message || err?.details || err?.hint || "").toString().toLowerCase();
  // Supabase/PostgREST common patterns:
  // "Could not find the 'client_id' column of 'consignment_items' in the schema cache"
  // "column consignment_items.client_id does not exist"
  return (
    msg.includes("could not find the") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("unknown column")
  );
}

function looksLikeDuplicateTracking(err: any): boolean {
  const msg = (err?.message || err?.error_description || err?.details || "").toString().toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique") || msg.includes("tracking");
}

// -------------------------
// Profiles (email-only, since your profiles table has no user_id)
// -------------------------
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

  // Handle unique constraint / concurrent insert
  const { data: again, error: againErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (againErr) throw againErr;
  if (again?.id) return again.id as string;

  throw createErr ?? new Error("Failed to create profile");
}

// -------------------------
// Column-guess fallback (no information_schema)
// -------------------------
const OWNER_COLS = [
  "client_id",
  "profile_id",
  "user_id",
  "owner_id",
  "customer_id",
  "account_id",
  "created_by",
  "submitted_by",
] as const;

const TITLE_COLS = ["item_title", "title", "name", "item_name"] as const;
const DESC_COLS = ["item_description", "description", "details", "item_desc"] as const;
const NOTES_COLS = ["notes", "pickup_notes", "comments", "note"] as const;
const COUNT_COLS = ["item_count", "count", "quantity", "qty"] as const;
const STATUS_COLS = ["status", "state"] as const;
const TRACKING_COLS = ["tracking_number", "tracking", "tracking_no"] as const;

async function trySelectByOwner(ownerCol: string, ownerValue: string) {
  // No ordering (created_at might not exist)
  return await supabaseServer
    .from("consignment_items")
    .select("*")
    .eq(ownerCol, ownerValue)
    .limit(200);
}

async function tryInsertOnce(payload: Record<string, any>) {
  return await supabaseServer
    .from("consignment_items")
    .insert([payload])
    .select()
    .single();
}

async function insertConsignmentWithFallback(args: {
  ownerValues: string[]; // tries both authUserId and profileId
  itemTitle: string;
  itemDesc?: string | null;
  itemCount?: number | null;
  notes?: string | null;
}) {
  let lastNonSchemaError: any = null;
  let lastSchemaishError: any = null;

  for (const ownerCol of OWNER_COLS) {
    for (const ownerValue of args.ownerValues) {
      for (const titleCol of TITLE_COLS) {
        // Build a few payload shapes; if a column doesn’t exist, Supabase will error and we move on.
        const base: Record<string, any> = {
          [ownerCol]: ownerValue,
          [titleCol]: args.itemTitle,
        };

        const payloadShapes: Record<string, any>[] = [];

        // 1) minimal
        payloadShapes.push({ ...base });

        // 2) add description (try each possible desc col)
        for (const descCol of DESC_COLS) {
          if (args.itemDesc != null) payloadShapes.push({ ...base, [descCol]: args.itemDesc });
        }

        // 3) add notes
        for (const notesCol of NOTES_COLS) {
          if (args.notes != null) payloadShapes.push({ ...base, [notesCol]: args.notes });
        }

        // 4) add count
        for (const countCol of COUNT_COLS) {
          if (args.itemCount != null) payloadShapes.push({ ...base, [countCol]: args.itemCount });
        }

        // 5) add desc + notes + count combos
        for (const descCol of DESC_COLS) {
          for (const notesCol of NOTES_COLS) {
            for (const countCol of COUNT_COLS) {
              const combo: Record<string, any> = { ...base };
              if (args.itemDesc != null) combo[descCol] = args.itemDesc;
              if (args.notes != null) combo[notesCol] = args.notes;
              if (args.itemCount != null) combo[countCol] = args.itemCount;
              payloadShapes.push(combo);
            }
          }
        }

        // Add status variants
        const withStatus: Record<string, any>[] = [];
        for (const p of payloadShapes) {
          withStatus.push(p); // no status
          for (const statusCol of STATUS_COLS) {
            withStatus.push({ ...p, [statusCol]: "pending" });
          }
        }

        // Add tracking variants (retry on collision)
        for (const p of withStatus) {
          // No tracking
          {
            const { data, error } = await tryInsertOnce(p);
            if (!error && data) return { data, tracking_number: null as string | null };
            if (error) {
              if (looksLikeMissingColumn(error)) {
                lastSchemaishError = error;
              } else {
                lastNonSchemaError = error;
              }
            }
          }

          // With tracking (try each tracking col)
          for (const trackingCol of TRACKING_COLS) {
            let lastErr: any = null;

            for (let i = 0; i < 6; i++) {
              const tracking = makeTrackingNumber();
              const attemptPayload = { ...p, [trackingCol]: tracking };

              const { data, error } = await tryInsertOnce(attemptPayload);
              if (!error && data) {
                const returnedTracking = (data as any)?.[trackingCol] ?? tracking;
                return { data, tracking_number: returnedTracking as string };
              }

              if (error) {
                lastErr = error;
                if (looksLikeMissingColumn(error)) {
                  lastSchemaishError = error;
                  break; // tracking col doesn't exist, stop retrying this trackingCol
                }
                if (!looksLikeDuplicateTracking(error)) {
                  lastNonSchemaError = error;
                  break;
                }
              }
            }

            if (lastErr && !looksLikeMissingColumn(lastErr) && !looksLikeDuplicateTracking(lastErr)) {
              // hard fail errors already recorded
            }
          }
        }
      }
    }
  }

  // Prefer returning a "real" error if we got one, otherwise return the schema cache error
  throw lastNonSchemaError ?? lastSchemaishError ?? new Error("Insert failed");
}

// -------------------------
// GET /api/consignment
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

    const ownerValues = [authUserId, profileId].filter(Boolean);

    const attempted: Array<{ ownerCol: string; ownerValue: string; err?: string }> = [];

    for (const ownerCol of OWNER_COLS) {
      for (const ownerValue of ownerValues) {
        const res = await trySelectByOwner(ownerCol, ownerValue);

        if (!res.error) {
          return NextResponse.json(
            {
              success: true,
              items: res.data ?? [],
              debug_match: { ownerCol, ownerValue },
            },
            { status: 200 }
          );
        }

        // If it's just "column doesn't exist", keep trying. Otherwise, return the error.
        if (!looksLikeMissingColumn(res.error)) {
          return jsonError(res.error.message ?? "Failed to load consignment items", 500, {
            debug: { ownerCol, ownerValue, message: res.error.message },
          });
        }

        attempted.push({ ownerCol, ownerValue, err: res.error.message });
      }
    }

    return jsonError("Could not find a valid owner column on consignment_items.", 500, {
      debug: {
        attempted,
        hint:
          "Your consignment_items table uses a different owner column name than expected. Send a screenshot of the table columns from Supabase.",
      },
    });
  } catch (err: any) {
    console.error("Unexpected error in GET /api/consignment:", err);
    return jsonError(err?.message ?? "Server error", 500, {
      debug: { message: err?.message ?? String(err) },
    });
  }
}

// -------------------------
// POST /api/consignment
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
    const ownerValues = [authUserId, profileId].filter(Boolean);

    const created = await insertConsignmentWithFallback({
      ownerValues,
      itemTitle,
      itemDesc,
      itemCount,
      notes,
    });

    const createdId = (created.data as any)?.id ?? null;

    return NextResponse.json(
      {
        success: true,
        message: "Consignment request created.",
        item_id: createdId,
        id: createdId,
        item: created.data,
        tracking_number: created.tracking_number,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Unexpected error in POST /api/consignment:", err);

    const msg =
      err?.message ??
      err?.error?.message ??
      err?.error?.details ??
      err?.details ??
      "Unknown error";

    return jsonError(msg, 500, { debug: { message: msg } });
  }
}
