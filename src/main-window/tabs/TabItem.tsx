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

/** 标签页语义(设计 §4-3,VS Code):活动页 = canvas 底 + 顶部 2px accent 指示;
 * 非活动页 = chrome-alt 底;条高 32,页角 6/6/0/0。两态底色必须成对可区分。 */
const TAB_CLASS =
  'group flex h-8 max-w-56 shrink-0 items-center gap-1 rounded-t-sm border-t-2 px-2 text-ui ';

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
        className="h-8 w-32 shrink-0 rounded-t-sm border border-b-0 border-accent px-2 text-ui outline-none"
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
          ? 'border-accent bg-canvas text-text'
          : 'border-transparent bg-chrome-alt text-muted hover:bg-hover hover:text-text')
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
        className="shrink-0 rounded-xs px-1 text-faint hover:bg-text/10 hover:text-danger"
      >
        ×
      </button>
    </div>
  );
}
