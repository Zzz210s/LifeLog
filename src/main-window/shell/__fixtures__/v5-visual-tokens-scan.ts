/**
 * V5 视觉门禁的扫描面与取类名工具(自 v5-visual-tokens.gate.test.ts 抽出守 200 行红线;
 * 与 `audit-visual-card.mjs` 那次的拆法同一路数:表与工具独立,用例文件只留断言)。
 * 不渲染,只读源码文本;注释里的类名不算命中(`code` 去注释)。
 */
import { readFileSync } from 'node:fs';

const ROOT = 'src/main-window';

/** V5 改动到的文件(相对 src/main-window) */
export const FILES = [
  'palette/PaletteRow.tsx',
  'filter/ExprDialog.tsx',
  'filter/ExprSyntaxHint.tsx',
  'filter/TagPickDialog.tsx',
  'filter/RelationPickDialog.tsx',
  'filter/AddConditionMenu.tsx',
  'filter/SortPanel.tsx',
  'filter/GroupByPanel.tsx',
  'stream/GroupHeader.tsx',
  'stream/GroupLog.tsx',
  'shell/TopBar.tsx', 'shell/ExportNotice.tsx',
  'shell/ViewNav.tsx', 'filter/SortMenuButton.tsx',
  // 批量编辑(spec 2026-10-17):浮条与标签输入同样受字号/圆角/按钮门禁管
  'filter/BatchToggle.tsx', 'filter/BatchBar.tsx', 'filter/BatchTagInput.tsx',
  'sidebar/TagRow.tsx',
  'sidebar/TagsHeader.tsx',
  'sidebar/TagsSection.tsx',
  'sidebar/TagRootDropBar.tsx',
  'sidebar/TagMenu.tsx',
  'sidebar/TagMenuMainPane.tsx',
  'sidebar/TagMenuRenamePane.tsx',
  'sidebar/TagMenuAliasPane.tsx',
  'sidebar/TagMenuMovePane.tsx',
  'sidebar/TagMenuRelationPane.tsx',
  'sidebar/TagMenuRelationList.tsx',
  'sidebar/TagMenuRelationCandidates.tsx',
  'sidebar/TagMenuDeletePane.tsx',
  'sidebar/tag-menu-ui.ts',
  'settings/SettingsView.tsx',
  'settings/controls.tsx',
  'settings/AppearanceSection.tsx',
  'settings/InputBehaviorPanel.tsx',
  'graph/GraphFilterPanel.tsx',
  'graph/GraphInfoBar.tsx',
  'graph/GraphTip.tsx',
  'graph/GraphSearch.tsx',
  'graph/GraphToolbar.tsx',
  'graph/GraphStatus.tsx',
  'settings/InputAppearanceSection.tsx',
  'settings/appearance-controls.tsx',
  'settings/color-popover.tsx',
  'settings/NotesSection.tsx',
  'settings/StartupSection.tsx',
  'settings/GeneralSection.tsx',
  'settings/HotkeyRecorder.tsx',
  'shell/button-classes.ts',
  'tutorial/TutorialBubble.tsx',
] as const;

/** 浮层容器(需 rounded-lg + 阴影或遮罩):文件 -> 期望的容器类名片段 */
export const FLOATS: Array<[string, string]> = [
  ['filter/ExprDialog.tsx', 'role="dialog"'],
  ['filter/TagPickDialog.tsx', 'role="dialog"'],
  ['filter/RelationPickDialog.tsx', 'role="dialog"'],
  ['filter/SortMenuButton.tsx', 'role="menu"'],
  ['filter/AddConditionMenu.tsx', 'role="menu"'], ['sidebar/TagMenu.tsx', 'role="menu"'],
  ['tutorial/TutorialBubble.tsx', 'role="dialog"'],
  ['settings/color-popover.tsx', 'role="menu"'],
];

/** 有模态遮罩的文件(对话框的 bg-overlay;2/3 Task 5 已删零使用者的 .overlay-scrim) */
export const SCRIMS: Array<[string, string]> = [
  ['filter/ExprDialog.tsx', 'bg-overlay'],
  ['filter/TagPickDialog.tsx', 'bg-overlay'],
  ['filter/RelationPickDialog.tsx', 'bg-overlay'],
  ['tutorial/TutorialOverlay.tsx', 'bg-overlay'],
];

export const src = (file: string): string => readFileSync(`${ROOT}/${file}`, 'utf8');

/** 去掉注释后的源码(注释里可以自由提到类名,不算命中) */
export const code = (file: string): string =>
  src(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** 取某个标签的所有 className 表达式(含字符串模板里的两段) */
export function classExprs(text: string, tag: string): string[] {
  const out: string[] = [];
  let i = text.indexOf(`<${tag}`);
  while (i >= 0) {
    const seg = text.slice(i, i + 900);
    const m = /className=(?:\{([\s\S]{0,400}?)\}|"([^"]*)")/.exec(seg);
    if (m) out.push((m[1] ?? m[2]).replace(/\s+/g, ' ').trim());
    i = text.indexOf(`<${tag}`, i + tag.length + 1);
  }
  return out;
}

/** 越档字号类:text-xs/sm/base/lg/xl/text-[Npx] */
export const OFF_SCALE_TYPE = /\btext-(?:xs|sm|base|lg|xl|2xl|\d|\[)/g;

export const allClassExprs = (file: string): string[] =>
  code(file).match(/className=(?:\{[\s\S]{0,400}?\}|"[^"]*")/g) ?? [];
