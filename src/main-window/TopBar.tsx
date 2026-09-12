// 主窗顶栏:左侧应用名;右侧按视图显示齿轮(进设置)或返回(回信息流)。
import type { ReactNode } from 'react';
import type { MainView } from './settings/settings-model';

export interface TopBarProps {
  view: MainView;
  onOpenSettings: () => void;
  onBack: () => void;
}

export function TopBar({ view, onOpenSettings, onBack }: TopBarProps): ReactNode {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
      <span className="text-sm font-semibold text-gray-900">生活数据库</span>
      {view === 'stream' ? (
        <button
          type="button"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
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
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
        >
          返回信息流
        </button>
      )}
    </header>
  );
}
