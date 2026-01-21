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

function looksLikeDuplicateTracking(err: any): boolean {
  const msg = (err?.message || err?.error_description || err?.details || "").toString().toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique") || msg.includes("tracking");
}

// -------------------------
// Schema discovery (no more guessing)
// -------------------------
type ColMap = {
  ownerCol: string; // required
  titleCol: string; // required
  descCol?: string;
  notesCol?: string;
  countCol?: string;
  statusCol?: string;
  trackingCol?: string;
  createdAtCol?: string;
};

async function getTableColumns(tableName: string): Promise<Set<string>> {
  // Use information_schema to discover columns (service-role should be allowed)
  const { data, error } = await supabaseServer
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);

  if (error) throw error;

  const set = new Set<string>();
  (data ?? []).forEach((row: any) => {
    if (row?.column_name) set.add(String(row.column_name));
  });
  return set;
}

function pickFirstExisting(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}

async function discoverConsignmentItemsMap(): Promise<{ cols: Set<string>; map: ColMap }> {
  const cols = await getTableColumns("consignment_items");

  // Owner id column: find what YOUR table actually uses
  const ownerCol =
    pickFirstExisting(cols, [
      "client_id",
      "profile_id",
      "user_id",
      "owner_id",
      "customer_id",
      "account_id",
      "created_by",
      "submitted_by",
    ]) ?? null;

  if (!ownerCol) {
    throw new Error(
      `No owner column found on consignment_items. Columns are: ${Array.from(cols).sort().join(", ")}`
    );
  }

  // Title column (required)
  const titleCol =
    pickFirstExisting(cols, ["item_title", "title", "name", "item_name"]) ?? null;

  if (!titleCol) {
    throw new Error(
      `No title column found on consignment_items. Columns are: ${Array.from(cols).sort().join(", ")}`
    );
  }

  // Optional columns
  const descCol = pickFirstExisting(cols, ["item_description", "description", "details", "item_desc"]);
  const notesCol = pickFirstExisting(cols, ["notes", "pickup_notes", "comments", "note"]);
  const countCol = pickFirstExisting(cols, ["item_count", "count", "quantity", "qty"]);
  const statusCol = pickFirstExisting(cols, ["status", "state"]);
  const trackingCol = pickFirstExisting(cols, ["tracking_number", "tracking", "tracking_no"]);
  const createdAtCol = pickFirstExisting(cols, ["created_at", "created", "inserted_at"]);

  return {
    cols,
    map: { ownerCol, titleCol, descCol, notesCol, countCol, statusCol, trackingCol, createdAtCol },
  };
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

  // handle unique constraint / concurrent insert
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
// Insert logic (uses discovered columns)
// -------------------------
async function tryInsertOnce(payload: Record<string, any>) {
  const { data, error } = await supabaseServer
    .from("consignment_items")
    .insert([payload])
    .select()
    .single();

  return { data, error };
}

async function insertConsignmentSmart(args: {
  profileId: string;
  map: ColMap;
  itemTitle: string;
  itemDesc?: string | null;
  itemCount?: number | null;
  notes?: string | null;
}) {
  const { map } = args;

  // Build payload using ONLY known-good columns
  const payload: Record<string, any> = {};
  payload[map.ownerCol] = args.profileId;
  payload[map.titleCol] = args.itemTitle;

  if (map.descCol && args.itemDesc != null) payload[map.descCol] = args.itemDesc;
  if (map.notesCol && args.notes != null) payload[map.notesCol] = args.notes;
  if (map.countCol && args.itemCount != null) payload[map.countCol] = args.itemCount;
  if (map.statusCol) payload[map.statusCol] = "pending";

  // Tracking retry if the column exists
  const usesTracking = !!map.trackingCol;
  const maxTrackingRetries = usesTracking ? 6 : 1;

  let lastError: any = null;

  for (let i = 0; i < maxTrackingRetries; i++) {
    const attemptPayload = { ...payload };

    let tracking: string | null = null;
    if (map.trackingCol) {
      tracking = makeTrackingNumber();
      attemptPayload[map.trackingCol] = tracking;
    }

    const { data, error } = await tryInsertOnce(attemptPayload);

    if (!error && data) {
      return {
        data,
        tracking_number:
          (map.trackingCol ? (data as any)?.[map.trackingCol] : null) ?? tracking,
      };
    }

    lastError = error;

    // only retry on “tracking collision” type errors
    if (!(usesTracking && looksLikeDuplicateTracking(error))) break;
  }

  throw lastError ?? new Error("Insert failed");
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
    if (!email) return jsonError("User email missing on session", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);

    const { map } = await discoverConsignmentItemsMap();

    // Query using discovered owner col
    let q = supabaseServer.from("consignment_items").select("*").eq(map.ownerCol, profileId).limit(200);

    // Order if we have a created column
    if (map.createdAtCol) {
      q = q.order(map.createdAtCol, { ascending: false });
    }

    const res = await q;

    if (res.error) {
      console.error("GET consignment_items error:", res.error);
      return jsonError(res.error.message ?? "Failed to load consignment items", 500, {
        debug: { message: res.error.message },
      });
    }

    return NextResponse.json(
      {
        success: true,
        items: res.data ?? [],
        debug_columns: {
          ownerCol: map.ownerCol,
          createdAtCol: map.createdAtCol ?? null,
        },
      },
      { status: 200 }
    );
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
    if (!email) return jsonError("User email missing on session", 400);

    const body = await req.json();

    const itemTitle = toCleanString(body.item_title ?? body.title ?? body.itemName) ?? "";
    const itemDesc = toCleanString(body.item_description ?? body.description ?? body.itemDesc);
    const notes = toCleanString(body.notes ?? body.pickup_notes);
    const itemCount = parseOptionalPositiveInt(body.item_count ?? body.count ?? body.quantity);

    if (!itemTitle) return jsonError("item_title is required", 400);

    const profileId = await getOrCreateProfileIdByEmail(email);
    const { map, cols } = await discoverConsignmentItemsMap();

    const created = await insertConsignmentSmart({
      profileId,
      map,
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
        tracking_number: created.tracking_number ?? null,
        debug_columns: {
          ownerCol: map.ownerCol,
          titleCol: map.titleCol,
          descCol: map.descCol ?? null,
          notesCol: map.notesCol ?? null,
          countCol: map.countCol ?? null,
          statusCol: map.statusCol ?? null,
          trackingCol: map.trackingCol ?? null,
          createdAtCol: map.createdAtCol ?? null,
          // Helpful if you ever need to see the raw list while debugging:
          // columns: Array.from(cols).sort(),
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Unexpected error in POST /api/consignment:", err);

    const msg =
      err?.message ??
      err?.error?.message ??
      err?.error?.details ??
      "Unknown error";

    return jsonError(msg, 500, { debug: { message: msg } });
  }
}
