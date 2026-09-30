/**
 * 关系图的折叠根:从设置 `time_tag_template` 派生(G2 收 G1 欠账:写死 `'时间'` 会让
 * 用户改根名后折叠静默失效)。真源链路是「设置原文 -> normalizeTemplate(空/缺 -> 默认模板)
 * -> collapseRootsOf(取首段)」,视图与验收探针共读这一份口径。
 * 读完之前返回 `[]`(不折叠)—— 折叠是收窄,没读到宁可全画;读失败同样保持不折叠
 * (后端默认值与库内根名对得上时才有得折),不把整图判成加载失败。
 * 自 `GraphView` 抽出以守 200 行红线(与 use-graph-data / use-graph-size 同一处理)。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { collapseRootsOf } from './graph-view-model';
import { normalizeTemplate, TIME_TAG_TEMPLATE_KEY } from '../settings/time-tag-settings';

export function useCollapseRoots(): string[] {
  const [tpl, setTpl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSetting(TIME_TAG_TEMPLATE_KEY).then(
      (t) => {
        if (alive) setTpl(normalizeTemplate(t));
      },
      () => {
        /* 读不到设置就保持不折叠,不打扰用户 */
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  // 回包一到依赖变化自然重算;读到之前 tpl 是 null = 不折叠
  return useMemo(() => collapseRootsOf(tpl), [tpl]);
}
