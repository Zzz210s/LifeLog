/**
 * 条件栏的「批量」开关(spec 2026-10-17 §2.1):图标按钮形态与排序入口同档(28×28 / BTN_ICON),
 * 按下态给 bg-selected + text-accent-text(与侧栏"选中"同一读法)。
 * `data-batch` 是验收脚本读当前态的稳定锚点;`aria-label` 固定(不随态变)。
 */
import type { ReactNode } from 'react';
import { BTN_ICON } from '../shell/button-classes';

export interface BatchToggleProps {
  on: boolean;
  toggle: () => void;
}

/** 24 格 / 2 描边:清单 + 勾选 = 多选批量 */
const CHECKLIST_PATH = 'M8 6h13M8 12h13M8 18h13M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17';

export function BatchToggle(p: BatchToggleProps): ReactNode {
  return (
    <button
      type="button"
      data-testid="batch-toggle"
      data-batch={p.on ? 'on' : 'off'}
      aria-pressed={p.on}
      aria-label="批量编辑"
      title="批量编辑：多选筛选出的条目，加/去标签、删除、导出"
      onClick={p.toggle}
      className={BTN_ICON + (p.on ? ' bg-selected text-accent-text' : '')}
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
        <path d={CHECKLIST_PATH} />
      </svg>
    </button>
  );
}
