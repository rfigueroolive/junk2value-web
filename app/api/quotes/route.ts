// src/app/api/quotes/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Simple helper function to estimate a quote amount.
// You can tweak this later to match your real-world pricing.
function estimateQuoteAmount(params: {
  estimated_item_count?: number;
  estimated_avg_weight: _estimated_avg_weight,
  estimated_heaviest_weight?: number;
  distance_km?: number;
}) {
  const {
    estimated_item_count = 0,
    estimated_avg_weight = 0,
    estimated_heaviest_weight = 0,
    distance_km = 0,
  } = params;

  // Base assumptions for v1:
  // - About 20 items per hour on average
  // - Base rate ~$250/hour
  // - Small distance factor
  const baseHourlyRate = 250;

  // Rough time estimate in hours
  const itemsPerHour = 20;
  let hours = estimated_item_count / itemsPerHour;

  // Minimum 1 hour
  if (hours < 1) hours = 1;

  // If very heavy items involved, add some extra time
  if (estimated_heaviest_weight > 150) {
    hours += 0.5; // add 30 minutes for very heavy stuff
  }

  // Distance factor (very rough for now)
  const distanceFee = distance_km * 2; // $2 per km, tweak later

  const amount = hours * baseHourlyRate + distanceFee;

  // Round to nearest whole dollar
  return Math.round(amount);
}

// Handle POST /api/quotes
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Extract expected fields from the request body
    const {
      client_id,
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

    // Basic validation: require at least a location
    if (!job_location_address) {
      return NextResponse.json(
        { error: 'job_location_address is required' },
        { status: 400 }
      );
    }

    // Estimate the quote amount using our helper
    const initial_quote_amount = estimateQuoteAmount({
      estimated_item_count,
      estimated_avg_weight,
      estimated_heaviest_weight,
      distance_km,
    });

    // Insert into the quotes table
    const { data, error } = await supabaseServer
      .from('quotes')
      .insert([
        {
          client_id: client_id || null,
          status: 'pending',
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
      console.error('Error inserting quote:', error);
      return NextResponse.json(
        { error: 'Failed to create quote' },
        { status: 500 }
      );
    }

    // Return the created quote record
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('Unexpected error in POST /api/quotes:', err);
    return NextResponse.json(
      { error: 'Invalid request or server error' },
      { status: 500 }
    );
  }
}
