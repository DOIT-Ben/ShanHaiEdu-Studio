import { logoutPasswordSession } from "@/server/auth/password-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const result = await logoutPasswordSession(request);
  return NextResponse.json(
    { authenticated: false, user: null, revoked: result.revoked },
    { status: 200, headers: { "set-cookie": result.clearCookieHeader } },
  );
}
