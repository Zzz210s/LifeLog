export interface TutorialStep {
  id: string;
  /** 锚点回退链:第一个命中的赢;全不命中则该步被跳过 */
  selectors: string[];
  title: string;
  body: string;
  /** 该步开始前的动作(仅侧栏那步用) */
  before?: 'show-sidebar';
}

export const TUTORIAL_SEEN_KEY = 'ui.tutorial_seen';

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'input',
    selectors: ['[data-testid="unified-input"]'],
    title: '在这里记下一切',
    body: '主窗只有这一个输入框。直接打字就是记一条,按 Ctrl+Enter 保存。',
  },
  {
    id: 'prefix',
    selectors: ['[data-testid="prefix-hint"]'],
    title: '首字符决定它做什么',
    body: '> 执行命令, / 筛选, # 按标签筛选, @ 打开某个条目;不打前缀就是记笔记。前缀可以点。Ctrl+P 预填 @,Ctrl+Shift+P 预填 >。',
  },
  {
    id: 'tags',
    selectors: ['[data-testid="tag-list"]', '[data-testid="sidebar"]'],
    title: '标签就是分类',
    body: '所有内容是一条流,靠标签归类。层级用斜杠,例如 #工作/项目A。点标签即筛选(默认含子级),右键可以改名、移动、删除。',
    before: 'show-sidebar',
  },
  {
    id: 'topbar',
    // 锚点是视图导航组(2026-10-07 删掉顶栏 `⋯` 后换的):三个图标常驻,不在展开态才进 DOM
    selectors: ['[aria-label="视图导航"]'],
    title: '还有这些',
    body: '右上角切换信息流 / 关系图 / 设置。排序与添加条件在条件栏(信息流顶部);导出整库(Excel)在命令面板。另外 Ctrl+Shift+Q 随时唤起输入栏,托盘左键也能。',
  },
];
