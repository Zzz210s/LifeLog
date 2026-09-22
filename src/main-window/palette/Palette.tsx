/**
 * 浮层外壳(设计 §3.1):输入行(前缀徽标 + combobox + 计数)+ 结果列表 + 空态提示。
 *
 * - 定位 fixed 覆盖内容,**不进布局**:不改主内容区尺寸(T6 把它挂在 shell 层)。
 * - 根节点 `data-floating="palette"`:T6 的「点区块外即保存」据此跳过浮层内点击。
 * - aria:输入框 combobox + aria-expanded/controls/activedescendant;列表 listbox;行 option + aria-selected;
 *   计数在 aria-live 里播报「N 项」;无结果时列表位置给一条不可执行的提示项(设计 §3.8)。
 */
import { useId } from 'react';
import type { ReactNode } from 'react';
import { PaletteRow, rowFromListRow } from './PaletteRow';
import type { RowDecoration } from './PaletteRow';
import type { PaletteController } from './use-palette';

const PREFIX_LABELS: Readonly<Record<string, string>> = { '': '笔记', '>': '命令', '#': '标签' };

/** 前缀徽标文案(空 = 笔记 / `>` = 命令 / `#` = 标签;未知前缀按笔记) */
export function prefixLabel(prefix: string): string {
  return PREFIX_LABELS[prefix] ?? PREFIX_LABELS[''];
}

/** 输入框占位提示(随前缀变化) */
export function prefixHint(prefix: string): string {
  if (prefix === '>') return '输入命令名,Enter 执行,Alt+Enter 执行但不关闭';
  if (prefix === '#') return '输入标签名,Enter 跳转';
  return '输入关键词打开笔记;> 命令,# 标签';
}

export interface PaletteProps {
  controller: PaletteController;
  /** 行装饰(按 id 索引):副文本 / 危险色 / 勾选态由 provider 决定(T6) */
  decorations?: Readonly<Record<string, RowDecoration>>;
  label?: string;
}

export function Palette(p: PaletteProps): ReactNode {
  const c = p.controller;
  const baseId = useId();
  const listId = `${baseId}list`;
  const activeId = c.rows.length > 0 ? `${baseId}opt-${c.activeIndex}` : undefined;
  if (!c.isOpen) return null;
  const badge = prefixLabel(c.prefix);

  return (
    <div
      data-floating="palette"
      role="dialog"
      aria-label={p.label ?? '快速打开'}
      className="fixed left-1/2 top-14 z-40 w-[36rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-raised shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent-text">
          {badge}
        </span>
        <input
          ref={c.inputRef}
          role="combobox"
          aria-expanded={c.isOpen}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={`${badge}搜索`}
          value={c.query}
          onChange={(e) => c.setQuery(e.target.value)}
          onKeyDown={c.handleKeyDown}
          placeholder={prefixHint(c.prefix)}
          className="h-7 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
        />
        <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-faint">
          {c.total} 项
        </span>
      </div>
      {c.truncated && (
        <p className="border-b border-border px-3 py-1 text-[11px] text-faint">
          结果过多,只显示前 {c.rows.length} 项,继续输入以缩小范围
        </p>
      )}
      <ul id={listId} role="listbox" aria-label="结果" className="max-h-[60vh] overflow-y-auto py-1">
        {c.rows.length === 0 ? (
          <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-4">
            <p className="text-sm text-muted">无匹配结果</p>
            <p className="mt-0.5 text-xs text-faint">换个关键词,或用 &gt; 执行命令</p>
          </li>
        ) : (
          c.rows.map((row, index) => (
            <PaletteRow
              key={row.item.id}
              id={`${baseId}opt-${index}`}
              row={rowFromListRow(row, p.decorations?.[row.item.id])}
              selected={index === c.activeIndex}
              onHover={() => c.setActiveIndex(index)}
              onSelect={() => c.accept(index, false)}
            />
          ))
        )}
      </ul>
    </div>
  );
}
