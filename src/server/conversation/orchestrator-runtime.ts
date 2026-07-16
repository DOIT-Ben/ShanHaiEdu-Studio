export type OrchestratorTurnResult = {
  status: string;
  [key: string]: unknown;
};

export type OrchestratedTurnInput<TResult extends OrchestratorTurnResult> = {
  selectAndRun: () => Promise<TResult> | TResult;
  legacyOuterLoop?: (...args: never[]) => unknown;
  nestedRuntimeLoop?: (...args: never[]) => unknown;
};

export async function runOrchestratedTurn<TResult extends OrchestratorTurnResult>(
  input: OrchestratedTurnInput<TResult>,
): Promise<TResult> {
  return input.selectAndRun();
}
