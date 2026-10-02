/**
 * 统一输入框的候选面板(自 `UnifiedInput` 抽出:接线 + 键盘 + 下拉一次给全,宿主只管渲染)。
 *
 * 两套候选并存,优先级:命中未闭合 `[[` 时用**链接候选**(笔记标题,`useLinkComplete`),
 * 否则沿用**前缀候选**(`#`/`>`/`@`,由 `useUnifiedCandidates` 常驻驱动控制器)。两者的
 * 列表模型/高亮/渲染/键盘都走同一套,所以外观与操作完全一致(设计 N2)。
 *
 * 采纳分两路:链接模式用 `acceptLink` 把正文写回(`writeText`,不存笔记、不清框);前缀模式
 * 关下拉后把索引交给宿主的副作用出口(`onAccept`)。Esc 同理:链接模式只收面板不动正文。
 */
import type { KeyboardEventHandler, ReactNode } from 'react';
import type { InputMode } from '../../shared/input-prefix';
import type { NoteMruSource } from '../../shared/note-mru';
import type { RowDecoration } from '../palette/PaletteRow';
import { renderRowCount } from '../palette/palette-limits';
import type { PaletteController } from '../palette/use-palette';
import { activeOptionRowId, UnifiedDropdownSlot } from './UnifiedDropdown';
import { useUnifiedCandidates } from './use-unified-candidates';
import { useUnifiedKeys } from './use-unified-keys';
import { useLinkComplete } from './use-link-complete';

export interface UnifiedPanelOptions {
  raw: string;
  caret: number;
  mode: InputMode;
  query: string;
  /** 前缀模式的开合(状态机给:记录/筛选恒假) */
  prefixOpen: boolean;
  /** 前缀模式的候选控制器(没接候选时为 null) */
  palette: PaletteController | null;
  decorations?: Readonly<Record<string, RowDecoration>>;
  /** 笔记数据版本与「正在编辑的那一条」(链接候选池) */
  dataVersion: number;
  excludeNoteId?: number;
  /** 笔记 MRU(链接候选的空查询排序与采纳记账;与主窗共用一份实例) */
  noteMru?: NoteMruSource | null;
  save: () => void;
  /** 链接采纳:写回正文与光标 */
  writeText: (text: string, caret: number) => void;
  /** 前缀采纳:副作用由宿主执行(Task 6) */
  onAccept: (index: number) => void;
  /** 前缀模式关下拉(状态机) */
  closeDropdown: () => void;
  /** 前缀模式 Esc(状态机两级) */
  esc: () => void;
}

export interface UnifiedPanel {
  dropdownShown: boolean;
  activeOptionId: string | null;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  dropdown: ReactNode;
}

export function useUnifiedPanel(o: UnifiedPanelOptions): UnifiedPanel {
  const link = useLinkComplete({
    raw: o.raw,
    caret: o.caret,
    dataVersion: o.dataVersion,
    excludeId: o.excludeNoteId,
    mru: o.noteMru,
  });
  // 常驻驱动前缀控制器(无候选接线时退化为空列表):下拉数据来自控制器,本 hook 不再自己取
  useUnifiedCandidates({ mode: o.mode, query: o.query, controller: o.palette });

  const shown = link.active ? link.controller : o.palette;
  const dropdownShown = link.active || o.prefixOpen;
  const rows = shown === null ? [] : shown.rows;

  const accept = (index: number) => {
    if (link.active) {
      const next = link.accept(index);
      if (next !== null) o.writeText(next.text, next.caret);
      link.dismiss();
      return;
    }
    o.closeDropdown();
    o.onAccept(index);
  };
  const esc = () => {
    if (link.active) link.dismiss();
    else o.esc();
  };

  const onKeyDown = useUnifiedKeys({
    dropdownShown,
    activeIndex: shown?.activeIndex ?? 0,
    count: renderRowCount(rows.length),
    save: o.save,
    esc,
    highlight: (index) => shown?.setActiveIndex(index),
    accept,
  });

  return {
    dropdownShown,
    activeOptionId: shown === null ? null : activeOptionRowId(rows.length, shown.activeIndex),
    onKeyDown,
    dropdown:
      dropdownShown && shown !== null ? (
        <UnifiedDropdownSlot
          rows={rows}
          total={shown.total}
          truncated={shown.truncated}
          palette={shown}
          decorations={link.active ? undefined : o.decorations}
          onAccept={accept}
          emptyText={link.active ? '没有匹配的笔记' : undefined}
        />
      ) : null,
  };
}
