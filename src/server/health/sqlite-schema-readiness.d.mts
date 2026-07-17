export type SqliteSchemaReadinessReason =
  | Readonly<{ code: "database_unavailable" | "database_schema_unreadable" }>
  | Readonly<{ code: "database_schema_missing_table"; table: string }>
  | Readonly<{ code: "database_schema_missing_column"; table: string; column: string }>;

export const HEALTH_SCHEMA_REQUIREMENTS: readonly Readonly<{
  table: string;
  columns: readonly string[];
}>[];

export function checkSqliteSchemaReadiness(databasePath: string): Readonly<{
  ready: boolean;
  reasons: readonly SqliteSchemaReadinessReason[];
}>;
