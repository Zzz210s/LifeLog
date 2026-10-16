/**
 * 单击实体行的行为模式:`filter`(筛选,现状/默认)/ `open`(打开预览卡片)/ `select`(移光标)。
 * 纯定义(类型 / 轮转顺序 / 文案 / 解析)住这里,读写设置键的副作用在 `use-sidebar-state`(分工与
 * `filter-state` / `use-filter-state` 同构);后者再出口这些名字,所以导入路径
 * `./use-sidebar-state` 仍然够用(设计 2026-10-16 §6,计划 T1)。
 */
export type SidebarClickMode = 'filter' | 'open' | 'select';

/** 三模式的轮转顺序(头部按钮单击走下一档) */
export const CLICK_MODE_ORDER: readonly SidebarClickMode[] = ['filter', 'open', 'select'];

/** 三模式文案(头部按钮与设置页共用,顺序同 `CLICK_MODE_ORDER`) */
export const CLICK_MODE_LABELS: Record<SidebarClickMode, string> = {
  filter: '筛选',
  open: '打开',
  select: '选中',
};

/** 缺键 / 非法值(空串 / 拼写 / 未知 / 非字符串)一律回 'filter'(与 `parseMode` 同一口径) */
export function parseClickMode(raw: string | null): SidebarClickMode {
  return raw === 'open' || raw === 'select' ? raw : 'filter';
}

/** 下一档:filter -> open -> select -> filter */
export function nextClickMode(m: SidebarClickMode): SidebarClickMode {
  return CLICK_MODE_ORDER[(CLICK_MODE_ORDER.indexOf(m) + 1) % CLICK_MODE_ORDER.length];
}
