import { stringify } from "csv-stringify/sync";

export type FeedbackExportRow = {
  receipt: string;
  category: string;
  severity: string | null;
  status: string;
  description: string;
  pageRoute: string;
  appVersion: string;
  attachmentCount: number;
  createdAt: string;
};

export function serializeFeedbackCsv(rows: FeedbackExportRow[], options: { header?: boolean } = {}) {
  return stringify(rows.map((row) => ({
    receipt: safeSpreadsheetCell(row.receipt),
    category: safeSpreadsheetCell(row.category),
    severity: safeSpreadsheetCell(row.severity ?? ""),
    status: safeSpreadsheetCell(row.status),
    description: safeSpreadsheetCell(row.description),
    pageRoute: safeSpreadsheetCell(row.pageRoute),
    appVersion: safeSpreadsheetCell(row.appVersion),
    attachmentCount: row.attachmentCount,
    createdAt: safeSpreadsheetCell(row.createdAt),
  })), {
    header: options.header ?? true,
    record_delimiter: "windows",
    quoted_match: /[\r\n]/,
  });
}

export function safeSpreadsheetCell(value: string) {
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return cleaned.replace(/(^|[\r\n])([\u0020\u00a0]*)(?=[=+\-@\t])/g, "$1'$2");
}
