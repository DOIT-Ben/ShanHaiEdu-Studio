import { getCurrentPasswordUser } from "@/server/auth/password-auth";
import { isPublicRegistrationEnabled, resolveAuthMode } from "@/server/auth/session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authMode = resolveAuthMode();
  const registrationEnabled = authMode === "password" && isPublicRegistrationEnabled();
  if (authMode !== "password") {
    return NextResponse.json({ enabled: false, authMode, registrationEnabled: false, authenticated: false, user: null });
  }
  return NextResponse.json({ enabled: true, authMode, registrationEnabled, ...(await getCurrentPasswordUser(request)) });
}
