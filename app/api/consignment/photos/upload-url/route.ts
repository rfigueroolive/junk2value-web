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
  const supabase = supabaseServer;

  const token = getBearerToken(req);
  if (!token) return { supabase, user: null as any, error: "Missing Authorization Bearer token" };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { supabase, user: null as any, error: "invalid/expired session token" };

  return { supabase, user: data.user, error: null as string | null };
}

async function getProfileIdForUser(supabase: typeof supabaseServer, user: any): Promise<string | null> {
  const { data: byUserId } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (byUserId?.id) return byUserId.id;

  const email = user.email;
  if (!email) return null;

  const { data: byEmail } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  return byEmail?.id ?? null;
}

async function assertItemOwnership(
  supabase: typeof supabaseServer,
  itemId: string,
  profileId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data: item, error } = await supabase
    .from("consignment_items")
    .select("id, profile_id")
    .eq("id", itemId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!item) return { ok: false, status: 404, message: "Item not found" };

  if (item.profile_id !== profileId) {
    return { ok: false, status: 403, message: "Not allowed: item does not belong to you" };
  }

  return { ok: true };
}

function sanitizeFilename(name: string) {
  // keep it simple + safe for storage paths
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * POST /api/consignment/photos/upload-url
 * Body: { item_id: string, file_name: string, content_type?: string }
 *
 * Returns:
 *  - upload_url: signed URL to PUT the file bytes to
 *  - path: storage path inside bucket
 *  - public_url: final URL to store in consignment_photos.photo_url (bucket is public)
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

  const profileId = await getProfileIdForUser(supabase, user);
  if (!profileId) return jsonError("Profile not found for user", 404);

  const own = await assertItemOwnership(supabase, itemId, profileId);
  if (!own.ok) return jsonError(own.message, own.status);

  const safeName = sanitizeFilename(fileNameRaw);
  const unique = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
  const path = `${profileId}/${itemId}/${unique}-${safeName}`;

  // Supabase v2: createSignedUploadUrl(path)
  const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);

  if (signErr || !data?.signedUrl) {
    return jsonError(signErr?.message ?? "Failed to create signed upload URL", 500);
  }

  // Because you made the bucket PUBLIC, this URL is the one to store in DB
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl ?? null;

  return NextResponse.json({
    success: true,
    bucket: BUCKET,
    path,
    upload_url: data.signedUrl,
    token: data.token ?? null,
    public_url: publicUrl,
    content_type_hint: contentType ?? null,
  });
}
