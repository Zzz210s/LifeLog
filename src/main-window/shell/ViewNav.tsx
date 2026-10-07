/**
 * 视图导航组(顶栏右侧):信息流 / 关系图 / 设置三个图标挨在一起,当前视图用 aria-current="page"
 * 高亮。照 VS Code 的活动栏口径 —— 视图切换成组、位置稳定,不散落。
 *
 * 「返回信息流」不再单独占一个文字按钮:导航组里的「信息流」就是返回动作。同一个动作放两个图标
 * 违反 VS Code「不要重复已有图标」;返回的键盘通道仍在(Esc:关系图与设置页各接一次)。
 */
import type { ReactNode } from 'react';
import type { MainView } from '../settings/settings-model';
import { BTN_ICON } from './button-classes';

export interface ViewNavProps {
  /** 当前视图(决定哪个图标高亮) */
  view: MainView;
  /** 回信息流(导航组第一项;与关系图的 Esc 退出是同一条路) */
  onOpenStream: () => void;
  onOpenGraph: () => void;
  onOpenSettings: () => void;
}

/** 24 格 / 1.5→2 描边,与顶栏既有图标同一风格 */
const STREAM_PATH = 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01';
const GRAPH_CIRCLES: Array<[number, number]> = [
  [12, 5],
  [5, 18],
  [19, 18],
];
const GEAR_PATH =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z';

function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
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
      {children}
    </svg>
  );
}

function GraphIcon(): ReactNode {
  return (
    <>
      {GRAPH_CIRCLES.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" />
      ))}
      <line x1="10.6" y1="7" x2="6.4" y2="15.6" />
      <line x1="13.4" y1="7" x2="17.6" y2="15.6" />
      <line x1="7.5" y1="18" x2="16.5" y2="18" />
    </>
  );
}

export function ViewNav(p: ViewNavProps): ReactNode {
  const items: Array<{ id: MainView; label: string; onClick: () => void; icon: ReactNode }> = [
    {
      id: 'stream',
      label: '信息流',
      onClick: p.onOpenStream,
      icon: (
        <Icon>
          <path d={STREAM_PATH} />
        </Icon>
      ),
    },
    { id: 'graph', label: '关系图', onClick: p.onOpenGraph, icon: <Icon><GraphIcon /></Icon> },
    {
      id: 'settings',
      label: '设置',
      onClick: p.onOpenSettings,
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="3" />
          <path d={GEAR_PATH} />
        </Icon>
      ),
    },
  ];
  return (
    <div data-testid="view-nav" role="group" aria-label="视图导航" className="flex items-center gap-1">
      {items.map((it) => {
        const active = p.view === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={it.onClick}
            title={it.label}
            aria-label={it.label}
            aria-current={active ? 'page' : undefined}
            className={BTN_ICON + (active ? ' bg-selected text-accent-text' : '')}
          >
            {it.icon}
          </button>
        );
      })}
    </div>
  );
}
