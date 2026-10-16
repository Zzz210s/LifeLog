/**
 * 标签右键菜单的挂载状态(自 `TagsSection` 抽出,守 200 行红线):右键落在哪一行、出现在哪、
 * 以及"做完一件事"与"关闭"两条收尾。菜单本体与五个子面板在 `TagMenu.tsx`。
 * 钳制口径与关系图 `graph-tag-menu` 一致:菜单宽 224(`w-56`)+ 8 边距、最高 320(`max-h-80`)+ 8。
 */
import { useCallback, useState } from 'react';
import { isManageable } from './tag-tree';
import type { ManagedNode, TagNode } from './tag-tree';

const MENU_W = 232;
const MENU_H = 328;

export interface TagMenuState {
  node: ManagedNode;
  x: number;
  y: number;
}

export interface TagMenuArgs {
  showFlash: (text: string, tone?: 'ok' | 'error') => void;
  /** 改名 / 移动 / 删除成功后由上层刷新标签与筛选条件 */
  onMutated: (pathChange?: { from: string; to: string }) => void;
  /** 菜单里可能改过关系:关菜单与做完一件事都要重取一次事实 */
  onFactsStale: () => void;
}

export interface TagMenuController {
  menu: TagMenuState | null;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
  onDone: (message: string, pathChange?: { from: string; to: string }) => void;
  onClose: () => void;
}

export function useTagMenu(p: TagMenuArgs): TagMenuController {
  const [menu, setMenu] = useState<TagMenuState | null>(null);

  const onContextMenu = useCallback((e: React.MouseEvent, node: TagNode) => {
    e.preventDefault();
    if (!isManageable(node)) return; // 补出的结构节点(无 DB id)不可管理:不出菜单
    setMenu({
      node,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H)),
    });
  }, []);

  const onDone = useCallback(
    (message: string, pathChange?: { from: string; to: string }) => {
      setMenu(null);
      p.showFlash(message);
      p.onFactsStale();
      p.onMutated(pathChange);
    },
    [p]
  );

  /** 关闭菜单(Esc / 点外 / 面板取消):关系面板是即时写库的,关时重取一次事实 */
  const onClose = useCallback(() => {
    setMenu(null);
    p.onFactsStale();
  }, [p]);

  return { menu, onContextMenu, onDone, onClose };
}
