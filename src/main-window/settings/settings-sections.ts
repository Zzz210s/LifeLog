/**
 * 设置页的分区注册表与导航判定(2026-10-04 重构)。
 *
 * 分区顺序与命名是**设计决定**(见 docs/superpowers/specs/2026-10-04-settings-redesign.md D9):
 * 外观 → 输入栏外观 → 输入栏行为 → 笔记 → 快捷键 → 启动 → 通用 → 关于。
 * 抽出为纯数据:导航、内容渲染、验收脚本共用一份,不再各写一遍字符串。
 */

export type SectionId =
  | 'appearance'
  | 'inputAppearance'
  | 'inputBehavior'
  | 'notes'
  | 'hotkey'
  | 'startup'
  | 'general'
  | 'about';

export interface SectionMeta {
  id: SectionId;
  /** 导航与分区标题共用的中文名 */
  label: string;
  /** 是否显示说明句(只有需要额外解释的分区才写) */
  note?: string;
}

export const SETTINGS_SECTIONS: readonly SectionMeta[] = [
  { id: 'appearance', label: '外观', note: '改动立即生效,并同时应用到输入栏' },
  { id: 'inputAppearance', label: '输入栏外观' },
  { id: 'inputBehavior', label: '输入栏行为', note: '改动立即生效并保存,不需要点保存按钮' },
  { id: 'notes', label: '笔记' },
  { id: 'hotkey', label: '快捷键' },
  { id: 'startup', label: '启动' },
  { id: 'general', label: '通用' },
  { id: 'about', label: '关于', note: '版本与数据文件,均只读' },
] as const;

/** 窗口多窄时导航改为顶部横向 tab 条(D1) */
export const NARROW_NAV_PX = 900;

export function isNarrowNav(windowWidth: number): boolean {
  return Number.isFinite(windowWidth) && windowWidth < NARROW_NAV_PX;
}

/** 当前分区不在注册表里(旧值/手改)时退回第一个 —— 绝不让内容区空白 */
export function normalizeSection(id: string | null | undefined): SectionId {
  const hit = SETTINGS_SECTIONS.find((s) => s.id === id);
  return hit ? hit.id : SETTINGS_SECTIONS[0].id;
}
