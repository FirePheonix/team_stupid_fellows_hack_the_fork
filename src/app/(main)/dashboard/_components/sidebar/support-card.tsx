import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SupportCard() {
  return (
    <Card size="sm" className="overflow-hidden shadow-none group-data-[collapsible=icon]:hidden">
      <CardHeader className="min-w-0 px-4">
        <CardTitle className="truncate text-sm">Simulated plant</CardTitle>
        <CardDescription className="line-clamp-3">
          One yeast simulation drives the reactor and sensors; trained models predict protein and flag faults.{" "}
          <Link href="/dashboard/insights" className="text-foreground hover:underline">
            Open insights
          </Link>
          .
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
