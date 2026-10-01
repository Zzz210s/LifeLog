/**
 * 数据版本变化 -> 重取图数据(G3 Task 5)。
 *
 * 版本号是主窗既有的那份(App 的 `tagsVersion`):`onTagsChanged` 唯一出口 -> 重读标签 ->
 * 版本 +1(见 `src/main-window/data/use-tag-rows.ts`)。这里不自造通知机制,只做一件事:
 * 版本**变了**才叫 `reload()`。
 *
 * 为什么不是"版本存在就重取":视图挂载时那份图数据由 `useGraphData` 自己拉,同一份版本
 * 再打一次就是白拉一遍;而且 `reload` 只换 `data`,相机 / 选中 / 展开都是调用方的状态,
 * 重取不会让它们复位(设计 §6-5)。
 */
import { useEffect, useRef } from 'react';

export function useGraphVersion(dataVersion: number, reload: () => void): void {
  // 首次渲染的版本按"已见过"算:挂载不重取(那是 useGraphData 的活)
  const seen = useRef(dataVersion);
  useEffect(() => {
    if (seen.current === dataVersion) return;
    seen.current = dataVersion;
    reload();
  }, [dataVersion, reload]);
}
