/**
 * 已登记角色表(标签角色 spec §5):标签菜单的「设为角色/取消角色」「角色…」面板与
 * 「携带…」候选过滤共用一份读数。菜单打开时取一次;null = 还没载入(「设为角色」按未登记显示,不误报)。
 * 读数失败回空表(菜单其余档仍可用),不阻断菜单。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { RoleRef } from '../../shared/types';

export function useRoles(active: boolean): RoleRef[] | null {
  const [roles, setRoles] = useState<RoleRef[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    // 包一层 try/catch:测试里 api 可能只 mock 了部分命令(listRoles 不存在会同步抛)
    void (async () => {
      try {
        const r = await api.listRoles();
        if (alive) setRoles(r);
      } catch {
        if (alive) setRoles([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);

  return roles;
}
