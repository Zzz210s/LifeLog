/**
 * 标签行「角色 / 携带」事实的读取(标签角色 spec §5):树行徽章、携带小字与悬浮卡片共用一份数据。
 *
 * 后端 `list_tag_facts` 一次返回全量事实 + 完整角色表(逐标签读会让扁平模式 768 个标签
 * 打约 1.5k 次 IPC);这里只保留当前可见的标签,`nonce` 变化(标签菜单里登记角色/改认领/
 * 改携带后)重取。携带目标换算成「角色 -> 值」的口径仍在 shared/tag-role-facts.ts 一处。
 * 读数失败回空值,不让侧栏跟着挂。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { tagLabelPlain } from '../../shared/tag-label';
import { carryFacts } from '../../shared/tag-role-facts';
import type { CarryFact } from '../../shared/tag-role-facts';
import type { TagFactsBundle } from '../../shared/tag-facts-types';

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

const EMPTY: TagFactsBundle = { roles: [], facts: [] };

/** 全量事实里挑出当前可见的标签:查不到的标签 = 没角色也没携带,不上表 */
async function loadFacts(ids: readonly number[]): Promise<Map<number, TagFacts>> {
  const bundle = await safe(() => api.listTagFacts(), EMPTY);
  const wanted = new Set(ids);
  const out = new Map<number, TagFacts>();
  for (const fact of bundle.facts) {
    if (!wanted.has(fact.tagId)) continue;
    out.set(fact.tagId, {
      roles: fact.roles.map((r) => tagLabelPlain(r.name)),
      carry: carryFacts(fact.carried, bundle.roles),
    });
  }
  return out;
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
