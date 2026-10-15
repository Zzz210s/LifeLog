/**
 * 笔记卡片的 chip(2026-10-12「引用并入关系」):**只有一套** —— 不再分主题/属性两排。
 * 数据层只有「关系」一个概念(点线设计:`lines` 上 `name_id` 空 = 无名字关系、非空 = 有名字的关系),
 * 卡片上就只该有一种 chip;有名字的关系在别处(实体树行、关系面板)显示为「名字 + 目标」。
 * 顺序 = 数据给的稳定序(`read_full` 按目标路径升序;不做特殊排序,见 note-chips.ts)。
 * 超出阈值显示 `+N`,点击只展开整排(只折叠不隐藏)。点击仍走 onTagClick
 * (与筛选同一入口)。时间标签已降级为普通标签(D3),这里不做任何特殊过滤。
 * chip 文案的行内 md(T1):显示走 renderTagLabel 的预览态;点击仍回传原始路径。
 * 悬停文案(T4):有关系名给名字,无名回落纯文本路径 —— 名字只影响悬停,
 * 不进 chip 文字 / 折叠 / 祖先去重 / 寻址(设计 §5.3)。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { NoteTag } from '../../shared/types';
import { tagDisplayName } from '../editor/tag-display';
import { CHIP_MAX, collapseAncestors, collapseChips } from './note-chips';

export interface NoteChipsProps {
  tags: readonly NoteTag[];
  activeTags: string[];
  onTagClick: (name: string) => void;
}

interface ChipRowProps {
  tags: readonly NoteTag[];
  activeTags: string[];
  onTagClick: (name: string) => void;
}

/** S4:chip 文案是完整路径,长路径靠 max-w + truncate 收窄,title 兜底全量 */
const CHIP_BASE = 'max-w-[16rem] truncate rounded-xs border px-1.5 py-0.5 text-label transition-colors ';
const ACTIVE = 'border-accent bg-accent-soft text-accent-text';

/** chip 样式(设计 §4-2 中性化):默认 = chrome 底 + 1px border + muted 文字,
 * accent 只出现在 hover(可点)与选中态 —— 默认就是蓝字灰底的话读者分不出"哪个能点/已选"。 */
function chipClass(active: boolean): string {
  return (
    CHIP_BASE +
    (active
      ? ACTIVE
      : 'border-border bg-chrome text-muted hover:border-accent hover:bg-accent-soft hover:text-accent-text')
  );
}

function ChipRow(p: ChipRowProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  // 展开后不再折叠:整排显示完(标签本身由笔记数据决定,不会因此变多)
  // 折叠与去重只看**路径**;关系名只喂悬停文案(设计 §5.3)
  const paths = p.tags.map((t) => t.path);
  const { shown, hidden } = expanded
    ? { shown: paths, hidden: 0 }
    : collapseChips(paths, CHIP_MAX);
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {p.tags
        .filter((t) => shown.includes(t.path))
        .map((t) => {
          const active = p.activeTags.includes(t.path);
          return (
            <button
              key={t.path}
              onClick={() => p.onTagClick(t.path)}
              aria-pressed={active}
              onMouseEnter={hoverTitle(t.relationName ?? tagLabelPlain(t.path))}
              className={chipClass(active)}
            >
              #{renderTagLabel(tagDisplayName(t.path))}
            </button>
          );
        })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={`展开其余 ${hidden} 个关系`}
          className="shrink-0 rounded-xs border border-border bg-chrome px-1.5 py-0.5 text-label text-muted hover:border-accent hover:text-accent-text"
        >
          +{hidden}
        </button>
      )}
    </div>
  );
}

export function NoteChips(p: NoteChipsProps): ReactNode {
  if (p.tags.length === 0) return null;
  // 子蕴含父:祖先 chip 若其后代也在本卡片上就不再单独显示(只影响显示,不动数据)
  // 祖先去重只看**路径**,名字不进折叠(设计 §5.3);过滤保持数据给的稳定序
  const kept = collapseAncestors(p.tags.map((t) => t.path));
  const tags = p.tags.filter((t) => kept.includes(t.path));
  // key 随标签集合变化:笔记保存后标签变了,展开态跟着重置(不会停在旧集合上)
  return (
    <ChipRow
      key={tags.map((t) => t.path).join('\u0000')}
      tags={tags}
      activeTags={p.activeTags}
      onTagClick={p.onTagClick}
    />
  );
}
