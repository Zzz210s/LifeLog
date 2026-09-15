import { useState } from 'react';
import type { ReactNode } from 'react';

export interface NoteDateCellProps {
  /** 时间标签派生的日期 `YYYY-MM-DD`;无时间标签为 null(不显示,也不回退到 created_at) */
  date: string | null;
  /** 选定新日期(仅在用户改到另一天时调用;取消不触发) */
  onChange: (date: string) => void;
}

/**
 * 笔记头部的日期:点击展开原生日期选择器,选定即提交。
 * 取消路径(Esc / 失焦 / 再点原位)只收起控件,不触发 onChange,不改数据。
 */
export function NoteDateCell({ date, onChange }: NoteDateCellProps): ReactNode {
  const [picking, setPicking] = useState(false);
  if (!date) return null;

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        aria-label="修改日期"
        title="点击修改日期"
        className="rounded text-xs text-faint hover:bg-hover hover:text-accent"
      >
        {date}
      </button>
    );
  }

  return (
    <input
      type="date"
      autoFocus
      defaultValue={date}
      aria-label="选择日期"
      className="rounded border border-border bg-raised px-1 text-xs text-muted"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPicking(false);
      }}
      onBlur={() => setPicking(false)}
      onChange={(e) => {
        const next = e.target.value;
        setPicking(false);
        if (next && next !== date) onChange(next); // 空值(清空输入)与同日视为取消
      }}
    />
  );
}
