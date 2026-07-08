import type { ArtifactItem } from "@/lib/types";

type MarkdownPreviewProps = {
  item: ArtifactItem;
  showHeader?: boolean;
};

function normalizeValue(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

function isMarkdownText(title: string, text: string) {
  return title === "Markdown" || /^#{1,3}\s/m.test(text) || /^-\s/m.test(text);
}

function renderMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pendingParagraph: string[] = [];
  let pendingList: string[] = [];

  function flushParagraph() {
    if (pendingParagraph.length === 0) return;
    blocks.push({ type: "paragraph", text: pendingParagraph.join(" ") });
    pendingParagraph.length = 0;
  }

  function flushList() {
    if (pendingList.length === 0) return;
    blocks.push({ type: "list", items: pendingList });
    pendingList = [];
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      pendingList.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("#")) {
      const match = /^(#{1,3})\s+(.+)$/.exec(line);
      if (match) {
        flushParagraph();
        flushList();
        blocks.push({ type: "heading", level: Math.min(match[1].length, 3) as 1 | 2 | 3, text: match[2].trim() });
        continue;
      }
    }
    flushList();
    pendingParagraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const className =
      block.level === 1
        ? "text-base font-semibold text-foreground"
        : block.level === 2
          ? "text-sm font-semibold text-foreground"
          : "text-sm font-medium text-foreground";
    return <h3 className={className}>{block.text}</h3>;
  }
  if (block.type === "list") {
    return (
      <ul className="space-y-1.5 pl-4 text-sm leading-7 text-muted-foreground">
        {block.items.map((entry) => (
          <li key={entry} className="list-disc pl-1">
            {entry}
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "paragraph") {
    return <p className="text-sm leading-7 text-muted-foreground">{block.text}</p>;
  }
}

export function MarkdownPreview({ item, showHeader = true }: MarkdownPreviewProps) {
  return (
    <article className="space-y-7 text-sm leading-7">
      {showHeader && (
        <section>
          <h1 className="title-lg">{item.title}</h1>
          <p className="mt-2 max-w-[34ch] text-muted-foreground">{item.summary}</p>
        </section>
      )}

      {item.previewFields.length > 0 && (
        <section className="space-y-2">
          <h2 className="title-md">关键字段</h2>
          <div className="divide-y rounded-md border bg-card">
            {item.previewFields.map((field) => (
              <div key={field.label} className="grid grid-cols-[78px_1fr] gap-3 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">{field.label}</div>
                <p className="min-w-0 text-sm leading-6">{field.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="title-md">正文预览</h2>
        {Object.entries(item.content).map(([title, value]) => (
          <div key={title} className="space-y-1.5">
            <h3 className="text-sm font-medium">{title}</h3>
            <div className="space-y-2">
              {normalizeValue(value).map((line) =>
                isMarkdownText(title, line) ? (
                  <div key={line} className="space-y-2.5">
                    {renderMarkdownBlocks(line).map((block, index) => (
                      <MarkdownBlockView key={`${block.type}-${index}`} block={block} />
                    ))}
                  </div>
                ) : (
                  <p key={line} className="text-sm leading-7 text-muted-foreground">
                    {line}
                  </p>
                ),
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2 border-t pt-5">
        <h2 className="title-md">上游来源</h2>
        <p className="text-muted-foreground">{item.sourceTitles.join("、") || "当前项目配置"}</p>
      </section>
    </article>
  );
}
