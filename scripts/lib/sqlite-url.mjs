import path from "node:path";

export function resolveSqliteFileUrl(value, { baseDir = process.cwd(), requireAbsolute = false } = {}) {
  const databaseUrl = typeof value === "string" ? value.trim() : "";
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use the file: SQLite format.");
  }
  if (/[?#%\0]/.test(databaseUrl)) {
    throw new Error("DATABASE_URL must not contain query, fragment, percent-encoding, or null-byte ambiguity.");
  }

  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath || rawPath.toLowerCase() === ":memory:") {
    throw new Error("DATABASE_URL must point to a persistent SQLite file.");
  }

  const absolute = path.isAbsolute(rawPath);
  if (requireAbsolute && !absolute) {
    throw new Error("DATABASE_URL must contain an absolute SQLite file path.");
  }
  return absolute ? path.normalize(rawPath) : path.resolve(baseDir, rawPath);
}
