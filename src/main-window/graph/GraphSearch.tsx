/**
 * 图内搜索框(G2 Task 7):图顶部居中,输入即出候选(最多 8 条),Enter 取第一条跳过去。
 *
 * 候选打分在 `graph-search`(纯函数),这里只管输入、列表与按键:
 * - `Enter` 取第一条 -> `onPick`(上层把相机居中到该节点并选中)并清空收列表
 * - `Esc` 清空收列表,**并拦住这次 keydown** —— 图外壳的 window 监听把 Esc 当「回信息流」,
 *   不拦就会在用户想取消搜索时把整个视图关掉。输入框本来就是空的时候不拦(让视图正常退出)
 * - 候选行用 `onMouseDown` + preventDefault:点击不该先让输入框失焦(blur 会先收掉列表,click 落空)
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { tagLabelPlain } from '../../shared/tag-label';
import type { GraphNode } from '../../shared/types';
import { searchNodes } from './graph-search';

export function GraphSearch(p: {
  nodes: readonly GraphNode[];
  onPick: (node: GraphNode) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchNodes(p.nodes, query), [p.nodes, query]);
  const typed = query.trim() !== '';

  const close = (): void => {
    setQuery('');
    setOpen(false);
  };

  const pick = (node: GraphNode): void => {
    p.onPick(node);
    close();
  };

  return (
    <div
      data-testid="graph-search"
      data-graph-overlay
      className="absolute left-1/2 top-3 z-20 w-64 -translate-x-1/2"
    >
      <input
        data-testid="graph-search-input"
        value={query}
        placeholder="搜索标签"
        aria-label="搜索标签"
        className="h-8 w-full rounded-sm border border-border-strong bg-raised px-2 text-ui text-text outline-none placeholder:text-muted focus-visible:ring-1 focus-visible:ring-accent"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (hits.length > 0) pick(hits[0]);
            return;
          }
          if (e.key === 'Escape') {
            if (!typed) return; // 没在搜索:Esc 留给视图外壳(回信息流)
            e.stopPropagation(); // 不然 window 上的 Esc 会把整个关系图关掉
            close();
          }
        }}
      />
      {open && typed && (
        <ul
          data-testid="graph-search-list"
          className="mt-1 overflow-hidden rounded-sm border border-border-strong bg-raised text-ui shadow-lg"
        >
          {hits.length === 0 ? (
            <li data-testid="graph-search-empty" className="px-2 py-1 text-ui text-muted">
              没有匹配的标签
            </li>
          ) : (
            hits.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="graph-search-item"
                  className="block h-7 w-full truncate rounded-sm px-2 text-left text-ui text-text hover:bg-hover"
                  onMouseDown={(e) => {
                    e.preventDefault(); // 别让输入框失焦(否则列表先收掉,click 落空)
                    pick(n);
                  }}
                >
                  {tagLabelPlain(n.path)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
