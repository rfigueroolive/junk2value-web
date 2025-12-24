import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring("Bearer ".length)
      : "";

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    // Look up the user from the access token
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(
      token
    );

    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    // Fetch quotes for this user
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("*")
      .eq("client_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
    }

    return NextResponse.json({ quotes: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("GET /api/quotes/my error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
