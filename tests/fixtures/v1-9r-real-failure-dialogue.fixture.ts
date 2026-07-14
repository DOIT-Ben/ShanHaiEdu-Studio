export const v19rRealFailureDialogue = {
  projectAlias: "fifth-grade-percent-shot-rate",
  messages: [
    "请做五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。",
    "继续",
    "确定",
    "继续",
  ],
  observedFailure: {
    repeatedArtifactKind: "requirement_spec",
    repeatedCount: 8,
    terminalFailure: "60-second runtime timeout became a deterministic draft",
  },
  expectedRecovery: {
    preserveTaskGoal: "五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。",
    noRoutineConfirmation: true,
    noDeterministicSuccessArtifact: true,
  },
} as const;
