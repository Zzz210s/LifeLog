/**
 * 引导层与「回信息流」两个视图动作(自 App.tsx 抽出守 200 行红线)。
 * 三者是一家:引导层要一个稳定的「回信息流」回调做重看锚点,关系图的「筛到信息流」也要它。
 * 回调身份必须稳(重看入口把 `backToStream` 透传到设置页;每渲染换新会让下游 props 每次变)。
 */
import { useCallback, useEffect } from 'react';
import type { MainView } from '../settings/settings-model';
import { useTutorialEntry } from '../tutorial/use-tutorial-entry';

export interface AppTutorial {
  /** 回信息流(托盘「信息流」、关系图 / 设置页的返回键共用这一具名回调) */
  backToStream: () => void;
  /** 图上的「筛到信息流」:与侧栏点标签同一口径(含子级),采纳后回信息流(G2 Task 5 的具名回调) */
  filterToStream: (path: string) => void;
  /** 引导层句柄(open / onExit / onUnavailable / onReplay) */
  tutorial: ReturnType<typeof useTutorialEntry>;
}

export function useAppTutorial(p: {
  view: MainView;
  setView: (view: MainView) => void;
  toggleTag: (path: string) => void;
}): AppTutorial {
  const backToStream = useCallback(() => p.setView('stream'), [p.setView]);
  // 首次使用引导:主窗自己读标记决定挂不挂层(开窗在 Rust 启动路径);用户动作写标记、「重新观看」先回信息流
  const tutorial = useTutorialEntry(backToStream);
  const filterToStream = useCallback(
    (path: string) => {
      p.toggleTag(path);
      backToStream();
    },
    [p.toggleTag, backToStream],
  );

  // 引导开着时切到非信息流视图(设置页 / 关系图;托盘与命令都拦不住键盘闸门)会把锚点全藏起来 ——
  // 覆盖层会变成"全屏压暗 + 气泡悬空"。这时按"不可用"处理:**只关层、不写标记**,下次启动再弹。
  useEffect(() => {
    if (p.view !== 'stream' && tutorial.open) tutorial.onUnavailable();
  }, [p.view, tutorial]);

  return { backToStream, filterToStream, tutorial };
}
