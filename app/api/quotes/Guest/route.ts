// src/app/api/quotes/guest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// Same estimator as your main quotes route
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

  if (estimated_heaviest_weight > 150) hours += 0.5;
  if (estimated_avg_weight > 75) hours += 0.25;

  const distanceFee = distance_km * 2;
  return Math.round(hours * baseHourlyRate + distanceFee);
}

// Guest: POST /api/quotes/guest
export async function POST(req: NextRequest) {
  try {
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

    const initial_quote_amount = estimateQuoteAmount({
      estimated_item_count,
      estimated_avg_weight,
      estimated_heaviest_weight,
      distance_km,
    });

    // IMPORTANT: guest quotes have client_id = null
    const { data, error } = await supabaseServer
      .from("quotes")
      .insert([
        {
          client_id: null,
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
      console.error("Guest quote insert error:", error);
      return NextResponse.json(
        { error: "Failed to create guest quote" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/quotes/guest:", err);
    return NextResponse.json(
      { error: "Invalid request or server error" },
      { status: 500 }
    );
  }
}
