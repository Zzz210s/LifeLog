/**
 * 标签菜单「角色…」面板(标签角色 spec §5):列出全部已登记角色,勾选 = 该标签能被这个角色认领。
 * 自包含容器(与「携带…」同构):状态与 IPC 都在本文件,TagMenu 只需一行挂载。
 * 每次点击即整体替换(tag_roles 是集合语义,后端 set_tag_roles 也是整体替换),失败给中文错误且不改变回显。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { RoleRef } from '../../shared/types';
import { BTN_GHOST, ITEM_CLASS } from './tag-menu-ui';

export interface TagMenuRolePaneProps {
  /** 被认领的标签(本标签)id 与完整路径 */
  tagId: number;
  path: string;
  /** 全部已登记角色(空表 = 还没有角色) */
  roles: readonly RoleRef[];
  onCancel: () => void;
}

export function TagMenuRolePane(p: TagMenuRolePaneProps): ReactNode {
  /** 当前认领的角色标签 id 集合;null = 首帧读数未回来 */
  const [claimed, setClaimed] = useState<Set<number> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listTagRoles(p.tagId)
      .then((rs) => {
        if (alive) setClaimed(new Set(rs.map((r) => r.tagId)));
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [p.tagId]);

  /** 勾选态变化:整体替换该标签的认领集合(按角色表顺序发出,读数稳定) */
  const toggle = (roleTagId: number): void => {
    if (claimed === null || busy) return;
    const next = new Set(claimed);
    if (next.has(roleTagId)) next.delete(roleTagId);
    else next.add(roleTagId);
    const ids = p.roles.filter((r) => next.has(r.tagId)).map((r) => r.tagId);
    setError('');
    setBusy(true);
    void api
      .setTagRoles(p.tagId, ids)
      .then(() => setClaimed(new Set(ids)))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="p-1">
      <p className="truncate px-1 py-0.5 text-label font-medium text-muted" onMouseEnter={hoverTitle(tagLabelPlain(p.path))}>
        角色:{renderTagLabel(p.path)}
      </p>
      {claimed === null && error === '' && <p className="px-1 py-1 text-label text-muted">加载中…</p>}
      {claimed !== null && p.roles.length === 0 && (
        <p className="px-1 py-1 text-label text-muted">还没有角色,先给标签「设为角色」</p>
      )}
      {claimed !== null &&
        p.roles.map((r) => (
          <button
            key={r.tagId}
            type="button"
            role="menuitemcheckbox"
            aria-checked={claimed.has(r.tagId)}
            disabled={busy}
            onClick={() => toggle(r.tagId)}
            className={ITEM_CLASS + ' flex items-center gap-1.5'}
          >
            <span
              className={
                'w-10 shrink-0 text-label ' + (claimed.has(r.tagId) ? 'text-accent-text' : 'text-muted')
              }
            >
              {claimed.has(r.tagId) ? '已认领' : '未认领'}
            </span>
            <span className="min-w-0 flex-1 truncate" onMouseEnter={hoverTitle(tagLabelPlain(r.path))}>
              {renderTagLabel(r.name)}
            </span>
          </button>
        ))}
      <p className="mt-1 px-1 text-label text-muted">勾选 = 这个标签能当该角色用;携带的目标只能是已登记的角色标签</p>
      {error !== '' && <p className="mt-1 px-1 text-label text-danger">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
      </div>
    </div>
  );
}
