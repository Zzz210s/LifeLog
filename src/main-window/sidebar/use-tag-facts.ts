/**
 * 标签行「角色 / 携带」事实的读取(标签角色 spec §5):树行徽章、携带小字与悬浮卡片共用一份数据。
 *
 * 后端只有逐标签读数(`list_tag_roles` / `list_tag_carries`)与全量角色表 `list_roles`,没有
 * 批量「标签 -> 角色」命令,所以这里对侧栏的标签 id 逐个取,缓存进组件状态;`nonce` 变化
 * (标签菜单里登记角色/改认领/改携带后)整批重取。读数失败回空值,不让侧栏跟着挂。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { tagLabelPlain } from '../../shared/tag-label';
import { carryFacts } from '../../shared/tag-role-facts';
import type { CarryFact } from '../../shared/tag-role-facts';
import type { CarryReport, RoleRef } from '../../shared/types';

export interface TagFacts {
  /** 认领该标签的角色名(已剥 md) */
  roles: string[];
  /** 该标签携带的「角色 -> 值」 */
  carry: CarryFact[];
}

/** 同步抛(Tauri 未注入时 invoke 会直接 throw)与异步拒绝都算失败,回退默认值 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function loadFacts(ids: readonly number[]): Promise<Map<number, TagFacts>> {
  const roles = await safe(() => api.listRoles(), [] as RoleRef[]);
  const entries = await Promise.all(
    ids.map(async (id): Promise<readonly [number, TagFacts]> => {
      const [roleRefs, report] = await Promise.all([
        safe(() => api.listTagRoles(id), [] as RoleRef[]),
        safe(() => api.listTagCarries(id), { carried: [], carriersOf: [] } as CarryReport),
      ]);
      return [
        id,
        {
          roles: roleRefs.map((r) => tagLabelPlain(r.name)),
          carry: carryFacts(report.carried.map((c) => c.path), roles),
        },
      ];
    })
  );
  return new Map(entries);
}

export function useTagFacts(ids: readonly number[], nonce: number): ReadonlyMap<number, TagFacts> {
  const [facts, setFacts] = useState<ReadonlyMap<number, TagFacts>>(new Map());
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) {
      setFacts(new Map());
      return;
    }
    let alive = true;
    void loadFacts(ids).then((m) => {
      if (alive) setFacts(m);
    });
    return () => {
      alive = false;
    };
    // ids 的身份每次渲染都可能变,用 key(内容)当依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return facts;
}
