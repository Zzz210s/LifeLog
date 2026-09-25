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
    body: '> 执行命令, / 筛选, # 按标签筛选, @ 打开某条笔记;不打前缀就是记笔记。前缀可以点。Ctrl+P 预填 @,Ctrl+Shift+P 预填 >。',
  },
  {
    id: 'tags',
    selectors: ['[data-testid="tag-list"]', '[data-testid="sidebar"]'],
    title: '标签就是分类',
    body: '所有内容是一条流,靠标签归类。层级用斜杠,例如 #工作/项目A。点标签即筛选(默认含子级),右键可以改名、移动、删除。',
    before: 'show-sidebar',
  },
  {
    id: 'tabs',
    selectors: ['[role="tablist"]'],
    title: '把当前筛选存成一个页',
    body: '标签页是一套筛选条件的快照。+ 里有全部、待办、无标签三个预设,也能把当前筛选开成新页;可拖动排序、双击改名。',
  },
  {
    id: 'topbar',
    selectors: ['[data-testid="topbar-menu"]'],
    title: '还有这些',
    body: '这个菜单里是排序、导出整库(Excel)、添加条件;齿轮进设置。另外 Ctrl+Shift+Q 随时唤起输入栏,托盘左键也能。',
  },
];
