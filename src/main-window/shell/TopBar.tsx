// 主窗顶栏:左侧应用名与侧栏开关;右侧按视图显示齿轮(进设置)或返回(回信息流)。
import type { ReactNode } from 'react';
import type { MainView } from '../settings/settings-model';
import { BTN_ICON, BTN_SECONDARY } from './button-classes';

export interface TopBarProps {
  view: MainView;
  /** 侧栏显隐(隐藏时顶栏的开关即「显示侧栏」入口,spec 6.1) */
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}

export function TopBar({ view, sidebarVisible, onToggleSidebar, onOpenSettings, onBack }: TopBarProps): ReactNode {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
      <span className="flex items-center gap-1 text-sm font-semibold text-text">
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
      {view === 'stream' ? (
        <button
          type="button"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
          className={BTN_ICON}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={onBack}
          className={BTN_SECONDARY}
        >
          返回信息流
        </button>
      )}
    </header>
  );
}
