export type ToolResultCommitWriters<TArtifact, TObservation, TEvent, TArtifactResult, TObservationResult, TEventResult> = {
  saveArtifact: (artifact: TArtifact) => Promise<TArtifactResult>;
  saveObservation: (observation: TObservation) => Promise<TObservationResult>;
  saveEvent: (event: TEvent) => Promise<TEventResult>;
};

export type AtomicToolResultCommit<TArtifactResult, TObservationResult, TEventResult> = {
  artifact: TArtifactResult;
  observation: TObservationResult;
  event: TEventResult;
};

export async function commitToolResultAtomically<
  TArtifact,
  TObservation,
  TEvent,
  TArtifactResult = unknown,
  TObservationResult = unknown,
  TEventResult = unknown,
>(input: {
  transaction: <TResult>(
    commit: (
      writers: ToolResultCommitWriters<
        TArtifact,
        TObservation,
        TEvent,
        TArtifactResult,
        TObservationResult,
        TEventResult
      >,
    ) => Promise<TResult>,
  ) => Promise<TResult>;
  artifact: TArtifact;
  observation: TObservation;
  event: TEvent;
}): Promise<AtomicToolResultCommit<TArtifactResult, TObservationResult, TEventResult>> {
  return input.transaction(async (writers) => {
    assertCommitWriters(writers);

    const artifact = await writers.saveArtifact(input.artifact);
    const observation = await writers.saveObservation(input.observation);
    const event = await writers.saveEvent(input.event);

    return { artifact, observation, event };
  });
}

function assertCommitWriters(
  writers: {
    saveArtifact?: unknown;
    saveObservation?: unknown;
    saveEvent?: unknown;
  },
): void {
  if (
    typeof writers.saveArtifact !== "function" ||
    typeof writers.saveObservation !== "function" ||
    typeof writers.saveEvent !== "function"
  ) {
    throw new TypeError("Atomic tool result commit requires artifact, observation, and event writers.");
  }
}
