import type { ConversationMessage, ConversationTurnJob, PrismaClient } from "@/generated/prisma/client";
import { isPendingDecision, withPendingDecisionStatus } from "@/server/conversation/task-contract";
import { removeResolvedDecisionParts } from "@/server/conversation/pending-decision-message-parts";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import type { EnqueueConversationTurnInput, EnqueueMessageAndConversationTurnInput } from "./types";
import {
  CONVERSATION_TURN_SUBMISSION_KEY,
  assertCanonicalPayloadMatch,
  canonicalPayloadDigest,
  conversationTurnPayload,
  isSqliteWriteContentionError,
  isUniqueConstraintError,
  messageTurnPayload,
  messageTurnPayloadDigest,
  parseArray,
  parseRecord,
  parseSubmissionReceipt,
  submissionReceipt,
  waitForConcurrentCommit,
  type TransactionClient,
} from "./conversation-turn-repository-shared";

export function createConversationTurnEnqueueRepository(client: PrismaClient = prisma) {
  return {
    enqueueConversationTurn: enqueueConversationTurn.bind(null, client),
    enqueueMessageAndConversationTurn: enqueueMessageAndConversationTurn.bind(null, client),
  };
}

async function enqueueConversationTurn(
  client: PrismaClient,
  projectId: string,
  input: EnqueueConversationTurnInput,
) {
  try {
    return await createConversationTurn(client, projectId, input);
  } catch (error) {
    if (!input.idempotencyKey ||
        (!isUniqueConstraintError(error) && !isSqliteWriteContentionError(error))) throw error;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await client.conversationTurnJob.findFirst({
        where: { projectId, idempotencyKey: input.idempotencyKey },
      }).catch(() => null);
      if (existing) {
        assertExistingConversationTurn(existing, input);
        return existing;
      }
      await waitForConcurrentCommit(10 * (attempt + 1));
    }
    throw error;
  }
}

async function createConversationTurn(
  client: PrismaClient,
  projectId: string,
  input: EnqueueConversationTurnInput,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { generationIntensity: true, intensityVersion: true },
    });
    const teacherMessage = await tx.conversationMessage.findFirst({
      where: { id: input.teacherMessageId, projectId, role: "teacher" },
    });
    if (!teacherMessage) throw new Error(`Teacher message not found: ${input.teacherMessageId}`);

    if (input.idempotencyKey) {
      const existing = await tx.conversationTurnJob.findFirst({
        where: { projectId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        assertExistingConversationTurn(existing, input);
        return existing;
      }
    }

    return tx.conversationTurnJob.create({
      data: {
        projectId,
        teacherMessageId: input.teacherMessageId,
        status: "queued",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 2,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.executionIdentity?.actorUserId,
        actorAuthMode: input.executionIdentity?.actorAuthMode,
        authSessionId: input.executionIdentity?.authSessionId,
        generationIntensity: project.generationIntensity,
        intensityVersion: project.intensityVersion,
      },
    });
  });
}

async function enqueueMessageAndConversationTurn(
  client: PrismaClient,
  projectId: string,
  input: EnqueueMessageAndConversationTurnInput,
) {
  if (input.idempotencyKey) {
    const existing = await findExistingMessageTurn(client, projectId, input);
    if (existing) return existing;
  }

  try {
    return await client.$transaction(async (tx) => createMessageAndConversationTurn(tx, projectId, input));
  } catch (error) {
    if (input.idempotencyKey && isUniqueConstraintError(error)) {
      const existing = await findExistingMessageTurn(client, projectId, input);
      if (existing) return existing;
    }
    throw error;
  }
}

async function findExistingMessageTurn(
  client: PrismaClient,
  projectId: string,
  input: EnqueueMessageAndConversationTurnInput,
) {
  const job = await client.conversationTurnJob.findFirst({
    where: { projectId, idempotencyKey: input.idempotencyKey },
  });
  if (!job) return null;
  const message = await client.conversationMessage.findFirst({
    where: { id: job.teacherMessageId, projectId, role: "teacher" },
  });
  if (!message) throw new Error(`Teacher message not found: ${job.teacherMessageId}`);
  assertExistingMessageTurn(message, job, input);
  return { message, job };
}

async function createMessageAndConversationTurn(
  tx: TransactionClient,
  projectId: string,
  input: EnqueueMessageAndConversationTurnInput,
) {
  await assertActiveProjectForWrite(tx, projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { generationIntensity: true, intensityVersion: true, intentEpoch: true },
  });
  const activeAggregate = input.preemptiveControl
    ? await tx.taskAggregate.findUnique({
        where: { projectId_intentEpoch: { projectId, intentEpoch: project.intentEpoch } },
      })
    : null;
  const preempted = Boolean(input.preemptiveControl && activeAggregate);
  const advancesIntent = Boolean(preempted && input.preemptiveControl!.advanceIntentEpoch);
  const nextIntentEpoch = advancesIntent ? project.intentEpoch + 1 : project.intentEpoch;
  const visibleMetadata = preempted
    ? {
        ...(input.metadata ?? {}),
        preemptiveControl: { ...input.preemptiveControl!, previousIntentEpoch: project.intentEpoch, nextIntentEpoch },
      }
    : input.metadata ?? {};
  const message = await tx.conversationMessage.create({
    data: {
      projectId,
      role: input.role,
      content: input.content,
      partsJson: JSON.stringify(input.parts ?? []),
      artifactRefsJson: JSON.stringify(input.artifactRefs ?? []),
      metadataJson: JSON.stringify({
        ...visibleMetadata,
        [CONVERSATION_TURN_SUBMISSION_KEY]: submissionReceipt(
          messageTurnPayloadDigest(input),
          input.preemptiveControl,
        ),
      }),
    },
  });

  if (preempted) {
    if (advancesIntent) {
      await tx.project.update({ where: { id: projectId }, data: { intentEpoch: nextIntentEpoch } });
    }
    const aggregateStatus = input.preemptiveControl!.kind === "pause"
      ? "paused_recovery"
      : input.preemptiveControl!.kind === "cancel" ? "canceled" : "superseded";
    await tx.taskAggregate.update({
      where: { taskId: activeAggregate!.taskId },
      data: {
        status: aggregateStatus,
        ...(input.preemptiveControl!.kind === "pause" ? {} : { planRevision: { increment: 1 } }),
      },
    });
    await updatePendingDecisionsForControl(tx, projectId, input.preemptiveControl!.kind);
  }

  const completesImmediately = preempted && input.preemptiveControl!.kind !== "redirect";
  const assistantMessage = completesImmediately
    ? await createControlAssistantMessage(tx, projectId, input, project.intentEpoch, nextIntentEpoch)
    : null;
  const now = new Date();
  const job = await tx.conversationTurnJob.create({
    data: {
      projectId,
      teacherMessageId: message.id,
      assistantMessageId: assistantMessage?.id,
      status: completesImmediately ? "succeeded" : "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 2,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.executionIdentity?.actorUserId,
      actorAuthMode: input.executionIdentity?.actorAuthMode,
      authSessionId: input.executionIdentity?.authSessionId,
      generationIntensity: project.generationIntensity,
      intensityVersion: project.intensityVersion,
      ...(completesImmediately ? { startedAt: now, finishedAt: now } : {}),
    },
  });
  return { message, job };
}

function assertExistingConversationTurn(job: ConversationTurnJob, input: EnqueueConversationTurnInput) {
  assertCanonicalPayloadMatch({
    schemaVersion: "conversation-turn-enqueue.v1",
    teacherMessageId: job.teacherMessageId,
    maxAttempts: job.maxAttempts,
    executionIdentity: {
      actorUserId: job.actorUserId,
      actorAuthMode: job.actorAuthMode,
      authSessionId: job.authSessionId,
    },
  }, conversationTurnPayload(input));
}

function assertExistingMessageTurn(
  message: ConversationMessage,
  job: ConversationTurnJob,
  input: EnqueueMessageAndConversationTurnInput,
) {
  const metadata = parseRecord(message.metadataJson);
  const expectedDigest = messageTurnPayloadDigest(input);
  const receipt = parseSubmissionReceipt(metadata[CONVERSATION_TURN_SUBMISSION_KEY]);
  if (receipt) {
    const persistedPayload = legacyMessageTurnPayload(message, job, receipt.preemptiveControl);
    assertCanonicalPayloadMatch(canonicalPayloadDigest(persistedPayload), receipt.payloadDigest);
    assertCanonicalPayloadMatch(receipt.payloadDigest, expectedDigest);
    return;
  }
  assertCanonicalPayloadMatch(legacyMessageTurnPayload(message, job), messageTurnPayload(input));
}

function legacyMessageTurnPayload(
  message: ConversationMessage,
  job: ConversationTurnJob,
  receiptControl?: unknown,
) {
  const metadata = { ...parseRecord(message.metadataJson) };
  delete metadata[CONVERSATION_TURN_SUBMISSION_KEY];
  const storedControl = parseRecord(metadata.preemptiveControl);
  const hasDerivedControl = Number.isInteger(storedControl.previousIntentEpoch) && Number.isInteger(storedControl.nextIntentEpoch);
  if (hasDerivedControl) delete metadata.preemptiveControl;
  return {
    schemaVersion: "conversation-message-turn-enqueue.v1",
    role: message.role,
    content: message.content,
    parts: parseArray(message.partsJson),
    artifactRefs: parseArray(message.artifactRefsJson),
    metadata,
    maxAttempts: job.maxAttempts,
    executionIdentity: {
      actorUserId: job.actorUserId,
      actorAuthMode: job.actorAuthMode,
      authSessionId: job.authSessionId,
    },
    preemptiveControl: receiptControl ?? (hasDerivedControl ? {
      kind: storedControl.kind,
      reasonCode: storedControl.reasonCode,
      advanceIntentEpoch: storedControl.advanceIntentEpoch,
      userMessage: storedControl.userMessage,
    } : null),
  };
}

async function createControlAssistantMessage(
  tx: TransactionClient,
  projectId: string,
  input: EnqueueMessageAndConversationTurnInput,
  previousIntentEpoch: number,
  nextIntentEpoch: number,
) {
  const control = input.preemptiveControl!;
  return tx.conversationMessage.create({
    data: {
      projectId,
      role: "assistant",
      content: control.kind === "pause"
        ? "已暂停当前任务，正在执行的旧步骤不会再提升为当前成果。"
        : "已取消当前任务，正在执行的旧步骤不会再提升为当前成果。",
      partsJson: "[]",
      artifactRefsJson: "[]",
      metadataJson: JSON.stringify({
        conversationControlDecision: {
          kind: control.kind,
          reasonCode: control.reasonCode,
          previousIntentEpoch,
          nextIntentEpoch,
        },
      }),
    },
  });
}

async function updatePendingDecisionsForControl(
  tx: TransactionClient,
  projectId: string,
  controlKind: "pause" | "cancel" | "redirect",
) {
  const status = controlKind === "pause" ? "pending" : controlKind === "cancel" ? "canceled" : "superseded";
  const messages = await tx.conversationMessage.findMany({
    where: { projectId },
    select: { id: true, metadataJson: true, partsJson: true },
  });
  for (const message of messages) {
    const metadata = parseRecord(message.metadataJson);
    const pendingDecision = metadata.pendingDecision;
    if (!isPendingDecision(pendingDecision) || pendingDecision.status !== "pending") continue;
    await tx.conversationMessage.update({
      where: { id: message.id },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          pendingDecision: withPendingDecisionStatus(pendingDecision, status),
        }),
        ...(status === "pending" ? {} : {
          partsJson: JSON.stringify(removeResolvedDecisionParts(message.partsJson, pendingDecision)),
        }),
      },
    });
  }
}
