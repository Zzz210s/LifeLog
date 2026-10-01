/**
 * 关系图的折叠根:从设置 `time_tag_template` 派生(G2 收 G1 欠账:写死 `'时间'` 会让
 * 用户改根名后折叠静默失效)。真源链路是「设置原文 -> normalizeTemplate(空/缺 -> 默认模板)
 * -> collapseRootsOf(取首段)」,视图与验收探针共读这一份口径。
 *
 * **未读到设置时返回 `null`**(而不是空数组):相机首次适配要等它落定,否则会拿「没折叠」的全量落点
 * 算 fit(真机实测:退出再进图时按 768 点适配 `k=0.751/tx=411/ty=304.2`,而折叠后正确值是
 * `0.949/547.1/221.9`)。读失败返回 `[]`(不折叠但算就绪)—— 折叠是收窄,读不到宁可全画,
 * 但别把适配永远卡在等设置上。
 * 自 `GraphView` 抽出以守 200 行红线(与 use-graph-data / use-graph-size 同一处理)。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { collapseRootsOf } from './graph-view-model';
import { normalizeTemplate, TIME_TAG_TEMPLATE_KEY } from '../settings/time-tag-settings';

/** `null` = 设置还没读到;`[]` = 读到了且一根都不折(含读失败) */
export function useCollapseRoots(): string[] | null {
  const [roots, setRoots] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSetting(TIME_TAG_TEMPLATE_KEY).then(
      (t) => {
        if (alive) setRoots(collapseRootsOf(normalizeTemplate(t)));
      },
      () => {
        if (alive) setRoots([]); // 读不到设置:保持不折叠,但算「已就绪」,不拖住相机适配
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return roots;
}
