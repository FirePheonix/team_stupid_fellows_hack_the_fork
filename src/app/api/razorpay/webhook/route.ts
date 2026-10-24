import { type NextRequest, NextResponse } from "next/server";

import { AUTH_AND_BILLING_STALE } from "@/config/app-config";
import { handleSubscriptionChange, verifyWebhookSignature } from "@/lib/payments/razorpay";

export async function POST(request: NextRequest) {
  if (AUTH_AND_BILLING_STALE) {
    return NextResponse.json({ error: "Billing is not live." }, { status: 410 });
  }

  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const isValid = verifyWebhookSignature(body, signature);

  if (!isValid) {
    console.error("Razorpay webhook signature verification failed.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body);

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.completed":
    case "subscription.updated":
    case "subscription.pending":
    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.paused":
    case "subscription.resumed": {
      const subscription = event.payload.subscription.entity;
      await handleSubscriptionChange({
        id: subscription.id,
        customer_id: subscription.customer_id,
        plan_id: subscription.plan_id,
        status: subscription.status,
        notes: subscription.notes,
      });
      break;
    }
    default:
      console.log(`Unhandled Razorpay event: ${event.event}`);
  }

  return NextResponse.json({ received: true });
}
