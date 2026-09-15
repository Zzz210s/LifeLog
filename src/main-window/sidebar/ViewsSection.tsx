/**
 * 侧栏「视图」分区(spec 6.1):内置三项(置顶、只读、徽标)+ 自建视图
 * (徽标、悬停重命名/删除、拖拽排序调 reorderViews、+ 保存当前条件、空态引导行)。
 * 点击行 = 该视图条件整体装进当前条件对象(即时查询);徽标走 view-hits(Err 已降级)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { api } from '../../shared/api';
import type { FilterConditions } from '../../shared/filter-conditions';
import { filterKey } from '../../shared/filter-conditions';
import { normalizeFilter } from '../../shared/filter-conditions-parse';
import type { SavedView } from '../../shared/types';
import { SaveViewDialog } from '../SaveViewDialog';
import { fetchViewHits } from '../view-hits';
import type { ViewHits } from '../view-hits';
import { BUILTIN_VIEWS } from './builtin-views';
import { ViewRow } from './ViewRow';

export interface ViewsSectionProps {
  conditions: FilterConditions;
  onApplyView: (c: FilterConditions) => void;
  /** 数据变更信号(标签/笔记增删改):变化时重载视图列表与徽标 */
  dataVersion: number;
}

const BUILTIN_ROW =
  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 pr-2 text-left text-xs transition-colors ';

export function ViewsSection(p: ViewsSectionProps): ReactNode {
  const [views, setViews] = useState<SavedView[]>([]);
  const [hits, setHits] = useState<ViewHits>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1500);
  };

  const load = useCallback(() => {
    void api
      .listViews()
      .then(setViews)
      .catch((e) => setError('视图加载失败: ' + String(e)));
    void fetchViewHits().then(setHits);
  }, []);

  useEffect(() => {
    load();
  }, [load, p.dataVersion]);

  const currentKey = filterKey(p.conditions);

  const renameView = (v: SavedView, t: string) => {
    void api
      .updateView(v.id, t, v.conditions)
      .then(() => {
        load();
        showFlash('已重命名视图');
      })
      .catch((e) => setError('重命名失败: ' + String(e)));
  };

  const removeView = (v: SavedView) => {
    void (async () => {
      const ok = await confirm(`删除视图「${v.title}」?(不影响笔记本身)`, {
        title: '删除视图',
        kind: 'warning',
      }).catch(() => false);
      if (!ok) return;
      try {
        await api.deleteView(v.id);
        load();
        showFlash('已删除视图');
      } catch (e) {
        setError('删除视图失败: ' + String(e));
      }
    })();
  };

  /** 拖拽落位:把 fromId 挪到 toId 的位置,乐观重排后整批重写 sort_order */
  const reorder = (fromId: number, toId: number) => {
    setDragId(null);
    if (fromId === toId) return;
    const ids = views.map((v) => v.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const byId = new Map(views.map((v) => [v.id, v]));
    setViews(ids.map((id) => byId.get(id)) as SavedView[]);
    void api
      .reorderViews(ids)
      .then(load)
      .catch((e) => {
        setError('排序失败: ' + String(e));
        load(); // 乐观顺序作废,以库内顺序为准
      });
  };

  const badge = (key: string): string => {
    const n = hits[key];
    return n === undefined ? '—' : String(n);
  };

  return (
    <section className="shrink-0 border-b border-gray-200 pb-2" aria-label="视图分区">
      <div className="group flex h-8 items-center gap-1 px-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">视图</h2>
        {flash && <span className="truncate text-xs text-green-600">{flash}</span>}
        <button
          type="button"
          title="新建视图(保存当前条件)"
          aria-label="新建视图"
          onClick={() => setSaveOpen(true)}
          className="ml-auto rounded p-1 text-gray-400 opacity-0 hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100"
        >
          +
        </button>
      </div>
      {error !== '' && (
        <p className="px-2 pb-1 text-xs text-red-500">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-1 underline">
            关闭
          </button>
        </p>
      )}
      <div className="px-1">
        {BUILTIN_VIEWS.map((v) => (
          <button
            type="button"
            key={v.key}
            data-view-key={v.key}
            onClick={() => p.onApplyView(v.conditions)}
            title={`视图:${v.title}`}
            className={
              BUILTIN_ROW +
              (filterKey(v.conditions) === currentKey
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700')
            }
          >
            <span className="min-w-0 truncate">{v.title}</span>
            <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-gray-400">
              {badge(v.key)}
            </span>
          </button>
        ))}
        {views.map((v) => (
          <ViewRow
            key={v.id}
            view={v}
            active={filterKey(v.conditions) === currentKey}
            badge={badge(`view:${v.id}`)}
            onApply={() => p.onApplyView(normalizeFilter(v.conditions))}
            onRename={(t) => renameView(v, t)}
            onDelete={() => removeView(v)}
            onDragStart={() => setDragId(v.id)}
            onDrop={() => dragId !== null && reorder(dragId, v.id)}
          />
        ))}
        {views.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-gray-400" title="点击上方 + 把当前筛选条件保存为视图">
            还没有自建视图;点上方 + 把当前条件存为视图
          </p>
        )}
      </div>
      {saveOpen && (
        <SaveViewDialog
          conditions={p.conditions}
          onClose={() => setSaveOpen(false)}
          onSaved={() => {
            load();
            showFlash('已保存视图');
          }}
        />
      )}
    </section>
  );
}
