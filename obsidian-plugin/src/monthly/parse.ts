// 月度文件解析：`- HH:MM 正文 #标签 属性:: [[目标]]` → 条目。纯函数。
export type Entry = {
  file: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  text: string;
  tags: string[];
  rels: { name: string; to: string }[];
};

export const ENTRY = /^-\s+(\d{2}:\d{2})\s+(.*)$/;
const TAG = /(?:^|\s)#([^\s#[\]]+)/g;
const REL = /([^\s:：]+)::\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/** 一个文件（`# YYYY-MM` 头 + 条目行）→ 条目数组 */
export function parseMonthFile(path: string, raw: string): Entry[] {
  const month = raw.match(/^#\s+(\d{4}-\d{2})/m)?.[1] ?? path.match(/(\d{4}-\d{2})/)?.[1] ?? '';
  const out: Entry[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(ENTRY);
    if (!m) continue;
    const [, time, rest] = m;
    const rels = [...rest.matchAll(REL)].map((x) => ({ name: x[1], to: x[2].trim() }));
    const tags = [...rest.matchAll(TAG)].map((x) => x[1]);
    const text = rest
      .replace(REL, '')
      .replace(TAG, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ file: path, date: month ? `${month}-01` : '', time, text, tags, rels });
  }
  return out;
}

/** 条目 → 回到一行（发送时用，格式与解析对称） */
export function formatEntry(time: string, text: string, tags: string[], rels: { name: string; to: string }[]): string {
  const parts = [text.trim(), tags.map((t) => `#${t}`).join(' '), rels.map((r) => `${r.name}:: [[${r.to}]]`).join(' ')];
  return `- ${time} ${parts.filter(Boolean).join(' ')}`.trimEnd();
}

/** 侧栏统计：Top 标签、按小时分布、按月计数 */
export function stats(entries: Entry[]): { topTags: [string, number][]; byHour: number[]; byMonth: [string, number][] } {
  const tag = new Map<string, number>();
  const hour = new Array(24).fill(0) as number[];
  const month = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tags) tag.set(t, (tag.get(t) ?? 0) + 1);
    hour[Number(e.time.slice(0, 2)) % 24] += 1;
    const k = e.file.match(/(\d{4}-\d{2})/)?.[1];
    if (k) month.set(k, (month.get(k) ?? 0) + 1);
  }
  return {
    topTags: [...tag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    byHour: hour,
    byMonth: [...month.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}
