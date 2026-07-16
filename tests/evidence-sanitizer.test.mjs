import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeEvidenceRecord,
  sanitizeEvidenceText,
  sanitizeEvidenceValue,
} from "../scripts/lib/evidence-sanitizer.mjs";

test("sanitizes secrets, URLs, and Windows or POSIX user paths without erasing teacher-readable content", () => {
  const sanitized = sanitizeEvidenceText(
    "教师说明：保留这一段。 token=private API_KEY='private-key' credential=private sk-live-private "
      + "Bearer private-bearer https://private.example/v1?q=1 "
      + '"C:\\Users\\Teacher Name\\课程资料\\设计稿.json" '
      + "'/home/teacher/My Course/observer.json' /Users/teacher/private.txt",
  );

  assert.match(sanitized, /教师说明：保留这一段。/);
  assert.match(sanitized, /token=\[redacted\]/i);
  assert.match(sanitized, /API_KEY=['"]\[redacted\]['"]/i);
  assert.match(sanitized, /credential=\[redacted\]/i);
  assert.match(sanitized, /\[redacted-url\]/);
  assert.match(sanitized, /\[redacted-path\]/);
  assert.doesNotMatch(sanitized, /private-key|private-bearer|sk-live-private|private\.example|Teacher Name|\/home\/teacher|\/Users\/teacher/);
});

test("recursively sanitizes nested observer strings and arrays while preserving useful evidence fields", () => {
  const sanitized = sanitizeEvidenceValue({
    reasonCode: "tool_validation_failed",
    teacherSummary: "教师可读：请修订第 2 页。",
    nested: {
      notes: [
        "token=nested-private",
        ["API_KEY=nested-key", { detail: "credential=nested-credential" }],
      ],
      endpoint: "https://private.example/v1",
      localPath: "C:\\Users\\Teacher\\evidence.json",
    },
    token: "bare-object-token",
  });

  assert.deepEqual(sanitized, {
    reasonCode: "tool_validation_failed",
    teacherSummary: "教师可读：请修订第 2 页。",
    nested: {
      notes: [
        "token=[redacted]",
        ["API_KEY=[redacted]", { detail: "credential=[redacted]" }],
      ],
      endpoint: "[redacted-url]",
      localPath: "[redacted-path]",
    },
    token: "[redacted]",
  });
});

test("returns only a recursively sanitized plain record at record evidence boundaries", () => {
  assert.equal(sanitizeEvidenceRecord(["not-a-record"]), null);
  assert.deepEqual(sanitizeEvidenceRecord({
    observationId: "obs-1",
    details: { attempts: ["sk-private", "仍保留教师反馈"] },
  }), {
    observationId: "obs-1",
    details: { attempts: ["[redacted]", "仍保留教师反馈"] },
  });
});
