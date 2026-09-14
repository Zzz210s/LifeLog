import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../shared/api';
import type { TagCount } from '../shared/types';

export interface TagPickDialogProps {
  /** 模式:false 加入标签 / true 排除标签 */
  exclude: boolean;
  /** 两侧(tags 与 excludeTags)已含的路径:渲染为「已添加」不可再选(同一路径两侧同选结果恒空,故另一侧也禁选) */
  selected: string[];
  onClose: () => void;
  onPick: (path: string, includeChildren: boolean) => void;
}

/**
 * 标签选择器(添加条件 -> 标签/排除标签):全量标签树 + 含子级开关(spec 6.2)。
 * 数据源用 list_tags(标签树全量)而不是仅直接链接的计数(旧标签板口径,已随标签板移除):
 * 父级标签本级往往没有链接,选不到父级则「含子级」开关形同虚设;
 * 计数随开关切换 —— 仅本级显示 self_count,含子级显示 subtree_count(即实际会命中的笔记数)。
 */
export function TagPickDialog(p: TagPickDialogProps): ReactNode {
  const [includeChildren, setIncludeChildren] = useState(true);
  const [rows, setRows] = useState<TagCount[] | null>(null);
  const [error, setError] = useState('');

  // 打开时取全量标签树;窗口关闭即作废,过期响应丢弃
  useEffect(() => {
    let dead = false;
    api
      .listTags()
      .then((r) => {
        if (!dead) setRows(r);
      })
      .catch((e) => {
        if (!dead) setError('标签加载失败: ' + String(e));
      });
    return () => {
      dead = true;
    };
  }, []);

  // Esc 关闭(捕获阶段,防其它全局快捷键)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [p]);

  const title = p.exclude ? '排除标签' : '添加标签';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="关闭"
            className="rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ×
          </button>
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeChildren}
            onChange={(e) => setIncludeChildren(e.target.checked)}
          />
          含子级(按路径前缀匹配子孙标签)
        </label>
        {error !== '' ? (
          <p className="py-6 text-center text-xs text-red-500">{error}</p>
        ) : rows === null ? (
          <p className="py-6 text-center text-xs text-gray-400">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">还没有标签,在输入栏写 #标签 试试</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded border border-gray-100">
            {rows.map((row) => {
              const picked = p.selected.includes(row.path);
              const count = includeChildren ? row.subtree_count : row.self_count;
              return (
                <li key={row.path}>
                  <button
                    type="button"
                    disabled={picked}
                    onClick={() => p.onPick(row.path, includeChildren)}
                    title={row.path}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300"
                    style={{ paddingLeft: 10 + row.depth * 12 }}
                  >
                    <span className="truncate">{row.path}</span>
                    {picked ? (
                      <span className="shrink-0 text-gray-300">已添加</span>
                    ) : (
                      <span className="shrink-0 text-gray-400">{count}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
