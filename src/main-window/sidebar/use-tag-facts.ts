/**
 * 标签行关系事实的读取(标签关系统一 spec §7):树行小字与悬浮卡片共用一份数据。
 *
 * 后端 `list_tag_facts` 一次返回全量事实(逐标签读会让扁平模式 768 个标签打约 1.5k 次 IPC);
 * 这里只保留当前可见的标签,`nonce` 变化(标签菜单里加/移除关系后)重取。
 * 读数失败回空值,不让侧栏跟着挂。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { onTagsChanged } from '../data/tags-changed';
import type { TagFactsBundle } from '../../shared/tag-facts-types';
import type { RelationRef } from '../../shared/types';

export interface TagFacts {
  /** 该标签的全部出边(A -> ?);树行小字与悬浮卡片共用 */
  relations: RelationRef[];
}

/** 同步抛(Tauri 未注入时 invoke 会直接 throw)与异步拒绝都算失败,回退默认值 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const EMPTY: TagFactsBundle = { facts: [] };

/** 全量事实里挑出当前可见的标签:查不到的标签 = 没有关系,不上表 */
async function loadFacts(ids: readonly number[]): Promise<Map<number, TagFacts>> {
  const bundle = await safe(() => api.listTagFacts(), EMPTY);
  const wanted = new Set(ids);
  const out = new Map<number, TagFacts>();
  for (const fact of bundle.facts) {
    if (!wanted.has(fact.tagId)) continue;
    out.set(fact.tagId, { relations: fact.relations });
  }
  return out;
}

export function useTagFacts(ids: readonly number[], nonce: number): ReadonlyMap<number, TagFacts> {
  const [facts, setFacts] = useState<ReadonlyMap<number, TagFacts>>(new Map());
  /** 写库出口(编辑页保存 / 卸载兜底 / 输入栏)只声明「标签可能变了」,不区分改的是计数还是关系;
   *  关系小字也得跟着重取 —— 否则编辑页删掉名字关系后,侧栏行还挂着旧小字(2026-10-12 实测:
   *  库里线已没了,行内小字要重启应用才消失)。一次全量 `list_tag_facts` 很便宜,重复通知已由出口合并。 */
  const [stamp, setStamp] = useState(0);
  const key = ids.join(',');

  useEffect(() => onTagsChanged(() => setStamp((n) => n + 1)), []);

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
  }, [key, nonce, stamp]);

  return facts;
}
