import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { RoleRef } from '../../shared/types';
import { BTN_ICON } from '../shell/button-classes';

export interface RolePickDialogProps {
  /** 模式:false 加入角色条件 / true 排除角色条件 */
  exclude: boolean;
  /** 两侧(roles 与 excludeRoles)已含的路径:渲染为「已添加」不可再选 */
  selected: string[];
  onClose: () => void;
  /** 选中回传角色标签完整路径(筛选条件存路径,数据层按 roles.tag_id 反查) */
  onPick: (path: string) => void;
}

/**
 * 角色选择器(添加条件 -> 角色/排除角色):数据源是 `list_roles`(只列**已登记**的角色)。
 * 角色天然含子级并叠加携带(R4),所以没有「含子级」开关;显示口径与标签选择器一致,
 * 用纯文本形态,回传仍是原始路径。
 */
export function RolePickDialog(p: RolePickDialogProps): ReactNode {
  const [rows, setRows] = useState<RoleRef[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let dead = false;
    api
      .listRoles()
      .then((r) => {
        if (!dead) setRows(r);
      })
      .catch((e) => {
        if (!dead) setError('角色加载失败: ' + String(e));
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

  const title = p.exclude ? '排除角色' : '添加角色';

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
        className="max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded-lg border border-border bg-raised p-4 shadow-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-title text-text">{title}</h2>
          <button type="button" onClick={p.onClose} aria-label="关闭" className={BTN_ICON}>
            ×
          </button>
        </div>
        {error !== '' ? (
          <p className="py-6 text-center text-label text-danger">{error}</p>
        ) : rows === null ? (
          <p className="py-6 text-center text-label text-muted">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-label text-muted">还没有角色,在标签菜单里「设为角色」</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
            {rows.map((row) => {
              const picked = p.selected.includes(row.path);
              return (
                <li key={row.path}>
                  <button
                    type="button"
                    disabled={picked}
                    onClick={() => p.onPick(row.path)}
                    onMouseEnter={hoverTitle(tagLabelPlain(row.path))}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text disabled:cursor-default disabled:text-faint disabled:line-through disabled:hover:bg-transparent disabled:hover:text-faint"
                  >
                    <span className="truncate">{renderTagLabel(row.path)}</span>
                    {picked ? (
                      <span className="shrink-0 text-label text-muted">已添加</span>
                    ) : (
                      <span className="shrink-0 text-label text-muted">{row.name}</span>
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
