/**
 * 笔记卡片的 chip 两排(spec 2026-09-20 §5.3 / D10 / D11):
 * 主题行沿用现有样式,属性行更小、底色弱化;超出阈值显示 `+N`,点击只展开**该排**
 * (只折叠不隐藏)。悬浮 title 仍是完整路径,点击仍走 onTagClick(与筛选同一入口)。
 * 时间标签已降级为普通标签(D3),这里不做任何特殊过滤。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { tagDisplayName } from '../editor/tag-display';
import { ATTR_MAX, TOPIC_MAX, collapseAncestors, collapseChips, groupChips } from './note-chips';

export interface NoteChipsProps {
  tags: readonly string[];
  activeTags: string[];
  onTagClick: (name: string) => void;
}

interface ChipRowProps {
  tags: readonly string[];
  max: number;
  activeTags: string[];
  onTagClick: (name: string) => void;
  /** 属性排:字号更小、底色弱化(与主题排可区分) */
  attr: boolean;
}

/** S4:chip 文案是完整路径,长路径靠 max-w + truncate 收窄,title 兜底全量 */
const CHIP_BASE = 'max-w-[16rem] truncate rounded transition-colors ';
const ACTIVE = 'bg-accent-soft text-accent-text';

/** chip 样式:两排**完全一致**(统一字号与文字色,只有分行不同)。
 * 曾把属性排做成 text-[10px] + text-faint,结果同一张卡片上蓝字与灰字并排(用户报为 bug);
 * 现在只有"选中(在筛选里)= 蓝底蓝字 / 未选中 = 灰底蓝字"这一种状态区分。 */
function chipClass(active: boolean): string {
  return CHIP_BASE + 'px-1.5 py-0.5 text-xs ' + (active ? ACTIVE : 'bg-tag text-accent-text hover:bg-accent-soft');
}
function ChipRow(p: ChipRowProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (p.tags.length === 0) return null;
  // 展开后不再折叠:整排显示完(标签本身由笔记数据决定,不会因此变多)
  const { shown, hidden } = expanded
    ? { shown: [...p.tags], hidden: 0 }
    : collapseChips(p.tags, p.max);
  return (
    <div className={'flex flex-wrap ' + (p.attr ? 'mt-1 gap-1' : 'mt-2 gap-1')}>
      {shown.map((t) => {
        const active = p.activeTags.includes(t);
        return (
          <button
            key={t}
            onClick={() => p.onTagClick(t)}
            aria-pressed={active}
            title={t}
            className={chipClass(active)}
          >
            #{tagDisplayName(t)}
          </button>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={`展开其余 ${hidden} 个标签`}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:text-accent-text"
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
  const groups = groupChips(collapseAncestors(p.tags));
  // key 随该排标签集合变化:笔记保存后标签变了,展开态跟着重置(不会停在旧集合上)
  return (
    <>
      <ChipRow
        key={'topic:' + groups.topic.join('\u0000')}
        tags={groups.topic}
        max={TOPIC_MAX}
        activeTags={p.activeTags}
        onTagClick={p.onTagClick}
        attr={false}
      />
      <ChipRow
        key={'attr:' + groups.attrs.join('\u0000')}
        tags={groups.attrs}
        max={ATTR_MAX}
        activeTags={p.activeTags}
        onTagClick={p.onTagClick}
        attr
      />
    </>
  );
}
