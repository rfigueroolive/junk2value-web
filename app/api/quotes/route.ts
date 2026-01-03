// src/app/api/quotes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// Simple helper function to estimate a quote amount.
// You can tweak this later to match your real-world pricing.
function estimateQuoteAmount(params: {
  estimated_item_count?: number;
  estimated_avg_weight?: number;
  estimated_heaviest_weight?: number;
  distance_km?: number;
}) {
  const {
    estimated_item_count = 0,
    estimated_avg_weight = 0,
    estimated_heaviest_weight = 0,
    distance_km = 0,
  } = params;

  const baseHourlyRate = 250;

  const itemsPerHour = 20;
  let hours = estimated_item_count / itemsPerHour;

  if (hours < 1) hours = 1;

  if (estimated_heaviest_weight > 150) {
    hours += 0.5;
  }

  if (estimated_avg_weight > 75) {
    hours += 0.25;
  }

  const distanceFee = distance_km * 2;

  const amount = hours * baseHourlyRate + distanceFee;
  return Math.round(amount);
}

// Extract "Bearer <token>" from Authorization header
function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;

  return token?.trim() || null;
}

// Handle POST /api/quotes
export async function POST(req: NextRequest) {
  try {
    // 1) Require a logged-in user (token from the client app)
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: "Missing Authorization header (Bearer token required)" },
        { status: 401 }
      );
    }

    // 2) Get the user from the access token
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json(
        { error: "Invalid or expired session token" },
        { status: 401 }
      );
    }

    const user = userData.user;
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "User email missing on session" },
        { status: 400 }
      );
    }

    // 3) Parse body
    const body = await req.json();

    const {
      job_location_address,
      estimated_item_count,
      estimated_avg_weight,
      estimated_heaviest_weight,
      estimated_avg_size,
      estimated_largest_size,
      distance_km,
      notes,
      preferred_date,
      preferred_time_window,
    } = body;

    if (!job_location_address) {
      return NextResponse.json(
        { error: "job_location_address is required" },
        { status: 400 }
      );
    }

    // 4) Find (or create) the user's profile row
    //    Your quotes table uses client_id -> profiles.id
    let profileId: string | null = null;

    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileErr) {
      console.error("Error selecting profile:", profileErr);
      return NextResponse.json({ error: "Failed to read profile" }, { status: 500 });
    }

    if (profile?.id) {
      profileId = profile.id;
    } else {
      // If profile doesn't exist yet, create it.
      // (If your profiles table has more required columns, tell me and we’ll add them here.)
      const { data: created, error: createErr } = await supabaseServer
        .from("profiles")
        .insert([{ email }])
        .select("id")
        .single();

      if (createErr) {
        console.error("Error creating profile:", createErr);
        return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
      }

      profileId = created.id;
    }

    // 5) Estimate quote amount
    const initial_quote_amount = estimateQuoteAmount({
      estimated_item_count,
      estimated_avg_weight,
      estimated_heaviest_weight,
      distance_km,
    });

    // 6) Insert quote ALWAYS linked to this user
    const { data, error } = await supabaseServer
      .from("quotes")
      .insert([
        {
          client_id: profileId, // ✅ FIX: never null now
          status: "pending",
          job_location_address,
          estimated_item_count,
          estimated_avg_weight,
          estimated_heaviest_weight,
          estimated_avg_size,
          estimated_largest_size,
          distance_km,
          initial_quote_amount,
          notes,
          preferred_date,
          preferred_time_window,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error inserting quote:", error);
      return NextResponse.json({ error: "Failed to create quote" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/quotes:", err);
    return NextResponse.json(
      { error: "Invalid request or server error" },
      { status: 500 }
    );
  }
}
