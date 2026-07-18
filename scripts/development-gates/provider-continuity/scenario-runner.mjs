import { isDeepStrictEqual } from "node:util";

const SCENARIOS = Object.freeze([
  Object.freeze({ id: "ambiguous-discussion", submitTeacherMessage: true, continuationOf: null }),
  Object.freeze({ id: "single-requirement-spec", submitTeacherMessage: true, continuationOf: null }),
  Object.freeze({ id: "requirement-spec-and-ppt-outline", submitTeacherMessage: true, continuationOf: null }),
  Object.freeze({ id: "main-agent-continuation", submitTeacherMessage: false, continuationOf: "requirement-spec-and-ppt-outline" }),
]);

export function createScenarioPlan() {
  return SCENARIOS.map((entry) => ({ ...entry }));
}

export function validateScenarioSequence(facts) {
  if (!Array.isArray(facts) || facts.length !== SCENARIOS.length) {
    throw new Error("Provider campaign must contain exactly four scenarios.");
  }
  if (!isDeepStrictEqual(facts.map((entry) => entry?.id), SCENARIOS.map((entry) => entry.id))) {
    throw new Error("Provider scenarios are missing or out of order.");
  }
  for (let index = 0; index < facts.length; index += 1) {
    if (facts[index].submittedTeacherMessage !== SCENARIOS[index].submitTeacherMessage) {
      throw new Error(index === 3
        ? "Main Agent continuation must not submit a new teacher message."
        : `Scenario ${SCENARIOS[index].id} must submit one teacher message.`);
    }
  }
  const source = facts[2];
  const continuation = facts[3];
  if (!source.teacherMessageId || !source.turnJobId ||
      continuation.teacherMessageId !== source.teacherMessageId ||
      continuation.turnJobId !== source.turnJobId) {
    throw new Error("Main Agent continuation must retain scenario C teacherMessageId and turnJobId.");
  }
  return { ok: true, scenarioCount: facts.length };
}
