import { NextResponse } from "next/server";

import { checkHealthReadiness } from "@/server/health/health-readiness";

export async function GET() {
  const result = checkHealthReadiness();
  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
