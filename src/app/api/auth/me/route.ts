import { getCurrentPasswordUser } from "@/server/auth/password-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return NextResponse.json(await getCurrentPasswordUser(request));
}
