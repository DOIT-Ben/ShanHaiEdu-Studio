"use client";

import { useEffect, useState, type ComponentProps } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  ListChecks,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { DataMessagePartProps, TextMessagePartProps } from "@assistant-ui/react";
import remarkGfm from "remark-gfm";

import type {
  ActivityMessagePart,
  ArtifactRefMessagePart,
  DialogueCheckpointMessagePart,
  ErrorRecoveryMessagePart,
  HumanInputMessagePart,
  MessagePart,
  NextActionsMessagePart,
  PlanMessagePart,
  QualitySummaryMessagePart,
  ToolStatusMessagePart,
} from "@/lib/conversation-message-contract";
import type { ArtifactItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type MessagePartRendererActions = {
  artifacts: ArtifactItem[];
  onOpenArtifact: (artifactId: string) => void;
  onSelectAction: (prompt: string, actionId?: string) => void;
  onRecoverCheckpoint: (checkpointId: string) => void | Promise<void>;
  onRetryLoad: () => void;
};

export function createShanHaiMessagePartComponents(actions: MessagePartRendererActions) {
  return {
    Text: SafeMarkdownText,
    data: {
      by_name: {
        "shanhai.activity": (props: DataMessagePartProps<ActivityMessagePart>) => <ActivityPart {...props} actions={actions} />,
        "shanhai.plan": (props: DataMessagePartProps<PlanMessagePart>) => <PlanPart {...props} />,
        "shanhai.tool-status": (props: DataMessagePartProps<ToolStatusMessagePart>) => <ToolStatusPart {...props} />,
        "shanhai.artifact-ref": (props: DataMessagePartProps<ArtifactRefMessagePart>) => <ArtifactRefPart {...props} actions={actions} />,
        "shanhai.quality-summary": (props: DataMessagePartProps<QualitySummaryMessagePart>) => <QualitySummaryPart {...props} />,
        "shanhai.human-input": (props: DataMessagePartProps<HumanInputMessagePart>) => <HumanInputPart {...props} actions={actions} />,
        "shanhai.dialogue-checkpoint": (props: DataMessagePartProps<DialogueCheckpointMessagePart>) => <DialogueCheckpointPart {...props} actions={actions} />,
        "shanhai.next-actions": (props: DataMessagePartProps<NextActionsMessagePart>) => <NextActionsPart {...props} actions={actions} />,
        "shanhai.error-recovery": (props: DataMessagePartProps<ErrorRecoveryMessagePart>) => <ErrorRecoveryPart {...props} actions={actions} />,
      },
      Fallback: UnknownDataPart,
    },
  };
}

export function SafeMarkdownText(_props: TextMessagePartProps) {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      skipHtml
      className="space-y-2 break-words text-sm leading-7 text-foreground [&_a]:font-medium [&_a]:text-[#286d5d] [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[#b9ddd2] [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-[#f2f5f4] [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[#f5f7f6] [&_pre]:p-3 [&_ul]:list-disc"
      components={{ a: SafeMarkdownLink }}
    />
  );
}

function SafeMarkdownLink({ href, children, node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  const safeHref = resolveSafeMarkdownHref(href);
  if (!safeHref) return <span>{children}</span>;
  return (
    <a {...props} href={safeHref} target={safeHref.startsWith("https://") ? "_blank" : undefined} rel={safeHref.startsWith("https://") ? "noreferrer" : undefined}>
      {children}
    </a>
  );
}

export function resolveSafeMarkdownHref(href: unknown) {
  if (typeof href !== "string") return undefined;
  const candidate = href.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return undefined;
  try {
    if (/^https:\/\//i.test(candidate)) {
      const external = new URL(candidate);
      return external.protocol === "https:" ? external.href : undefined;
    }
    if (!candidate.startsWith("/")) return undefined;
    const base = new URL("https://shanhai.invalid");
    const internal = new URL(candidate, base);
    if (internal.origin !== base.origin) return undefined;
    return `${internal.pathname}${internal.search}${internal.hash}`;
  } catch {
    return undefined;
  }
}

function ActivityPart({ data, actions }: DataMessagePartProps<ActivityMessagePart> & { actions: MessagePartRendererActions }) {
  const active = data.status === "queued" || data.status === "running" || data.status === "waiting";
  const artifact = (data.artifactRefs ?? []).map((artifactId: string) => actions.artifacts.find((candidate) => candidate.artifactId === artifactId)).find(Boolean);
  const elapsedMs = useRealElapsedMs(data.startedAt, data.durationMs, active);
  return (
    <div
      data-message-part="activity"
      data-activity-inline
      data-agent-progress-step
      data-activity-kind={data.activityKind}
      data-reason-code={data.reasonCode}
      className="relative grid min-h-11 grid-cols-[24px_minmax(0,1fr)] gap-2.5 pb-2 text-muted-foreground before:absolute before:bottom-[-4px] before:left-[11px] before:top-6 before:w-px before:bg-[#dfe8e5] last:pb-0 last:before:hidden"
    >
      <span className={cn("relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border bg-white", active ? "border-[#b9d9d1] text-[#367d6d]" : data.status === "failed" || data.status === "blocked" ? "border-[#efd5cf] text-[#a44234]" : "border-[#d7e6e2] text-[#2f7a66]")}>
        {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <StatusIcon status={data.status} className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm leading-5 text-foreground">{data.label}</p>
        {(data.purpose || data.inputSummary?.length || data.expectedOutput || data.observationSummary || elapsedMs !== undefined) && (
          <dl className="mt-1.5 grid gap-1 text-xs leading-5 text-muted-foreground">
            {data.purpose && <DetailLine label="目的" value={data.purpose} />}
            {data.inputSummary?.map((item: string, index: number) => <DetailLine key={`${data.activityId}:input:${index}`} label={index === 0 ? "依据" : ""} value={item} />)}
            {data.expectedOutput && <DetailLine label="将形成" value={data.expectedOutput} />}
            {data.observationSummary && <DetailLine label="结果" value={data.observationSummary} />}
            {elapsedMs !== undefined && <DetailLine label={active ? "已运行" : "用时"} value={formatElapsed(elapsedMs)} />}
          </dl>
        )}
        {artifact?.artifactId && (
          <button type="button" onClick={() => actions.onOpenArtifact(artifact.artifactId!)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#32685d] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35">
            <FileText className="h-3.5 w-3.5" />
            查看刚生成的{artifact.title}
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function DialogueCheckpointPart({ data, actions }: DataMessagePartProps<DialogueCheckpointMessagePart> & { actions: MessagePartRendererActions }) {
  return (
    <PartSurface data-message-part="dialogue-checkpoint" data-checkpoint-id={data.checkpointId} className="border-[#d8dfdc] bg-[#fbfcfc]">
      <p className="text-xs leading-5 text-muted-foreground">当前理解：{data.understandingSummary}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">{data.question}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">影响：{data.impactSummary}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.options.map((option: DialogueCheckpointMessagePart["options"][number]) => (
          <button
            key={option.id}
            type="button"
            data-dialogue-option={option.id}
            onClick={() => actions.onSelectAction(option.label)}
            className={cn("min-h-11 rounded-md border bg-white px-3 py-2 text-left transition hover:border-[#9fc9be] hover:bg-[#f8fbfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35", option.recommended && "border-[#b9d9d1]")}
          >
            <span className="block text-sm font-medium text-foreground">{option.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
    </PartSurface>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <dt>{label}</dt>
      <dd className="min-w-0 break-words text-foreground/75">{value}</dd>
    </div>
  );
}

function useRealElapsedMs(startedAt: string | undefined, settledDurationMs: number | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (typeof settledDurationMs === "number") return Math.max(0, settledDurationMs);
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, now - start) : undefined;
}

function formatElapsed(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function PlanPart({ data }: DataMessagePartProps<PlanMessagePart>) {
  return (
    <PartSurface data-message-part="plan">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ListChecks className="h-4 w-4 text-[#367d6d]" />
        <span>{data.title}</span>
        <span className="text-xs font-normal text-muted-foreground">第 {data.revision} 版</span>
      </div>
      {data.steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {data.steps.map((step: PlanMessagePart["steps"][number]) => (
            <li key={step.id} className="flex items-center gap-2 text-xs leading-5 text-foreground">
              <StatusIcon status={step.status} />
              <span className="min-w-0 flex-1">{step.title}</span>
              <StatusLabel status={step.status} />
            </li>
          ))}
        </ol>
      )}
    </PartSurface>
  );
}

function ToolStatusPart({ data }: DataMessagePartProps<ToolStatusMessagePart>) {
  return (
    <PartSurface data-message-part="tool-status" data-reason-code={data.reasonCode} className="flex items-center gap-2.5">
      <StatusIcon status={data.status} />
      <span className="min-w-0 flex-1 text-sm text-foreground">{data.label}</span>
      <StatusLabel status={data.status} />
    </PartSurface>
  );
}

function ArtifactRefPart({ data, actions }: DataMessagePartProps<ArtifactRefMessagePart> & { actions: MessagePartRendererActions }) {
  const artifact = actions.artifacts.find((candidate) => candidate.artifactId === data.artifactId);
  return (
    <PartSurface data-message-part="artifact-ref" data-artifact-id={data.artifactId} className="border-[#cde4dd] bg-[#fbfefd]">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#cae2db] bg-white text-[#32685d]">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{data.title}</span>
            <span className="text-xs text-muted-foreground">第 {data.version} 版</span>
          </div>
          {data.summary && <p className="mt-1 text-xs leading-5 text-muted-foreground">{data.summary}</p>}
          {artifact && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#32685d] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/40" onClick={() => actions.onOpenArtifact(data.artifactId)}>
              打开成果
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </PartSurface>
  );
}

function QualitySummaryPart({ data }: DataMessagePartProps<QualitySummaryMessagePart>) {
  const outcome = data.outcome as QualitySummaryMessagePart["outcome"];
  return (
    <PartSurface data-message-part="quality-summary" data-quality-outcome={outcome}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck className={cn("mt-0.5 h-4 w-4 shrink-0", outcome === "passed" ? "text-[#2f7a66]" : "text-[#a4662f]")} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{qualityOutcomeLabel[outcome]}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{data.summary}</p>
          {data.findingLocators.length > 0 && <p className="mt-1 text-xs text-muted-foreground">有 {data.findingLocators.length} 处需要查看</p>}
        </div>
      </div>
    </PartSurface>
  );
}

function HumanInputPart({ data, actions }: DataMessagePartProps<HumanInputMessagePart> & { actions: MessagePartRendererActions }) {
  return (
    <PartSurface data-message-part="human-input" data-decision-id={data.decisionId} className="border-[#eadcc9] bg-[#fffdfa]">
      <p className="text-sm font-medium text-foreground">{data.question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.options.map((option: HumanInputMessagePart["options"][number]) => (
          <button
            key={option.id}
            type="button"
            data-human-input-option={option.id}
            onClick={() => actions.onSelectAction(option.label, data.actionId)}
            className={cn("rounded-md border bg-white px-3 py-1.5 text-xs text-foreground transition hover:border-[#c9b18d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9b18d]/40", option.recommended && "border-[#c9b18d] bg-[#fff9ef]")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </PartSurface>
  );
}

function NextActionsPart({ data, actions }: DataMessagePartProps<NextActionsMessagePart> & { actions: MessagePartRendererActions }) {
  return (
    <div data-message-part="next-actions" className="mt-3 flex flex-wrap gap-2">
      {data.actions.map((action: NextActionsMessagePart["actions"][number]) => (
        <button
          key={action.id}
          type="button"
          data-next-action={action.kind}
          onClick={() => action.kind === "open_artifact" && action.artifactId ? actions.onOpenArtifact(action.artifactId) : actions.onSelectAction(action.prompt ?? action.label, action.actionId)}
          className={cn("inline-flex min-h-8 items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs text-foreground transition hover:border-[#b9ddd2] hover:bg-[#f7fbfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35", action.recommended && "border-[#b9ddd2] bg-[#f7fbfa] text-[#32685d]")}
        >
          {action.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

function ErrorRecoveryPart({ data, actions }: DataMessagePartProps<ErrorRecoveryMessagePart> & { actions: MessagePartRendererActions }) {
  function recover() {
    if (data.recovery.kind === "reload") actions.onRetryLoad();
    else if (data.recovery.kind === "resume" && data.recovery.checkpointId) {
      void actions.onRecoverCheckpoint(data.recovery.checkpointId);
    } else actions.onSelectAction(data.recovery.label, data.recovery.actionId);
  }

  return (
    <PartSurface data-message-part="error-recovery" data-reason-code={data.reasonCode} className="border-[#efd5cf] bg-[#fffafa]">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#a44234]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{data.summary}</p>
          <button type="button" onClick={recover} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#8c392e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7897f]/35">
            <RotateCcw className="h-3.5 w-3.5" />
            {data.recovery.label}
          </button>
        </div>
      </div>
    </PartSurface>
  );
}

function UnknownDataPart(_props: DataMessagePartProps<MessagePart>) {
  return <div data-message-part="unsupported" className="mt-2 text-xs text-muted-foreground">这部分消息暂时无法安全显示，请重新加载后继续。</div>;
}

function PartSurface({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("mt-3 max-w-[720px] rounded-md border border-[#dfe7e4] bg-[#fcfdfd] px-3.5 py-3", className)} />;
}

function StatusIcon({ status, className }: { status: string; className?: string }) {
  if (status === "running" || status === "queued" || status === "waiting") return <Clock3 className={cn("h-4 w-4 shrink-0 text-[#367d6d]", className)} />;
  if (status === "completed" || status === "succeeded") return <CheckCircle2 className={cn("h-4 w-4 shrink-0 text-[#2f7a66]", className)} />;
  if (status === "failed" || status === "blocked" || status === "canceled") return <AlertCircle className={cn("h-4 w-4 shrink-0 text-[#a44234]", className)} />;
  return <Circle className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)} />;
}

function StatusLabel({ status }: { status: string }) {
  return <span className="shrink-0 text-xs text-muted-foreground">{statusLabels[status] ?? "待处理"}</span>;
}

const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  waiting: "等待中",
  paused: "已暂停",
  pending: "待开始",
  completed: "已完成",
  succeeded: "已完成",
  failed: "未完成",
  blocked: "需处理",
  canceled: "已取消",
  skipped: "已跳过",
};

const qualityOutcomeLabel: Record<QualitySummaryMessagePart["outcome"], string> = {
  pending: "正在检查",
  passed: "检查通过",
  needs_repair: "需要调整",
  blocked: "暂时无法继续",
  failed: "检查未通过",
};
