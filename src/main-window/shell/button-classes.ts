/**
 * 按钮三型的类名常真源(视觉刷新 V4,设计 §4-4 / D4):
 * 主 = accent / 高 32 / radius-sm;次 = border / 高 32 / radius-sm;图标 = 28×28 / radius-sm;
 * 纯文字动作用 BTN_TEXT(同为 28 高,靠内边距拉开宽度)。全部走 --text-ui(13/18)。
 *
 * 只导出类名,不导出组件 —— 调用点仍自己渲染 <button>,这样事件、aria、禁用态与既有测试选择器都不动。
 * 圆角按名取用:rounded-sm = 6px(V1 已把 --radius-sm 定为 6px),别靠 Tailwind 默认值。
 * 颜色刻意不进基类:两串颜色类同时存在时,谁生效由 Tailwind 的规则顺序决定,读代码看不出来。
 */
const BTN_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center rounded-sm px-3 text-ui transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** 主按钮:accent 底 + on-accent 字(保存、确认这类唯一主动作) */
export const BTN_PRIMARY = BTN_BASE + ' bg-accent text-on-accent hover:bg-accent-hover';

/** 次按钮:1px 边框,悬停转 accent(排序、导出、返回、重试这类并列动作) */
export const BTN_SECONDARY = BTN_BASE + ' border border-border text-muted hover:border-accent hover:text-accent-text';

/** 警示次按钮:边框与文字走 warn(启动项「修复」) */
export const BTN_WARN = BTN_BASE + ' border border-warn text-warn hover:bg-warn-soft';

/** 图标按钮:28×28 方框,悬停底色由 hover 态给(顶栏齿轮/侧栏折叠等) */
export const BTN_ICON =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-text';

/** 纯文字动作按钮:高度与图标按钮同档(28),颜色由调用点给(卡片「删除」、错误条「关闭」)。
 *  `-my-1.5`(负外边距):视觉占位回到 16px,不把卡片撑高 —— 命中区仍是 28×N,
 *  但行高不受影响(视觉刷新 V4 复测:不加时单卡 +12px,一屏少一张卡)。 */
export const BTN_TEXT =
  'inline-flex h-7 -my-1.5 shrink-0 items-center justify-center rounded-sm px-2 text-ui transition-colors hover:bg-hover';
