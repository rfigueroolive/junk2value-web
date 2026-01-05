import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Validate user token
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON);

// Read DB with service role
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...(extra ?? {}) }, { status });
}

function extractBearerToken(req: NextRequest): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function listColumns(table: string): Promise<Set<string>> {
  // information_schema is available in Supabase Postgres
  const { data, error } = await supabaseAdmin
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_name", table);

  if (error) throw new Error(error.message);

  const cols = new Set<string>();
  for (const row of data ?? []) cols.add(row.column_name);
  return cols;
}

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return jsonError("Missing Authorization bearer token", 401);

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token", 401, { error: userErr?.message ?? "Invalid token" });
    }

    const userId = userData.user.id;

    // ✅ Detect the correct "owner" column in quotes table
    const cols = await listColumns("quotes");
    const candidates = ["user_id", "profile_id", "owner_id", "created_by", "customer_id"];
    const ownerCol = candidates.find((c) => cols.has(c));

    if (!ownerCol) {
      return jsonError("Failed to load quotes", 500, {
        error: `No owner column found. Tried: ${candidates.join(", ")}`,
      });
    }

    const { data: quotes, error: qErr } = await supabaseAdmin
      .from("quotes")
      .select("*")
      .eq(ownerCol, userId)
      .order("created_at", { ascending: false });

    if (qErr) return jsonError("Failed to load quotes", 500, { error: qErr.message });

    return NextResponse.json({
      success: true,
      owner_column_used: ownerCol, // helpful debug (you can remove later)
      quotes: quotes ?? [],
    });
  } catch (e: any) {
    return jsonError("Server error", 500, { error: e?.message ?? String(e) });
  }
}
