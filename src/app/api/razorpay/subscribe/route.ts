import { type NextRequest, NextResponse } from "next/server";

import { AUTH_AND_BILLING_STALE } from "@/config/app-config";
import { getTeamForUser, getUser } from "@/lib/db/queries";
import { createRazorpaySubscription } from "@/lib/payments/razorpay";

export async function POST(request: NextRequest) {
  if (AUTH_AND_BILLING_STALE) {
    return NextResponse.json({ error: "Billing is not live." }, { status: 410 });
  }

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const team = await getTeamForUser();
    if (!team) {
      return NextResponse.json({ error: "No team found" }, { status: 400 });
    }

    const body = await request.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ error: "Plan ID is required" }, { status: 400 });
    }

    const result = await createRazorpaySubscription({ team, planId });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error creating subscription:", error);
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }
}
