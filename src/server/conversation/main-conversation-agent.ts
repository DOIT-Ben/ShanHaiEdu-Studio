import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import type { MainAgentTurn } from "@/server/capabilities/types";
import type { AgentWorldState } from "@/server/conversation/agent-world-state";
import type { ContextPackage } from "@/server/conversation/context-package";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import type {
  MainAgentReActBudgetExhausted,
  MainAgentReActCompletionContract,
  MainAgentReActContextTelemetry,
  MainAgentReActDispatchResult,
  MainAgentReActRecoveryCheckpoint,
  MainAgentReActRejectedToolCall,
  MainAgentReActSegmentCheckpoint,
  MainAgentReActToolSet,
} from "@/server/conversation/main-agent-controlled-react-loop";
import type {
  MainAgentReActCheckpoint,
  MainAgentReActCheckpointSeed,
} from "@/server/conversation/main-agent-react-checkpoint";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { TaskBriefProposalInput } from "./task-intake";
import type { IntentGrant, TaskBrief } from "./task-contract";
import type { SemanticContextSnapshot } from "./context-semantic-snapshot";
import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import type { PreAgentControlDecision } from "./turn-intake-control";

export type MainConversationAgentInput = {
  userMessage: string;
  taskBrief?: TaskBrief;
  intentGrant?: IntentGrant | { standardWorkAuthorized: boolean };
  responseStyle?: XiaoKuResponseStyle;
  generationIntensity?: GenerationIntensity;
  availableArtifactKinds: string[];
  onProgress?: MainAgentProgressSink;
  projectContext?: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
  conversationContext?: {
    contextPackage?: ContextPackage;
    agentWorldState?: AgentWorldState;
    capabilityAvailability?: CapabilityAvailabilityEntry[];
    semanticSnapshot?: SemanticContextSnapshot;
    recentMessages: Array<{ role: "teacher" | "assistant" | "system"; content: string }>;
    latestAssistantContent?: string;
  };
  agentToolLoop?: {
    tools: unknown[];
    allowedToolNames: readonly string[];
    prepareTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
    refreshTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
    describeToolCall?: (call: { toolName: string; arguments: Record<string, unknown> }) => {
      purpose?: string;
      inputSummary?: string[];
      expectedOutput?: string;
    } | Promise<{
      purpose?: string;
      inputSummary?: string[];
      expectedOutput?: string;
    }>;
    dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
    validateCompletion?: () => MainAgentReActCompletionContract | Promise<MainAgentReActCompletionContract>;
    maxToolRounds?: number;
    maxToolRoundsPerSegment?: number;
    resumeCheckpoint?: MainAgentReActCheckpoint;
    checkpointSeed?: MainAgentReActCheckpointSeed;
    getCheckpointSeed?: () => MainAgentReActCheckpointSeed;
    onContextTelemetry?: (event: MainAgentReActContextTelemetry) => void | Promise<void>;
    onRejectedToolCall?: (event: MainAgentReActRejectedToolCall) => void | Promise<void>;
    onBudgetExhausted?: (event: MainAgentReActBudgetExhausted) => void | Promise<void>;
    onSegmentCheckpoint?: (event: MainAgentReActSegmentCheckpoint) => void | Promise<void>;
    onRecoveryCheckpoint?: (event: MainAgentReActRecoveryCheckpoint) => void | Promise<void>;
  };
  replanDirective?: {
    reason: "tool_succeeded" | "tool_failed" | "quality_rework" | "completion_contract_unsatisfied";
    previousActionKey: string;
    observationIds: string[];
    remainingRequestedOutputs?: string[];
    repairAction?: "fix_inputs" | "retry_later" | "ask_teacher" | "do_not_retry_automatically";
    reliableDefaultsAvailable?: boolean;
  };
};

export type MainConversationAgent = {
  intakeTask?: (input: MainAgentTaskIntakeInput) => Promise<MainAgentTaskIntakeDecision>;
  respond(input: MainConversationAgentInput): Promise<MainAgentTurn>;
};

export type MainAgentTaskIntakeInput = {
  userMessage: string;
  responseStyle?: XiaoKuResponseStyle;
  generationIntensity: GenerationIntensity;
  projectContext: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
  activeTask?: Pick<TaskBrief, "taskId" | "digest" | "intentEpoch" | "goal" | "requestedOutputs" | "constraints" | "excludedOutputs">;
  recentMessages: Array<{ role: "teacher" | "assistant" | "system"; content: string }>;
  onProgress?: MainAgentProgressSink;
};

export type MainAgentTaskIntakeDecision =
  | { kind: "task"; proposal: TaskBriefProposalInput }
  | { kind: "control"; control: PreAgentControlDecision; replacementProposal?: TaskBriefProposalInput }
  | { kind: "conversation"; turn?: MainAgentTurn }
  | { kind: "failed"; turn: MainAgentTurn };
