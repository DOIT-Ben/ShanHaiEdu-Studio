import type { ArtifactItem } from "@/lib/types";

type MarkdownPreviewProps = {
  item: ArtifactItem;
};

function normalizeValue(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

export function MarkdownPreview({ item }: MarkdownPreviewProps) {
  return (
    <article className="space-y-6 text-sm leading-7">
      <section>
        <h1 className="title-lg">{item.title}</h1>
        <p className="mt-2 text-muted-foreground">{item.summary}</p>
      </section>

      {item.previewFields.length > 0 && (
        <section className="space-y-3">
          <h2 className="title-md">关键字段</h2>
          <div className="space-y-3">
            {item.previewFields.map((field) => (
              <div key={field.label} className="border-l pl-3">
                <div className="text-xs text-muted-foreground">{field.label}</div>
                <p className="mt-1">{field.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="title-md">正文预览</h2>
        {Object.entries(item.content).map(([title, value]) => (
          <div key={title} className="space-y-2">
            <h3 className="text-sm font-medium">{title}</h3>
            <div className="space-y-2 text-muted-foreground">
              {normalizeValue(value).map((line) => (
                <p key={line}>{line}</p>
              ))}
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
