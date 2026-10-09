import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { Backlink } from '../../shared/types';

export interface BacklinksPanelProps {
  /** 要列出反向引用的目标笔记 id */
  noteId: number;
  /** 点来源条目跳到那个条目(复用 L2 的快速打开);不传则只读(编辑面板) */
  onOpenNote?: (id: number) => void;
  /** 拉取出错上报(交主窗错误机制);不传则静默为空列表 */
  onError?: (message: string) => void;
}

/**
 * 反向引用列表(卡片面板与编辑面板共用,L3):挂载时才拉 `note_links`,
 * 只列出**来源首行**(设计 §4:不显示相对时间);条目可点则跳那条来源笔记。
 */
export function BacklinksPanel({ noteId, onOpenNote, onError }: BacklinksPanelProps): ReactNode {
  const [items, setItems] = useState<Backlink[] | null>(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    void api.noteLinks(noteId).then(
      (r) => {
        if (alive) setItems(r.backlinks);
      },
      (e) => {
        if (alive) {
          setItems([]);
          onError?.('加载反向引用失败: ' + String(e));
        }
      }
    );
    return () => {
      alive = false;
    };
    // onError 不进依赖:它每次渲染可能是新箭头,进了会让面板反复重拉
  }, [noteId]);
  if (items === null || items.length === 0) return null;
  return (
    <ul
      data-testid="backlinks-panel"
      className="mt-2 flex flex-col gap-1 border-t border-border pt-2"
    >
      {items.map((b) =>
        onOpenNote ? (
          <li key={b.sourceId}>
            <button
              type="button"
              onClick={() => onOpenNote(b.sourceId)}
              title={b.title}
              className="flex h-7 w-full items-center rounded-sm px-2 text-left text-ui text-muted transition-colors hover:bg-hover hover:text-accent-text"
            >
              <span className="truncate">{b.title}</span>
            </button>
          </li>
        ) : (
          <li key={b.sourceId} className="max-w-full truncate px-1 py-0.5 text-xs text-muted" title={b.title}>
            {b.title}
          </li>
        )
      )}
    </ul>
  );
}
