import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import {
  SOURCE_TAG_DEBOUNCE_MS,
  createRequestGate,
  displayedTagCount,
  type RequestGate,
  type SourceTagPreview,
} from './source-tags';

/**
 * 编辑面板的实时标签数(spec 2026-09-20 §5.4 / D11 的遗留补齐):
 * - 输入变化后 250ms 防抖调 `parse_note_source` —— 后端即保存路径的同一实现,前端不复制语法
 * - 序号守卫:连打/换源/卸载时到达的过期响应一律丢弃(与 use-tag-complete 同一手法)
 * - 请求尚未返回或失败时回退**已保存**标签数(不闪烁成 0)
 * - 纯显示层建议:保存行为完全不受本 hook 影响(保存仍走原来的 api.updateNote)
 */
export function useSourceTagCount(source: string, savedCount: number): number {
  const [preview, setPreview] = useState<SourceTagPreview | null>(null);
  const ref = useRef<RequestGate | null>(null);
  if (ref.current === null) ref.current = createRequestGate();
  const gate = ref.current;

  useEffect(() => {
    const id = gate.next();
    const timer = window.setTimeout(() => {
      api
        .parseNoteSource(source)
        .then((r) => {
          if (!gate.isCurrent(id)) return; // 过期响应丢弃
          setPreview({ source, count: r.tags.length });
        })
        .catch(() => {
          if (!gate.isCurrent(id)) return;
          setPreview(null); // 解析失败:回退已保存标签数,不拦保存
        });
    }, SOURCE_TAG_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      gate.invalidate(); // 换源/卸载:在途请求作废
    };
  }, [source, gate]);

  return displayedTagCount(preview, source, savedCount);
}
