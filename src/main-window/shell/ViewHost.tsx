/**
 * 内容区:顶栏 + 当前视图(G2 Task 7,自 `App.tsx` 抽出以守 200 行红线)。
 *
 * 三段视图的分支只在这里:`stream` 常驻挂载(切到设置/关系图只是 `hidden`,返回时分页与滚动
 * 位置都不丢),`settings` / `graph` 按需挂载。`App` 只留「当前是哪个视图」这份状态。
 *
 * 顺带收走内容区外壳(列宽随侧栏显隐、`min-w` 保护)与顶栏 —— 顶栏三个入口(侧栏开关/设置/
 * 返回)本来就是视图动作,放在一起后 `App` 的 return 只剩一层壳。
 *
 * 信息流的接线太多(App 的筛选/笔记/错误/候选四组状态),整块作为 `stream` 对象递进来 ——
 * 本文件对它们只做透传,不认识其中任何一项;`visible` 由 `view` 派生,调用方不必重复传。
 */
import type { ReactNode } from 'react';
import type { TagMruSource } from '../../shared/tag-mru';
import type { ThemeModeController } from '../../shared/use-theme-mode';
import { GraphView } from '../graph/GraphView';
import type { MainView } from '../settings/settings-model';
import { SettingsView } from '../settings/SettingsView';
import { StreamView, type StreamViewProps } from './StreamView';
import { TopBar } from './TopBar';
import { contentColumnClass } from './content-column';

export interface ViewHostProps {
  view: MainView;
  /** 信息流接线(`visible` 由 view 派生,故从这里排除) */
  stream: Omit<StreamViewProps, 'visible'>;
  /** 主题三态(App 持有:信息流视图下也要持续跟随系统) */
  theme: ThemeModeController;
  /** 侧栏显隐:决定内容区列宽,也是顶栏开关的当前态 */
  sidebarVisible: boolean;
  /** 顶栏导出反馈(App 注入) */
  topBar: { exporting: boolean; exported: boolean };
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  /** 顶栏常驻「关系图」图标按钮(App 注入 `commands.execute('graph.open')`) */
  onOpenGraph: () => void;
  /** 回信息流:顶栏返回与关系图退出是同一条路 */
  onBack: () => void;
  /** 关系图「筛到信息流」:上层采纳标签并切回信息流 */
  onFilterToStream: (path: string) => void;
  /** 标签数据版本(App 的 `tagsVersion`):关系图据此自动重取,不动相机与选中 */
  dataVersion: number;
  /** 固定标签 + 标签 MRU(App 透传):关系图的标签菜单「关系…」候选与侧栏同一套三档排序 */
  tagMru?: TagMruSource | null;
  /** 「标签关系」分区里的「标签树里显示关系」(值来自侧栏状态,与其共用一份 showRelations) */
  tagTreeRelations?: { showRelations: boolean; onShowRelationsChange: (v: boolean) => void };
  onReplayTutorial: () => void;
}

export function ViewHost(p: ViewHostProps): ReactNode {
  return (
    // 内容区 min-w 保护:窄窗口下侧栏允许被压缩,内容区不被挤没;
    // 列宽随侧栏显隐切换(有侧栏 768 / 无侧栏 1024,视觉刷新 V4)
    <div
      tabIndex={-1}
      className={`mx-auto flex h-full w-full min-w-[420px] flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-accent ${contentColumnClass(p.sidebarVisible)}`}
    >
      <TopBar
        view={p.view}
        sidebarVisible={p.sidebarVisible}
        exporting={p.topBar.exporting}
        exported={p.topBar.exported}
        onToggleSidebar={p.onToggleSidebar}
        onOpenSettings={p.onOpenSettings}
        onOpenGraph={p.onOpenGraph}
        onBack={p.onBack}
      />
      <StreamView {...p.stream} visible={p.view === 'stream'} dataVersion={p.dataVersion} />
      {p.view === 'settings' && (
        <SettingsView
          themeMode={p.theme.mode}
          onThemeChange={p.theme.setMode}
          onReplayTutorial={p.onReplayTutorial}
          onBack={p.onBack}
          showRelations={p.tagTreeRelations?.showRelations}
          onShowRelationsChange={p.tagTreeRelations?.onShowRelationsChange}
        />
      )}
      {p.view === 'graph' && (
        <GraphView
          onExit={p.onBack}
          onFilterToStream={p.onFilterToStream}
          dataVersion={p.dataVersion}
          tagMru={p.tagMru}
        />
      )}
    </div>
  );
}
