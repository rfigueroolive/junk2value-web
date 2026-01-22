import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const BUCKET = "consignment-photos";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function getAuthedUser(req: NextRequest) {
  const supabase = supabaseServer; // your export is a const, not a function

  const token = getBearerToken(req);
  if (!token) return { supabase, user: null as any, error: "Missing Authorization Bearer token" };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { supabase, user: null as any, error: "invalid/expired session token" };

  return { supabase, user: data.user, error: null as string | null };
}

/**
 * profiles: email-only (your profiles table has no user_id)
 */
async function getOrCreateProfileIdByEmail(supabase: typeof supabaseServer, emailRaw: string) {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email) return null;

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) throw profileErr;
  if (profile?.id) return profile.id as string;

  const { data: created, error: createErr } = await supabase
    .from("profiles")
    .insert([{ email }])
    .select("id")
    .single();

  if (!createErr && created?.id) return created.id as string;

  // concurrent insert fallback
  const { data: again, error: againErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (againErr) throw againErr;
  if (again?.id) return again.id as string;

  throw createErr ?? new Error("Failed to create profile");
}

/**
 * Ownership check WITHOUT referencing columns that may not exist:
 * - fetch the item by id
 * - look at whatever owner-ish column exists on the returned row
 * - compare against allowed owner values (auth user id + profile id)
 */
async function assertItemOwnershipByFetch(
  supabase: typeof supabaseServer,
  itemId: string,
  ownerValues: string[]
): Promise<{ ok: true; match: { ownerField: string; ownerValue: string } } | { ok: false; status: number; message: string; debug?: any }> {
  const { data: item, error } = await supabase
    .from("consignment_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!item) return { ok: false, status: 404, message: "Item not found" };

  const record = item as Record<string, unknown>;

  const ownerFieldCandidates = [
    "user_id",
    "owner_id",
    "created_by",
    "submitted_by",
    "account_id",
    "customer_id",
    "client_id",
    "profile_id",
  ];

  for (const field of ownerFieldCandidates) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const v = record[field];
      if (v !== null && v !== undefined) {
        const sv = String(v);
        if (ownerValues.includes(sv)) {
          return { ok: true, match: { ownerField: field, ownerValue: sv } };
        }
      }
    }
  }

  return {
    ok: false,
    status: 403,
    message: "Not allowed: item does not belong to you",
    debug: { ownerValuesTried: ownerValues, availableKeys: Object.keys(record).sort() },
  };
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * POST /api/consignment/photos/upload-url
 * Body: { item_id: string, file_name: string, content_type?: string }
 *
 * Returns:
 *  - upload_url: signed URL to upload bytes to
 *  - path: storage path in bucket
 *  - public_url: store this into consignment_photos.photo_url (bucket is public)
 */
export async function POST(req: NextRequest) {
  const { supabase, user, error } = await getAuthedUser(req);
  if (error) return jsonError(error, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const itemId: string | undefined = body?.item_id;
  const fileNameRaw: string | undefined = body?.file_name;
  const contentType: string | undefined = body?.content_type;

  if (!itemId) return jsonError("Missing item_id", 400);
  if (!fileNameRaw) return jsonError("Missing file_name", 400);

  const email = (user?.email ?? "").trim().toLowerCase();
  if (!email) return jsonError("User email missing on session", 400);

  // Ensure profile exists (we also use it for the storage path namespace)
  let profileId: string | null = null;
  try {
    profileId = await getOrCreateProfileIdByEmail(supabase, email);
  } catch (e: any) {
    return jsonError(e?.message ?? "Failed to load/create profile", 500);
  }
  if (!profileId) return jsonError("Profile not found for user", 404);

  // Ownership check: allow either auth user id OR profile id to match whatever your table uses
  const ownerValues = [String(user.id), String(profileId)].filter(Boolean);

  const own = await assertItemOwnershipByFetch(supabase, itemId, ownerValues);
  if (!own.ok) return jsonError(own.message, own.status, own.debug ? { debug: own.debug } : undefined);

  const safeName = sanitizeFilename(fileNameRaw);
  const unique = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
  const path = `${profileId}/${itemId}/${unique}-${safeName}`;

  const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signErr || !data?.signedUrl) {
    return jsonError(signErr?.message ?? "Failed to create signed upload URL", 500);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    success: true,
    bucket: BUCKET,
    path,
    upload_url: data.signedUrl,
    token: data.token ?? null,
    public_url: pub?.publicUrl ?? null,
    content_type_hint: contentType ?? null,
    debug_match: (own as any).match ?? null,
  });
}
