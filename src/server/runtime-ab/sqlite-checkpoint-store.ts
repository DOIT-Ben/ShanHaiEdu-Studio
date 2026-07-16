import path from "node:path";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";

import type {
  RuntimeAbCheckpoint,
  RuntimeAbCheckpointScope,
  RuntimeAbCheckpointStore,
} from "./types";
import { digestRuntimeAbValue } from "./types";

export type SqliteRuntimeAbCheckpointStore = RuntimeAbCheckpointStore & {
  readonly databasePath: string;
  close(): void;
};

export function createSqliteRuntimeAbCheckpointStore(input: {
  databasePath: string;
}): SqliteRuntimeAbCheckpointStore {
  const databasePath = path.resolve(input.databasePath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS RuntimeAbCheckpoint (
      scopeKey TEXT PRIMARY KEY,
      checkpointDigest TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  const select = database.prepare("SELECT checkpointDigest, payloadJson FROM RuntimeAbCheckpoint WHERE scopeKey = ?");
  const upsert = database.prepare(`
    INSERT INTO RuntimeAbCheckpoint(scopeKey, checkpointDigest, payloadJson, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scopeKey) DO UPDATE SET
      checkpointDigest = excluded.checkpointDigest,
      payloadJson = excluded.payloadJson,
      updatedAt = excluded.updatedAt
  `);
  const saveTransaction = database.transaction((checkpoint: RuntimeAbCheckpoint) => {
    upsert.run(
      scopeKey(checkpoint),
      checkpoint.checkpointDigest,
      JSON.stringify(checkpoint),
      new Date().toISOString(),
    );
  });

  return {
    durability: "durable",
    databasePath,
    async load(scope) {
      const row = select.get(scopeKey(scope)) as { checkpointDigest: string; payloadJson: string } | undefined;
      if (!row) return undefined;
      const checkpoint = JSON.parse(row.payloadJson) as RuntimeAbCheckpoint;
      if (checkpoint.checkpointDigest !== row.checkpointDigest) {
        throw new Error("Runtime A/B durable checkpoint digest does not match its row binding.");
      }
      return structuredClone(checkpoint);
    },
    async save(checkpoint) {
      saveTransaction(structuredClone(checkpoint));
    },
    close() {
      if (database.open) database.close();
    },
  };
}

function scopeKey(scope: RuntimeAbCheckpointScope) {
  return digestRuntimeAbValue({
    projectId: scope.projectId,
    taskId: scope.taskId,
    intentEpoch: scope.intentEpoch,
    planRevision: scope.planRevision,
  });
}
