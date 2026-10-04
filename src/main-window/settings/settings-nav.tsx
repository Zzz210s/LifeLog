// 设置页的分区导航(设计 D1/D8):宽窗口左侧竖排列表,窄窗口顶部横向可滚动 tab 条。
// 键盘:Tab 进入一次,上下(或左右)方向键切换分区 —— roving tabindex 的标准做法。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { isNarrowNav, SETTINGS_SECTIONS, type SectionId } from './settings-sections';

export interface SettingsNavProps {
  active: SectionId;
  onPick: (id: SectionId) => void;
}

export function SettingsNav({ active, onPick }: SettingsNavProps): ReactNode {
  const [narrow, setNarrow] = useState(() => isNarrowNav(window.innerWidth));

  useEffect(() => {
    const onResize = (): void => setNarrow(isNarrowNav(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const keys = narrow ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = SETTINGS_SECTIONS.findIndex((s) => s.id === active);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    onPick(SETTINGS_SECTIONS[(i + step + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length].id);
  };

  const item = (id: SectionId, label: string): ReactNode => {
    const on = id === active;
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={on}
        aria-current={on ? 'true' : undefined}
        tabIndex={on ? 0 : -1}
        data-section-nav={id}
        onClick={() => onPick(id)}
        className={
          'h-7 shrink-0 rounded-sm px-2 text-left text-ui transition-colors ' +
          (on ? 'bg-selected text-accent-text' : 'text-muted hover:bg-hover hover:text-text')
        }
      >
        {label}
      </button>
    );
  };

  return (
    <nav
      role="tablist"
      aria-label="设置分区"
      aria-orientation={narrow ? 'horizontal' : 'vertical'}
      onKeyDown={onKeyDown}
      className={
        narrow
          ? 'flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2'
          : 'flex w-40 shrink-0 flex-col gap-0.5 border-r border-border px-2 py-3'
      }
    >
      {SETTINGS_SECTIONS.map((s) => item(s.id, s.label))}
    </nav>
  );
}
