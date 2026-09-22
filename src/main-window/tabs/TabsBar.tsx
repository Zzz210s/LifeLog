/**
 * 标签页栏(spec 2026-09-17 S7):顶栏下方一条;一个标签页 = 一套筛选条件快照 + 标题。
 * 本文件只做栏容器与拖拽重排(HTML5 draggable):单页行见 TabItem,「+」菜单见 TabAddMenu。
 * 拖拽落点 = 目标页本身(放到它当前的位置);末尾另有一条窄落区,用于拖到最后一页之后。
 * 只有一个默认页时不再挂长占位提示(设计 §4-3:「+」按钮的 title 已说明入口)。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PresetKey } from './tab-presets';
import type { Tab } from './tabs-model';
import { tabLabel } from './tabs-model';
import { TabAddMenu } from './TabAddMenu';
import { TabItem } from './TabItem';

export interface TabsBarProps {
  tabs: Tab[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRename: (index: number, title: string) => void;
  onPreset: (key: PresetKey) => void;
  onAddCurrent: () => void;
}

export function TabsBar(p: TabsBarProps): ReactNode {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const drop = (to: number) => {
    if (dragFrom !== null) p.onMove(dragFrom, to);
    setDragFrom(null);
    setEditing(null);
  };

  return (
    <div
      role="tablist"
      aria-label="标签页"
      data-tabs-count={p.tabs.length}
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-chrome px-2"
    >
      {p.tabs.map((tab, i) => (
        <TabItem
          key={i}
          label={tabLabel(tab)}
          title={tab.title}
          active={i === p.activeIndex}
          editing={editing === i}
          onActivate={() => {
            setEditing(null);
            p.onActivate(i);
          }}
          onClose={() => {
            setEditing(null);
            p.onClose(i);
          }}
          onRename={(title) => {
            setEditing(null);
            p.onRename(i, title);
          }}
          onStartEdit={() => setEditing(i)}
          onCancelEdit={() => setEditing(null)}
          onDragStart={() => setDragFrom(i)}
          onDrop={() => drop(i)}
        />
      ))}
      {/* 末尾窄落区:拖到最后一页之后 */}
      {p.tabs.length > 1 && (
        <div
          aria-hidden="true"
          data-drop-tail="true"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            drop(p.tabs.length - 1);
          }}
          className="h-8 w-3 shrink-0"
        />
      )}
      <TabAddMenu onPreset={p.onPreset} onAddCurrent={p.onAddCurrent} />
    </div>
  );
}
