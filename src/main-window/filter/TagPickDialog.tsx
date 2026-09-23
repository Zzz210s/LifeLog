import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { TagCount } from '../../shared/types';
import { BTN_ICON } from '../shell/button-classes';

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
      className="fixed inset-0 z-40 flex items-center justify-center bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        // 同表达式弹层:根滚动已关,弹层必须自己能滚且不超出视口(2026-09-21 复审 A3);
        // 内部标签列表原有的 max-h-64 + 自身滚动保持不变(外层可滚只是极小窗口下再兜一层)
        className="max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded-lg border border-border bg-raised p-4 shadow-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-title text-text">{title}</h2>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="关闭"
            className={BTN_ICON}
          >
            ×
          </button>
        </div>
        <label className="mb-2 flex items-center gap-1.5 text-label text-muted">
          <input
            type="checkbox"
            checked={includeChildren}
            onChange={(e) => setIncludeChildren(e.target.checked)}
          />
          含子级(按路径前缀匹配子孙标签)
        </label>
        {error !== '' ? (
          <p className="py-6 text-center text-label text-danger">{error}</p>
        ) : rows === null ? (
          <p className="py-6 text-center text-label text-muted">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-label text-muted">还没有标签,在输入栏写 #标签 试试</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
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
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text disabled:cursor-default disabled:text-faint disabled:line-through disabled:hover:bg-transparent disabled:hover:text-faint"
                    style={{ paddingLeft: 10 + row.depth * 12 }}
                  >
                    <span className="truncate">{row.path}</span>
                    {picked ? (
                      <span className="shrink-0 text-label text-muted">已添加</span>
                    ) : (
                      <span className="shrink-0 text-label text-muted">{count}</span>
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
