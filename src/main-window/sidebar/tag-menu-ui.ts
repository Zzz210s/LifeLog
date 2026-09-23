/** 标签管理菜单的面板枚举与共享样式(从 TagMenu.tsx 拆出,纯搬移) */
import { BTN_SECONDARY } from '../shell/button-classes';

/** 菜单当前显示的面板:主面板 + 重命名/移动/删除/别名/合并五个子面板 */
export type Pane = 'main' | 'rename' | 'move' | 'delete' | 'alias' | 'merge';

/** 菜单项按钮样式(视觉刷新 V5:行高 30 = 6+6+18,圆角取 xs 4px,字号走 --text-ui) */
export const ITEM_CLASS =
  'block w-full rounded-xs px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text';

/** 子面板里的次要按钮(取消)= V4 的次按钮档(h-8 / rounded-sm / --text-ui),不再自成一档 */
export const BTN_GHOST = BTN_SECONDARY;
