import { getCurrentPasswordUser } from "@/server/auth/password-auth";
import { resolveAuthMode } from "@/server/auth/session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authMode = resolveAuthMode();
  if (authMode !== "password") {
    return NextResponse.json({ enabled: false, authMode, authenticated: false, user: null });
  }
  return NextResponse.json({ enabled: true, authMode, ...(await getCurrentPasswordUser(request)) });
}
