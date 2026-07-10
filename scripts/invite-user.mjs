import { pathToFileURL } from "node:url";
import { openSqliteDatabase, provisionSqlitePasswordUser } from "./bootstrap-admin.mjs";

export async function runInviteUser(options = {}) {
  const env = options.env ?? process.env;
  const ownsDb = !options.db;
  const db = options.db ?? openSqliteDatabase(env.DATABASE_URL);
  try {
    const admin = db
      .prepare('SELECT "id" FROM "LocalUser" WHERE "authMode" = ? AND "role" = ? ORDER BY "createdAt", "id" LIMIT 1')
      .get("password", "admin");
    if (!admin) throw new Error("请先初始化密码管理员。");

    return await provisionSqlitePasswordUser({
      db,
      email: env.SHANHAI_INVITE_USER_EMAIL,
      displayName: env.SHANHAI_INVITE_USER_DISPLAY_NAME,
      initialPassword: env.SHANHAI_INVITE_USER_INITIAL_PASSWORD,
      role: "teacher",
      actorUserId: admin.id,
      source: "invite_cli",
      hashPassword: options.hashPassword,
      generateUserId: options.generateUserId,
      generateAuditId: options.generateAuditId,
      now: options.now,
    });
  } finally {
    if (ownsDb) db.close();
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  await import("dotenv/config");
  try {
    const result = await runInviteUser();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "用户邀请失败。" }));
    process.exitCode = 1;
  }
}
