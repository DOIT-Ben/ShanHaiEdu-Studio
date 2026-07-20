export {
  legacyContentToMessageParts,
  MESSAGE_PART_VERSION,
  normalizeMessageParts,
  toDialogueCheckpointPart,
} from "./conversation-message-parts";
export type {
  ActivityMessagePart,
  ArtifactRefMessagePart,
  DialogueCheckpointMessagePart,
  ErrorRecoveryMessagePart,
  HumanInputMessagePart,
  MessagePart,
  NextActionsMessagePart,
  PlanMessagePart,
  QualitySummaryMessagePart,
  TextMessagePart,
  ToolStatusMessagePart,
} from "./conversation-message-parts";
export {
  projectConversationMessageParts,
  projectMessagePartsToAssistantUi,
} from "./conversation-message-projection";
export type {
  AssistantUiCompatibleMessage,
  ConversationMessageArtifactProjection,
} from "./conversation-message-projection";
