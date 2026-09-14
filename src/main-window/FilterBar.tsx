import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../shared/filter-conditions';
import { AddConditionMenu } from './AddConditionMenu';
import { FilterChips } from './FilterChips';
import { SaveViewDialog } from './SaveViewDialog';
import { TagPickDialog } from './TagPickDialog';
import { applyTagPick, chipsOf, summaryOf } from './filter-chips';

export interface FilterBarProps {
  /** 顶层筛选条件(标签选中态与排序都从这里派生) */
  conditions: FilterConditions;
  /** 局部更新条件 */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 导出(整库 xlsx;未传则不渲染按钮) */
  onExport?: () => void;
  exporting?: boolean;
  exported?: boolean;
}

/**
 * 筛选栏:关键词(300ms 防抖上抛)| 条件 chips + 添加条件 + 保存为视图 | 导出(可选)。
 * 标签选点入口已收敛到侧栏(主入口)与本栏「添加条件」的标签选择器(排除/仅本级);
 * 旧标签板(仅本级链接的平铺 chips)移除,条件 chips 的显示/单删保留。
 */
export function FilterBar(p: FilterBarProps): ReactNode {
  const keyword = p.conditions.keyword ?? '';
  const activePaths = p.conditions.tags.map((t) => t.path);
  // 两侧已选路径合集:同一标签同时进 tags 与 excludeTags 结果恒空,任一侧已含即禁选
  const pickedPaths = [...activePaths, ...p.conditions.excludeTags.map((t) => t.path)];
  const oldestFirst = p.conditions.sort === 'oldest';
  const [kw, setKw] = useState(keyword);
  const timer = useRef<number | null>(null);
  const sent = useRef(keyword); // 本组件最后一次上抛的关键词

  const [tagPick, setTagPick] = useState<{ exclude: boolean } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  // 仅在外部 keyword 不是本组件上抛的值时才回写:否则会覆盖正在输入的内容
  useEffect(() => {
    if (keyword !== sent.current) {
      sent.current = keyword;
      setKw(keyword);
    }
  }, [keyword]);

  const onInput = (v: string) => {
    setKw(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      sent.current = v;
      // 不 trim:后端 query_notes 已 trim;用补丁避免 300ms 内其它字段改动被旧条件覆盖
      p.onPatch({ keyword: v });
    }, 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** 立即上抛仍在防抖中的关键词:保存视图前调用,否则存下的视图会缺关键词 */
  const flushKeyword = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (kw !== sent.current) {
      sent.current = kw;
      p.onPatch({ keyword: kw });
    }
  };

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1500);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const summary = summaryOf(p.conditions);

  return (
    <div className="border-b border-gray-200 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={kw}
          onChange={(e) => onInput(e.target.value)}
          placeholder="搜索笔记与标签"
          aria-label="搜索笔记与标签"
          className="h-8 min-w-40 flex-1 rounded-md border border-gray-300 px-2.5 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={() => p.onPatch({ sort: oldestFirst ? 'newest' : 'oldest' })}
          className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
        >
          排序: {oldestFirst ? '最早' : '最新'}
        </button>
        <AddConditionMenu conditions={p.conditions} onPatch={p.onPatch} onPickTag={(exclude) => setTagPick({ exclude })} />
        <button
          onClick={() => {
            flushKeyword(); // 先把输入框当前值上抛,再开对话框
            setSaveOpen(true);
          }}
          title="把当前条件保存为视图"
          className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
        >
          保存为视图
        </button>
        {flash && <span className="shrink-0 text-xs text-green-600">{flash}</span>}
        {p.onExport && (
          <>
            {p.exported && <span className="shrink-0 text-xs text-green-600">已导出</span>}
            <button
              onClick={p.onExport}
              disabled={p.exporting}
              title="导出全部笔记(不受筛选影响)"
              className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {p.exporting ? '导出中' : '导出全部'}
            </button>
          </>
        )}
      </div>
      <FilterChips chips={chipsOf(p.conditions)} onRemove={(next) => p.onPatch(next)} />
      {summary !== '' && (
        <p className="mt-1 truncate text-xs text-gray-400" title={summary}>
          {summary}
        </p>
      )}
      {tagPick && (
        <TagPickDialog
          exclude={tagPick.exclude}
          selected={pickedPaths}
          onClose={() => setTagPick(null)}
          onPick={(path, includeChildren) => {
            p.onPatch(applyTagPick(p.conditions, path, { exclude: tagPick.exclude, includeChildren }));
            setTagPick(null);
          }}
        />
      )}
      {saveOpen && (
        <SaveViewDialog
          conditions={p.conditions}
          onClose={() => setSaveOpen(false)}
          onSaved={() => showFlash('已保存视图')}
        />
      )}
    </div>
  );
}
