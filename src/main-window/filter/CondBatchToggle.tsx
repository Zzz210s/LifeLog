/**
 * 条件栏的「编辑条件」开关(spec 2026-10-17 §A1):与条目批量的 `BatchToggle` 同一套图标与
 * 按下态口径(28×28 / BTN_ICON,bg-selected + text-accent-text),但作用对象是**条件 chip**
 * —— 两者互斥(接线在 `use-batch-modes`),不会同时按下。
 * `data-cond-batch` 是验收脚本读当前态的稳定锚点;`aria-label` 固定(不随态变)。
 */
import type { ReactNode } from 'react';
import { BTN_ICON } from '../shell/button-classes';
import { CHECKLIST_PATH } from './BatchToggle';

export interface CondBatchToggleProps {
  on: boolean;
  toggle: () => void;
}

export function CondBatchToggle(p: CondBatchToggleProps): ReactNode {
  return (
    <button
      type="button"
      data-testid="cond-batch-toggle"
      data-cond-batch={p.on ? 'on' : 'off'}
      aria-pressed={p.on}
      aria-label="编辑条件"
      title="编辑条件：多选条件栏里的条件，一次删除 / 改含子级 / 移到排除侧 / 移入新组"
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
