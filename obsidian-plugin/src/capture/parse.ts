// 捕获前缀解析，口径对齐原生输入栏：/ 命令、# 标签、[[ 链接、> 结构化。
export type Capture = {
  body: string;
  tags: string[];
  links: string[];
  commands: string[];
  parent: string | null;
};

const CMD = /(?:^|\s)\/([^\s/]+(?:\/[^\s/]+)*)/g;
const TAG = /(?:^|\s)#([^\s#[\]]+)/g;
const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const PARENT = /(?:^|\s)>([^\s>]+(?:\/[^\s>]+)*)/g;

export function parseCapture(text: string): Capture {
  const tags = [...text.matchAll(TAG)].map((m) => m[1]);
  const links = [...text.matchAll(LINK)].map((m) => m[1].trim());
  const commands = [...text.matchAll(CMD)].map((m) => m[1]);
  const parents = [...text.matchAll(PARENT)].map((m) => m[1]);
  // 正文里剥掉前缀与标签/链接：保存时会按解析结果重新拼一份规范形式，避免重复。
  const body = text
    .replace(CMD, '')
    .replace(PARENT, '')
    .replace(LINK, '')
    .replace(TAG, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { body, tags, links, commands, parent: parents.at(-1) ?? null };
}

/** 标签路径的父级（`地点/印度` → `地点`），用于树归属。 */
export function parentOfTag(tag: string): string | null {
  const i = tag.lastIndexOf('/');
  return i > 0 ? tag.slice(0, i) : null;
}
