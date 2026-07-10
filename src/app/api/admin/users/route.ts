import { canManageUsers } from "@/server/auth/authorization";
import { listManagedUsers } from "@/server/auth/admin-user-management";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  if (!canManageUsers(session.actor)) {
    return NextResponse.json({ error: "无权执行此操作。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const users = await listManagedUsers({ query: url.searchParams.get("q") ?? "" });
  return NextResponse.json(users);
}
