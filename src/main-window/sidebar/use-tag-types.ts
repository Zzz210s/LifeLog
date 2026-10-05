/**
 * 已登记类型表(标签类型 spec §5):标签菜单的「设为类型/取消类型」「类型…」面板与
 * 「携带…」候选过滤共用一份读数。菜单打开时取一次;null = 还没载入(「设为类型」按未登记显示,不误报)。
 * 读数失败回空表(菜单其余档仍可用),不阻断菜单。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { TypeRef } from '../../shared/types';

export function useTagTypes(active: boolean): TypeRef[] | null {
  const [types, setTypes] = useState<TypeRef[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    // 包一层 try/catch:测试里 api 可能只 mock 了部分命令(listTypes 不存在会同步抛)
    void (async () => {
      try {
        const r = await api.listTypes();
        if (alive) setTypes(r);
      } catch {
        if (alive) setTypes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);

  return types;
}
