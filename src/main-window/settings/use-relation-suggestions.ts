/**
 * 「关系建议」的数据读取(自 `RelationSuggestionsSection` 抽出,守 200 行红线):
 * 标签全量 + 这些标签已有的出边一次取齐;失败只给一句中文,不抛、不阻断分区其它行。
 * 批量确认会原地补写 `existing`(不重查),所以它连同 setter 一起交出去 —— 分区仍是唯一写入者。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { TagCount } from '../../shared/types';
import { suggestRelations, type RelationSuggestion } from './relation-suggestions';

/** 已有关系索引:tagId -> 目标 tagId 集合 */
export type ExistingIndex = Map<number, Set<number>>;

export interface RelationSuggestionsData {
  all: RelationSuggestion[];
  targets: TagCount[];
  existing: ExistingIndex;
  setExisting: React.Dispatch<React.SetStateAction<ExistingIndex>>;
  loaded: boolean;
  status: string;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
}

export function useRelationSuggestions(): RelationSuggestionsData {
  const [all, setAll] = useState<RelationSuggestion[]>([]);
  const [targets, setTargets] = useState<TagCount[]>([]);
  const [existing, setExisting] = useState<ExistingIndex>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    setStatus('');
    api
      .listTags()
      .then(async (tags) => {
        const rows = suggestRelations(tags);
        const ids = [...new Set(rows.map((r) => r.tagId))];
        const edges = await Promise.all(ids.map((id) => api.listTagRelations(id)));
        if (!alive) return;
        setAll(rows);
        setTargets(tags);
        setExisting(new Map(ids.map((id, i) => [id, new Set(edges[i].map((r) => r.toTagId))])));
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) setStatus('读取标签失败: ' + String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { all, targets, existing, setExisting, loaded, status, setStatus };
}
