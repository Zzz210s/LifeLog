/**
 * 单个标签页(spec 2026-09-17 S7):点击切换、× 关闭、拖拽重排、双击改名。
 * 改名是行内编辑(Enter 提交、Esc 取消、失焦提交);提交空标题即回退自动标题(上层存空串)。
 * 从 TabsBar 拆出以守 200 行上限;标题生成见 auto-title.ts。
 */
import { useRef } from 'react';
import type { ReactNode } from 'react';

export interface TabItemProps {
  /** 显示名(有用户标题用标题,否则自动标题) */
  label: string;
  /** 用户标题原文(改名输入框的初值;空串表示自动标题) */
  title: string;
  active: boolean;
  editing: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

const TAB_CLASS =
  'group flex h-7 max-w-56 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-xs ';

export function TabItem(p: TabItemProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);

  const commit = () => {
    const value = input.current?.value ?? p.title;
    p.onRename(value);
  };

  if (p.editing) {
    return (
      <input
        ref={input}
        autoFocus
        defaultValue={p.title}
        placeholder={p.label}
        aria-label="标签页标题"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') p.onCancelEdit();
        }}
        className="h-7 w-32 shrink-0 rounded-t-md border border-b-0 border-accent px-2 text-xs outline-none"
      />
    );
  }

  return (
    <div
      role="tab"
      aria-selected={p.active}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', p.label);
        p.onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
      onClick={p.onActivate}
      onDoubleClick={p.onStartEdit}
      title={`标签页:${p.label}(双击改名,拖拽调整顺序)`}
      className={
        TAB_CLASS +
        (p.active
          ? 'bg-panel text-text shadow-sm'
          : 'border-transparent text-muted hover:bg-panel/60 hover:text-text')
      }
    >
      <span className="min-w-0 truncate">{p.label}</span>
      <button
        type="button"
        title="关闭标签页(至少保留一个)"
        aria-label={`关闭标签页 ${p.label}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onClose();
        }}
        className="shrink-0 rounded px-1 text-faint hover:bg-text/10 hover:text-danger"
      >
        ×
      </button>
    </div>
  );
}
