import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../shared/filter-conditions';
import { tagDisplayName } from './tag-display';

export interface FilterBarProps {
  /** 顶层筛选条件(标签选中态与排序都从这里派生,外观与旧版一致) */
  conditions: FilterConditions;
  /** 局部更新条件 */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 标签过滤板的数据源:name 为**完整路径**,count 为本级链接数(精确路径匹配) */
  allTags: { name: string; count: number }[];
  /** 导出(整库 xlsx;未传则不渲染按钮) */
  onExport?: () => void;
  exporting?: boolean;
  exported?: boolean;
}

/** 筛选栏:关键词(内部 300ms 防抖上抛)| 标签多选 chips | 排序切换 | 导出(可选) */
export function FilterBar(p: FilterBarProps): ReactNode {
  const keyword = p.conditions.keyword ?? '';
  const activePaths = p.conditions.tags.map((t) => t.path);
  const oldestFirst = p.conditions.sort === 'oldest';
  const [kw, setKw] = useState(keyword);
  const timer = useRef<number | null>(null);
  const sent = useRef(keyword); // 本组件最后一次上抛的关键词

  // 仅在外部 keyword 不是本组件上抛的值时才回写:否则会覆盖正在输入的内容
  // (如输入 "读书 " 停 300ms 后继续输入,回写会退回到旧的去空格值导致输入丢失)
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
      // 不 trim:后端 query_notes 已 trim,前端 trim 会吞掉输入中的尾随空格;
      // 用补丁而非整体替换,避免 300ms 内其他字段的改动被旧条件覆盖
      p.onPatch({ keyword: v });
    }, 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggleTag = (name: string) => {
    const tags = activePaths.includes(name)
      ? p.conditions.tags.filter((t) => t.path !== name)
      : [...p.conditions.tags, { path: name, includeChildren: true }]; // 标签项默认含子级
    p.onPatch({ tags });
  };

  return (
    <div className="border-b border-gray-200 px-4 py-2">
      <div className="flex items-center gap-2">
        <input
          value={kw}
          onChange={(e) => onInput(e.target.value)}
          placeholder="搜索笔记与标签"
          aria-label="搜索笔记与标签"
          className="h-8 flex-1 rounded-md border border-gray-300 px-2.5 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={() => p.onPatch({ sort: oldestFirst ? 'newest' : 'oldest' })}
          className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
        >
          排序: {oldestFirst ? '最早' : '最新'}
        </button>
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
      {p.allTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.allTags.map(({ name, count }) => {
            const active = activePaths.includes(name);
            return (
              <button
                key={name}
                onClick={() => toggleTag(name)}
                aria-pressed={active}
                title={name}
                className={
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
                  (active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600')
                }
              >
                #{tagDisplayName(name)}
                <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-gray-400'}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
