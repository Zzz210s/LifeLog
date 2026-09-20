/**
 * 笔记卡片的 chip 两排(spec 2026-09-20 §5.3 / D10 / D11):
 * 主题行沿用现有样式,属性行更小、底色弱化;超出阈值显示 `+N`,点击只展开**该排**
 * (只折叠不隐藏)。悬浮 title 仍是完整路径,点击仍走 onTagClick(与筛选同一入口)。
 * 时间标签已降级为普通标签(D3),这里不做任何特殊过滤。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { tagDisplayName } from './tag-display';
import { ATTR_MAX, TOPIC_MAX, collapseChips, groupChips } from './note-chips';

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

/** chip 样式:主题排是现有样式,属性排更小更淡;选中态两排一致 */
function chipClass(active: boolean, attr: boolean): string {
  if (attr) {
    return (
      CHIP_BASE +
      'px-1.5 py-0.5 text-[10px] ' +
      (active ? ACTIVE : 'bg-tag/60 text-faint hover:bg-accent-soft hover:text-accent-text')
    );
  }
  return (
    CHIP_BASE + 'px-1.5 py-0.5 text-xs ' + (active ? ACTIVE : 'bg-tag text-accent-text hover:bg-accent-soft')
  );
}

function ChipRow(p: ChipRowProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (p.tags.length === 0) return null;
  // 展开后不再折叠:整排显示完(标签本身由笔记数据决定,不会因此变多)
  const { shown, hidden } = expanded
    ? { shown: [...p.tags], hidden: 0 }
    : collapseChips(p.tags, p.max);
  return (
    <div className={'flex flex-wrap ' + (p.attr ? 'mt-1 gap-1' : 'mt-2 gap-1.5')}>
      {shown.map((t) => {
        const active = p.activeTags.includes(t);
        return (
          <button
            key={t}
            onClick={() => p.onTagClick(t)}
            aria-pressed={active}
            title={t}
            className={chipClass(active, p.attr)}
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
          className={
            'shrink-0 rounded text-faint hover:text-accent-text ' +
            (p.attr ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs')
          }
        >
          +{hidden}
        </button>
      )}
    </div>
  );
}

export function NoteChips(p: NoteChipsProps): ReactNode {
  if (p.tags.length === 0) return null;
  const groups = groupChips(p.tags);
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
