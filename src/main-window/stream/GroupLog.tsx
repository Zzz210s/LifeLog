import type { ReactNode } from 'react';
import type { Note } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';
import { GroupHeader } from './GroupHeader';
import type { NoteGroup } from '../data/use-grouped-notes';

export interface GroupLogProps {
  groups: NoteGroup[];
  /** 会话内折叠的组键 */
  collapsed: ReadonlySet<string>;
  /** 正在续页的组(一次一组) */
  loadingGroup: string | null;
  onToggle: (sessionKey: string) => void;
  onLoadMore: (sessionKey: string) => void;
  /** 单个条目的渲染(与平铺路径共用同一份卡片/编辑态逻辑) */
  renderNote: (note: Note) => ReactNode;
}

/**
 * 分组信息流(设计 §6.2/§6.4):组头 + 组内卡片 + 组内「加载更多」(按组独立,offset 只数本组)。
 * 折叠只隐藏本组内容,不触碰任何别的组;平铺路径不经过这里。
 */
export function GroupLog(p: GroupLogProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {p.groups.map((g) => {
        const folding = p.collapsed.has(g.sessionKey);
        return (
          <section key={g.sessionKey} data-testid="group-section">
            <GroupHeader
              label={g.label}
              title={g.key ?? undefined}
              count={g.count}
              collapsed={folding}
              onToggle={() => p.onToggle(g.sessionKey)}
            />
            {!folding && (
              <>
                <ul className="mt-2 flex flex-col gap-2">
                  {g.notes.map((n) => p.renderNote(n))}
                </ul>
                {g.hasMore && (
                  <button
                    type="button"
                    data-testid="group-more"
                    className={BTN_SECONDARY + ' mt-2'}
                    disabled={p.loadingGroup !== null}
                    onClick={() => p.onLoadMore(g.sessionKey)}
                  >
                    {p.loadingGroup === g.sessionKey ? '加载中...' : `加载更多（已 ${g.notes.length} / ${g.count} 条）`}
                  </button>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
