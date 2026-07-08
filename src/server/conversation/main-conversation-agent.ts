import { planCapabilityForRequest, planDeliveryForRequest } from "@/server/capabilities/capability-planner";
import type { MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";

export type MainConversationAgentInput = {
  userMessage: string;
  availableArtifactKinds: string[];
  projectContext?: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
};

export type MainConversationAgent = {
  respond(input: MainConversationAgentInput): Promise<MainAgentTurn>;
};

export function createDeterministicMainConversationAgent(): MainConversationAgent {
  return {
    async respond(input) {
      const text = input.userMessage.trim();

      if (isCasualChat(text)) {
        return {
          assistantMessage: {
            body: "我在。你可以先随便聊，也可以告诉我年级、学科、课题和想做的材料。",
          },
          state: "chatting",
          quickReplies: [
            { label: "做公开课课件", prompt: "我想做一节小学数学公开课课件。", recommended: true },
            { label: "先聊课程创意", prompt: "我想先聊聊一节课的导入创意。" },
          ],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      if (isExplorationOnly(text)) {
        return {
          assistantMessage: {
            body: "可以，我们先不急着生成材料。你可以先从课堂目标、导入情境和学生互动方式里选一个方向聊起。",
          },
          state: "exploring",
          quickReplies: [
            { label: "先聊导入", prompt: "先帮我想几个导入情境。", recommended: true },
            { label: "设计互动", prompt: "帮我设计几个课堂互动。" },
            { label: "开始整理需求", prompt: "我已经有方向了，帮我整理成备课需求。" },
          ],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      const toolPlan = planCapabilityForRequest(input);
      const deliveryPlan = planDeliveryForRequest(input) ?? undefined;
      if (!toolPlan) {
        return {
          assistantMessage: {
            body: "我先不启动生成。你可以补充年级、学科、课题和想要的交付物，我再帮你整理。",
          },
          state: "collecting_inputs",
          quickReplies: defaultCollectionReplies(),
          recommendedOptions: defaultRecommendedOptions(),
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      if (toolPlan.missingInputs.length > 0) {
        return {
          assistantMessage: {
            body: "可以做，但我还需要补齐年级、学科和课题，这样生成的内容才不会跑偏。",
          },
          state: "collecting_inputs",
          quickReplies: defaultCollectionReplies(),
          recommendedOptions: defaultRecommendedOptions(),
          toolPlan,
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      return {
        assistantMessage: {
          title: "我理解你的任务",
          body: deliveryPlan
            ? "你想做一套完整公开课材料。我会先整理需求，再按计划推进教案、PPT、图片、导入视频和最终交付包。"
            : "你想做一套公开课相关材料。我建议先把需求规格整理清楚，再继续生成 PPT 大纲和可下载文件。",
        },
        state: "awaiting_confirmation",
        quickReplies: deliveryPlan ? deliveryPlanConfirmationReplies() : singleStepConfirmationReplies(),
        recommendedOptions: [],
        toolPlan,
        deliveryPlan,
        shouldRunToolNow: false,
        runtimeKind: "deterministic",
      };
    },
  };
}

function singleStepConfirmationReplies(): QuickReply[] {
  return [
    { label: "确认开始", prompt: "确认开始，先整理需求规格。", recommended: true },
    { label: "补充要求", prompt: "我想补充教学风格和课堂时长。" },
    { label: "先聊创意", prompt: "先不要生成，继续聊几个课堂创意。" },
  ];
}

function deliveryPlanConfirmationReplies(): QuickReply[] {
  return [
    { label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true },
    { label: "补充要求", prompt: "我想补充教学风格和课堂时长。" },
    { label: "先只做文本", prompt: "先只生成需求、教案和 PPT 大纲。" },
  ];
}

function isCasualChat(text: string): boolean {
  return ["你好", "您好", "hi", "hello", "在吗", "谢谢"].includes(text.toLowerCase());
}

function isExplorationOnly(text: string): boolean {
  return /聊聊|想法|创意|怎么设计|怎么上/.test(text) && !/帮我做|生成|做一个|做份|输出/.test(text);
}

function defaultCollectionReplies(): QuickReply[] {
  return [
    { label: "三年级数学公开课", prompt: "我想做三年级数学公开课，需要教案和 PPT。", recommended: true },
    { label: "六年级百分数", prompt: "苏教版六年级百分数，帮我做公开课课件。" },
    { label: "先整理需求", prompt: "先帮我整理备课需求，我再补充信息。" },
  ];
}

function defaultRecommendedOptions(): RecommendedOption[] {
  return [
    { slot: "grade", label: "三年级", value: "三年级", recommended: true },
    { slot: "subject", label: "数学", value: "数学", recommended: true },
    { slot: "output", label: "教案 + PPT", value: "教案和 PPT" },
  ];
}
