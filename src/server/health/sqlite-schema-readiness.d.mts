export type SqliteSchemaReadinessReason =
  | Readonly<{ code: "database_unavailable" | "database_schema_unreadable" }>
  | Readonly<{ code: "database_schema_missing_table"; table: string }>
  | Readonly<{ code: "database_schema_missing_column"; table: string; column: string }>
  | Readonly<{ code: "database_schema_missing_index"; table: string; index: string }>
  | Readonly<{ code: "database_schema_invalid_index"; table: string; index: string }>
  | Readonly<{ code: "database_schema_missing_trigger"; table: string; trigger: string }>
  | Readonly<{ code: "database_schema_invalid_trigger"; table: string; trigger: string }>;

export const HEALTH_SCHEMA_REQUIREMENTS: readonly Readonly<{
  table: string;
  columns: readonly string[];
  indexes: readonly Readonly<{ name: string; columns: readonly string[]; unique: boolean }>[];
  triggers: readonly Readonly<{ name: string; event: "UPDATE" | "DELETE" }>[];
}>[];

export function checkSqliteSchemaReadiness(databasePath: string): Readonly<{
  ready: boolean;
  reasons: readonly SqliteSchemaReadinessReason[];
}>;
