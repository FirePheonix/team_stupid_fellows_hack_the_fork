"use server";

import { AUTH_AND_BILLING_STALE } from "@/config/app-config";
import { withTeam } from "@/lib/auth/middleware";

import { createRazorpaySubscription } from "./razorpay";

const runCheckout = withTeam(async (formData, team) => {
  const planId = formData.get("planId") as string;
  const result = await createRazorpaySubscription({ team, planId });
  return result;
});

export async function checkoutAction(formData: FormData) {
  if (AUTH_AND_BILLING_STALE) return { error: "Billing is not live." };
  return runCheckout(formData);
}
