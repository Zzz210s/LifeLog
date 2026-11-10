// Obsidian 侧只需要纯文本标签（原生那套 JSX 渲染在插件里用不上）
export function tagLabelPlain(tag: string): string {
  return String(tag).replace(/^#/, '').split('/').pop() ?? String(tag);
}
