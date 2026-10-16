/**
 * 单击实体行的行为模式:`filter`(筛选,现状/默认)/ `open`(打开预览卡片)。
 * 纯定义(类型 / 轮转顺序 / 文案 / 解析)住这里,读写设置键的副作用在 `use-sidebar-state`(分工与
 * `filter-state` / `use-filter-state` 同构);后者再出口这些名字,所以导入路径
 * `./use-sidebar-state` 仍然够用(设计 2026-10-16 §6,计划 T1)。
 *
 * 2026-10-16 用户要求「点击行为图标仅保留筛选和打开两个模式」:原第三档 `select`(移光标 +
 * 底部光标条 + 行左缘竖条)整条链路已删除;旧存储值(含 `'select'`)由 `parseClickMode` 一律回落
 * 到 `filter`,不留半死的分支。
 */
export type SidebarClickMode = 'filter' | 'open';

/** 两模式的轮转顺序(头部按钮单击走下一档) */
export const CLICK_MODE_ORDER: readonly SidebarClickMode[] = ['filter', 'open'];

/** 两模式文案(头部按钮与设置页共用,顺序同 `CLICK_MODE_ORDER`) */
export const CLICK_MODE_LABELS: Record<SidebarClickMode, string> = {
  filter: '筛选',
  open: '打开',
};

/** 缺键 / 非法值(空串 / 拼写 / 未知 / 非字符串;**旧值 `select`** / 大小写)一律回 `filter` */
export function parseClickMode(raw: string | null): SidebarClickMode {
  return raw === 'open' ? 'open' : 'filter';
}

/** 下一档:filter -> open -> filter(两档互切) */
export function nextClickMode(m: SidebarClickMode): SidebarClickMode {
  return m === 'filter' ? 'open' : 'filter';
}
