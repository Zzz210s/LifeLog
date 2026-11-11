// 月度文件合并：把「一篇笔记一个文件」的旧格式合并成 `YYYY-MM.md`。
// 纯函数，便于单测；副作用（读文件、删原文件）在 run.ts 里。
export type NoteIn = {
  path: string;
  created: string; // 2026-10-26T12:01:32 或 2026-10-26 12:01:32
  body: string;
  tags: string[];
  rels: { name: string; to: string }[];
};

export type MonthFile = { path: string; content: string; count: number };

export function monthKey(created: string): string {
  const d = created.trim().slice(0, 10);
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '0000-00';
}

export function clock(created: string): string {
  const m = created.match(/(\d{2}:\d{2})/);
  return m ? m[1] : '00:00';
}

/** 一条笔记 → 一行条目：`- HH:MM 正文 #标签 关系名:: [[目标]]` */
export function toLine(n: NoteIn): string {
  const text = n.body.replace(/\s+/g, ' ').trim();
  const tags = n.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const rels = n.rels.map((r) => `${r.name}:: [[${r.to}]]`).join(' ');
  return `- ${clock(n.created)} ${[text, tags, rels].filter(Boolean).join(' ')}`.trimEnd();
}

/** 按年月分组，月内按时间升序；输出可直接写盘的文件内容。 */
export function mergeToMonths(notes: NoteIn[], folder: string): MonthFile[] {
  const groups = new Map<string, NoteIn[]>();
  for (const n of notes) {
    const key = monthKey(n.created);
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }
  const out: MonthFile[] = [];
  for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.created.localeCompare(b.created));
    const lines = list.map(toLine);
    out.push({
      path: `${folder}/${key}.md`,
      content: [`# ${key}`, '', ...lines, ''].join('\n'),
      count: lines.length,
    });
  }
  return out;
}

/** 只保留真正有内容的笔记（空正文且无标签/关系的不迁）。 */
export function worthMigrating(n: NoteIn): boolean {
  return n.body.trim().length > 0 || n.tags.length > 0 || n.rels.length > 0;
}
