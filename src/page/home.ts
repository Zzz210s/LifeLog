// LifeLog 页面：一个由插件生成的普通 Markdown 笔记，全部内容靠 Obsidian 原生能力承载
// （Bases 嵌入块 / 链接 / 命令）。不引入任何新文件格式，也不自绘 UI —— 升级不会坏。
export type PageInput = {
  root: string;
  library: string;
  counts: { notes: number; entities: number; relations: number };
  bases: string[];
};

export function homePage(i: PageInput): string {
  const { root, library, counts, bases } = i;
  return [
    `# ${library}`,
    '',
    `> 笔记 **${counts.notes}** · 实体 **${counts.entities}** · 命名关系 **${counts.relations}**`,
    '> 记一条：命令面板 → `LifeLog: 捕获`（`#标签`、`[[链接]]`、`>父级`）',
    '',
    '## 信息流',
    '',
    embedBase(`${root}/信息流.base`),
    '',
    '## 标签树',
    '',
    embedBase(`${root}/标签索引.base`),
    '',
    '## 命名关系',
    '',
    embedBase(`${root}/关系表.base`),
    '',
    '## 时间轴',
    '',
    embedBase(`${root}/时间轴.base`),
    '',
    '## 换一种看法',
    '',
    `- 整体关系图：命令面板 → \`关系图谱\`（Obsidian 原生图，标签已是节点）`,
    `- 局部关系：打开任意笔记 → 右侧「局部图谱」`,
    `- 纯表格：${bases.map((b) => `[[${b}]]`).join(' · ') || '（未生成）'}`,
    '',
    '---',
    `<!-- lifelog:page v1｜由插件生成，可随意改；重建会覆盖 ${root}/LifeLog.md -->`,
    '',
  ].join('\n');
}

/** 嵌入一个 .base 文件（Obsidian 支持 `![[x.base]]` 与 base 代码块两种；这里用文件嵌入，改模板即可全局生效） */
function embedBase(path: string): string {
  return `![[${path}]]`;
}
