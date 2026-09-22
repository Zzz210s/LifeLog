/**
 * 浮层外壳(设计 §3.1):输入行(前缀徽标 + combobox + 计数)+ 结果列表 + 空态提示。
 *
 * - 定位 fixed 覆盖内容,**不进布局**:不改主内容区尺寸(T6 把它挂在 shell 层)。
 * - 根节点 `data-floating="palette"`:T6 的「点区块外即保存」据此跳过浮层内点击。
 * - 60vh 上限落在**根节点**(含头部/截断条),列表 flex-1 在剩余高度里滚动(审查 M2)。
 * - 关闭时整棵子树保持挂载、根节点加 `hidden` 属性(而非 CSS):combobox 常驻,`aria-expanded=false` 才是真断言(审查 M1)。
 * - 根节点 `onMouseDown` preventDefault:点非行区域(计数/徽标/padding)不把焦点从输入框挪到 body;
 *   键盘监听在 `use-palette.ts` 里挂到 window,即使焦点真的丢了也还能按 Esc/Tab/方向键/Enter(审查 Important 1)。
 * - aria:输入框 combobox + aria-expanded/controls/activedescendant;列表 listbox;行 option + aria-selected;
 *   计数在 aria-live 里播报「N 项」(区域先挂空、effect 写入,避开「挂载即带内容不播报」,审查 M6);
 *   无结果时列表位置给一条不可执行的提示项(设计 §3.8)。
 */
import { useEffect, useId, useState } from 'react';
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
  const badge = prefixLabel(c.prefix);
  // 计数文本由 effect 在挂载后写入:首帧 aria-live 区域为空,不出现「区域带着初始文本一起挂载」(审查 M6)
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(c.isOpen ? `${c.total} 项` : '');
  }, [c.isOpen, c.total]);

  return (
    <div
      data-floating="palette"
      role="dialog"
      aria-label={p.label ?? '快速打开'}
      hidden={!c.isOpen}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed left-1/2 top-14 z-40 flex max-h-[60vh] w-[36rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-raised shadow-xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
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
          placeholder={prefixHint(c.prefix)}
          className="h-7 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
        />
        <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-faint">
          {announced}
        </span>
      </div>
      {c.truncated && (
        <p className="shrink-0 border-b border-border px-3 py-1 text-[11px] text-faint">
          结果过多,只显示前 {c.rows.length} 项,继续输入以缩小范围
        </p>
      )}
      <ul id={listId} role="listbox" aria-label="结果" className="min-h-0 flex-1 overflow-y-auto py-1">
        {c.rows.length === 0 ? (
          // 空态:唯一一行不可执行。用 role=option + aria-disabled=true 保住「列表里有一项」的语义,
          // 代价是部分屏幕阅读器只播报列表名而不读该行;行为正确(Enter 不会误接受,见 use-palette accept),
          // 取舍已披露(审查 M7),不改行为。
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
