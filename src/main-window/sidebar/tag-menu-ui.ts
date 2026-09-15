/** 标签管理菜单的面板枚举与共享样式(从 TagMenu.tsx 拆出,纯搬移) */

/** 菜单当前显示的面板:主面板 + 重命名/移动/删除三个子面板 */
export type Pane = 'main' | 'rename' | 'move' | 'delete';

/** 菜单项按钮样式 */
export const ITEM_CLASS =
  'block w-full rounded px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700';

/** 子面板里的次要按钮(取消)样式 */
export const BTN_GHOST =
  'h-7 rounded border border-gray-300 px-2 text-xs text-gray-600 hover:border-blue-500';
