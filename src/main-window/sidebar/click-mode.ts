/**
 * 单击实体行的行为模式:`filter`(筛选,现状/默认)/ `open`(只看这一条:单击把主页收窄到该实体,
 * 预览卡片在**双击**,见 `tag-row-action.ts` 的 `dblIntent`)。
 * 纯定义(类型 / 轮转顺序 / 文案 / 解析)住这里,读写设置键的副作用在 `use-sidebar-state`(分工与
 * `filter-state` / `use-filter-state` 同构);后者再出口这些名字,所以导入路径
 * `./use-sidebar-state` 仍然够用(设计 2026-10-16 §6,计划 T1)。
 *
 * 2026-10-16 用户要求「点击行为图标仅保留筛选和打开两个模式」:原第三档 `select`(移光标 +
 * 底部光标条 + 行左缘竖条)整条链路已删除;旧存储值(含 `'select'`)由 `parseClickMode` 一律回落
 * 到 `filter`,不留半死的分支。
 * 2026-10-17 用户要求:打开档的单击改为「只看这一条」(预览卡片退到双击);模式名与存储值不变。
 * 同一天去双入口:侧栏头部的模式按钮删除,本模块只服务设置页那一行,`nextClickMode` 随之下线。
 */
export type SidebarClickMode = 'filter' | 'open';

/** 两模式的呈现顺序(设置页那一行左到右;2026-10-17 起侧栏头部按钮已删) */
export const CLICK_MODE_ORDER: readonly SidebarClickMode[] = ['filter', 'open'];

/** 两模式文案(设置页那一行与切模式回执共用,顺序同 `CLICK_MODE_ORDER`) */
export const CLICK_MODE_LABELS: Record<SidebarClickMode, string> = {
  filter: '筛选',
  open: '打开',
};

/** 缺键 / 非法值(空串 / 拼写 / 未知 / 非字符串;**旧值 `select`** / 大小写)一律回 `filter` */
export function parseClickMode(raw: string | null): SidebarClickMode {
  return raw === 'open' ? 'open' : 'filter';
}
