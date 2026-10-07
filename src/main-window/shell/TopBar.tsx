// 主窗顶栏:左侧应用名与侧栏开关(布局控制,所有视图常驻);
// 右侧导出反馈 + 视图导航组(信息流 / 关系图 / 设置,当前视图高亮)。
// 「返回信息流」动作由导航组第一项承接(不再单独放文字按钮或第二个箭头图标)。
import type { ReactNode } from 'react';
import type { MainView } from '../settings/settings-model';
import { BTN_ICON } from './button-classes';
import { ExportNotice } from './ExportNotice';
import { ViewNav } from './ViewNav';

export interface TopBarProps {
  view: MainView;
  /** 侧栏显隐(隐藏时顶栏的开关即「显示侧栏」入口,spec 6.1) */
  sidebarVisible: boolean;
  /** 导出反馈:进行中显示「正在导出…」,成功后 2s 显示「已导出」 */
  exporting: boolean;
  exported: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  /** 导航组「关系图」:由 App 注入 `commands.execute('graph.open')`,不另造入口逻辑 */
  onOpenGraph: () => void;
  /** 导航组「信息流」= 返回信息流;与关系图的 Esc 退出是同一条路 */
  onBack: () => void;
}

export function TopBar({
  view,
  sidebarVisible,
  exporting,
  exported,
  onToggleSidebar,
  onOpenSettings,
  onOpenGraph,
  onBack,
}: TopBarProps): ReactNode {
  return (
    <header className="relative flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
      <span className="flex items-center gap-1 text-body-sm font-semibold text-text">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
          aria-label={sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
          aria-pressed={sidebarVisible}
          className={BTN_ICON}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>
        拾枝
      </span>
      <span className="flex items-center gap-2">
        <ExportNotice exporting={exporting} exported={exported} />
        <ViewNav
          view={view}
          onOpenStream={onBack}
          onOpenGraph={onOpenGraph}
          onOpenSettings={onOpenSettings}
        />
      </span>
    </header>
  );
}
