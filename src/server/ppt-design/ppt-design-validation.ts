export type PptDesignDraftValidationResult =
  | {
      valid: true;
      pageCount: number;
    }
  | {
      valid: false;
      pageCount: number;
      reason: "range_merged_pages" | "missing_page_designs" | "missing_four_layer_fields";
      message: string;
      mergedPageReferences?: string[];
      missingPages?: number[];
      missingLayerPages?: Array<{ page: number; missingLayers: string[] }>;
    };

const fourLayerLabels = ["底图", "元素", "文字", "排版"] as const;

export function validatePptDesignDraftForCoze(markdownContent: string): PptDesignDraftValidationResult {
  const pageCount = resolvePptDesignPageCount(markdownContent);
  const mergedPageReferences = findMergedPageRanges(markdownContent);
  if (mergedPageReferences.length > 0) {
    return {
      valid: false,
      pageCount,
      reason: "range_merged_pages",
      message: `PPT 设计稿未逐页完整：发现范围合并页（${mergedPageReferences.join("、")}）。请把每一页都独立写明底图、元素、文字、排版和教学动作。`,
      mergedPageReferences,
    };
  }

  const pageBlocks = extractPageDesignBlocks(markdownContent);
  const missingPages: number[] = [];
  const missingLayerPages: Array<{ page: number; missingLayers: string[] }> = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const block = pageBlocks.get(page);
    if (!block) {
      missingPages.push(page);
      continue;
    }
    const missingLayers = fourLayerLabels.filter((label) => !new RegExp(`${label}\\s*[:：]`).test(block));
    if (missingLayers.length > 0) {
      missingLayerPages.push({ page, missingLayers: [...missingLayers] });
    }
  }

  if (missingPages.length > 0) {
    return {
      valid: false,
      pageCount,
      reason: "missing_page_designs",
      message: `PPT 设计稿未逐页完整：缺少第 ${missingPages.join("、")} 页的独立四层设计。`,
      missingPages,
    };
  }

  if (missingLayerPages.length > 0) {
    const details = missingLayerPages
      .map((item) => `第 ${item.page} 页缺少${item.missingLayers.join("、")}`)
      .join("；");
    return {
      valid: false,
      pageCount,
      reason: "missing_four_layer_fields",
      message: `PPT 设计稿未逐页完整：${details}。`,
      missingLayerPages,
    };
  }

  return { valid: true, pageCount };
}

export function resolvePptDesignPageCount(markdownContent: string) {
  const explicit = markdownContent.match(/(?:页数|总页数|共)[:：\s]*(\d{1,2})\s*页/);
  if (explicit) {
    const pageCount = Number.parseInt(explicit[1], 10);
    if (Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= 30) return pageCount;
  }

  const pageRanges = [...markdownContent.matchAll(/第\s*(\d{1,2})\s*(?:[-—~至到]\s*(\d{1,2}))?\s*页/g)];
  const maxPageFromRanges = pageRanges.reduce((maxPage, match) => {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    const page = Math.max(start, end);
    return Number.isFinite(page) && page >= 1 ? Math.max(maxPage, page) : maxPage;
  }, 0);
  if (maxPageFromRanges > 0) return Math.min(maxPageFromRanges, 30);

  const pageMarkers = markdownContent.match(/(?:^|\n)#{1,4}\s*(?:第\s*)?\d{1,2}\s*页/g);
  if (pageMarkers?.length) return Math.min(pageMarkers.length, 30);

  return 12;
}

function findMergedPageRanges(markdownContent: string) {
  return [...markdownContent.matchAll(/第\s*(\d{1,2})\s*[-—~至到]\s*(\d{1,2})\s*页/g)]
    .filter((match) => Number.parseInt(match[1], 10) !== Number.parseInt(match[2], 10))
    .map((match) => match[0]);
}

function extractPageDesignBlocks(markdownContent: string) {
  const markers = [...markdownContent.matchAll(/(?:^|\n)(?:#{1,6}\s*)?第\s*(\d{1,2})\s*页[^\n]*/g)]
    .map((match) => ({ page: Number.parseInt(match[1], 10), index: match.index ?? 0 }))
    .filter((marker) => Number.isFinite(marker.page) && marker.page >= 1);
  const blocks = new Map<number, string>();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    blocks.set(marker.page, markdownContent.slice(marker.index, next?.index ?? markdownContent.length));
  }
  return blocks;
}
