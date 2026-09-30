/**
 * 视图级 `Esc`(设计 §5):**有选中标签就把该标签带回信息流**(上层按侧栏点标签同一口径采纳),
 * 没有选中则原样退出。两条分支放一处,免得"选中与否"的判据在视图与外壳里各写一份。
 *
 * 两条注册口径:
 * ① 事件读的是**当次选中**(`selectedPath` 进 deps)—— 分支不该用挂载那一刻的旧选中;
 * ② 回调本身进 deps,而不是整个 `props` 对象:两者在 App 里都是 `useCallback`(身份恒定),
 *    塞 `props` 会让视图开着时每次父组件重渲染都摘掉再挂一次 window 监听
 *    (真机实测:切一次侧栏就多挂 1 次)。
 *
 * 自 `GraphView` 抽出以守 200 行红线(与 use-graph-data / use-graph-size / use-collapse-roots 同一处理)。
 */
import { useEffect } from 'react';

export function useEscapeExit(input: {
  /** 当前选中标签的路径(null = 没选中) */
  selectedPath: string | null;
  /** 原样退出关系图 */
  onExit: () => void;
  /** 带着该标签回信息流 */
  onFilterToStream: (path: string) => void;
}): void {
  const { selectedPath, onExit, onFilterToStream } = input;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (selectedPath === null) onExit();
      else onFilterToStream(selectedPath);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPath, onExit, onFilterToStream]);
}
