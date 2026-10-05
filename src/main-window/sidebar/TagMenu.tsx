/**
 * 标签右键管理菜单(spec 6.1 / G3 §5.1):重命名 / 移动(选新父级,含移到根级)/ 别名 / 合并 / 删除。
 * 删除与合并进入面板时先取 tag_impact 显示影响面(合并面板的文案据此表述);
 * 重命名/移动/合并成功后回报 pathChange(旧路径 -> 新路径)让上层级联改写当前筛选条件。
 * 本文件只保留状态、异步动作与容器;五个子面板各自成文件(行数上限)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { TagMruSource } from '../../shared/tag-mru';
import type { TagCount, TagImpact } from '../../shared/types';
import { TagMenuAliasPane } from './TagMenuAliasPane';
import { TagMenuCarryPane } from './TagMenuCarryPane';
import { TagMenuDeletePane } from './TagMenuDeletePane';
import { TagMenuMainPane } from './TagMenuMainPane';
import { TagMenuMergePane } from './TagMenuMergePane';
import { TagMenuMovePane } from './TagMenuMovePane';
import { TagMenuRenamePane } from './TagMenuRenamePane';
import { TagMenuRolePane } from './TagMenuRolePane';
import { useDismiss } from '../shell/use-dismiss';
import { mergeCandidates } from './tag-menu-pure';
import { tagMenuOps } from './tag-menu-ops';
import type { Pane } from './tag-menu-ui';
import type { ManagedNode } from './tag-tree';
import { useRoles } from './use-roles';
import { useTagMenuAliases } from './use-tag-menu-aliases';

export interface TagMenuProps {
  /** 目标标签(id 必非 null:上层 TagsSection 已拦结构节点,ManagedNode 类型固化这一约束) */
  node: ManagedNode;
  /** 菜单出现坐标(contextmenu 事件的 clientX/clientY,已由上层钳制到视口内) */
  x: number;
  y: number;
  /** 移动/合并候选:全部标签行(含 id),自身与子孙由本组件用 mergeCandidates 剔除 */
  tagRows: TagCount[];
  /** 固定标签 + 标签 MRU(「携带…」候选的三档排序);无固定项/无最近用过传 null */
  tagMru: TagMruSource | null;
  onClose: () => void;
  /** 操作成功:提示文案 + 改名/移动/合并时的路径变化(删除断链、别名变更不产生) */
  onDone: (message: string, pathChange?: { from: string; to: string }) => void;
}

/** 右键菜单本体:主面板 + 重命名/移动/别名/合并/删除五个子面板,定位由上层传入 */
export function TagMenu(p: TagMenuProps): ReactNode {
  const [pane, setPane] = useState<Pane>('main');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(p.node.name);
  const [impact, setImpact] = useState<TagImpact | null>(null);

  // Esc 关闭 / 点击菜单外关闭:统一走 shell/use-dismiss(与 AddConditionMenu、TopBarMenu 同一实现)。
  // 菜单本体只在打开时挂载,故 open 恒 true(useDismiss 的 ref 现读保证回调不闭包旧 props)。
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(true, menuRef, p.onClose);

  // 进入删除/合并面板时取影响面;失败就地显示,不静默
  useEffect(() => {
    if ((pane !== 'delete' && pane !== 'merge') || impact !== null) return;
    void api
      .tagImpact(p.node.id)
      .then(setImpact)
      .catch((e) => setError(String(e)));
  }, [pane, p.node.id, impact]);

  const parentPrefix = p.node.path.slice(0, p.node.path.length - p.node.name.length);
  /** 失败兑现:就地显示后端中文错误并解除 busy(不动菜单状态) */
  const fail = (e: unknown): void => {
    setError(String(e));
    setBusy(false);
  };
  const ops = tagMenuOps({ node: p.node, newName, fail, setBusy, onError: setError, onClose: p.onClose, onDone: p.onDone });
  const alias = useTagMenuAliases(p.node.id, pane === 'alias', fail, setBusy);
  // 已登记角色:决定「设为角色 / 取消角色」,也是「角色…」列表与「携带…」候选的来源
  const roles = useRoles(true) ?? [];
  const isRole = roles.some((r) => r.tagId === p.node.id);
  /** 切换面板:进入前清掉就地错误;删除/合并面板重新取影响面,别名面板重置列表 */
  const pickPane = (next: Pane): void => {
    setError('');
    if (next === 'delete' || next === 'merge') setImpact(null);
    if (next === 'alias') alias.reset();
    setPane(next);
  };

  // 移动/合并候选:剔除自身与子孙(路径前缀),按原路径序展示
  const candidates = useMemo(() => mergeCandidates(p.tagRows, p.node), [p.tagRows, p.node]);
  const currentParent = p.node.path.includes('/') ? parentPrefix.slice(0, -1) : '';

  return (
    <div
      ref={menuRef}
      data-tag-menu
      role="menu"
      aria-label="标签管理"
      className="fixed z-50 max-h-80 w-56 overflow-y-auto rounded-lg border border-border bg-raised p-1 shadow-lg"
      style={{ left: p.x, top: p.y }}
    >
      {pane === 'main' && (
        <TagMenuMainPane
          path={p.node.path}
          isRole={isRole}
          onPick={pickPane}
          onMakeRole={() => ops.makeRole(isRole)}
        />
      )}
      {pane === 'rename' && (
        <TagMenuRenamePane
          newName={newName}
          onNameChange={(v) => {
            setNewName(v);
            setError('');
          }}
          error={error}
          busy={busy}
          onCancel={p.onClose}
          onSubmit={ops.rename}
        />
      )}
      {pane === 'move' && (
        <TagMenuMovePane
          nodeName={p.node.name}
          candidates={candidates}
          currentParent={currentParent}
          busy={busy}
          error={error}
          onCancel={p.onClose}
          onMove={ops.move}
        />
      )}
      {pane === 'delete' && (
        <TagMenuDeletePane
          path={p.node.path}
          impact={impact}
          error={error}
          busy={busy}
          onCancel={p.onClose}
          onConfirm={ops.remove}
        />
      )}
      {pane === 'alias' && (
        <TagMenuAliasPane
          path={p.node.path}
          aliases={alias.aliases}
          value={alias.input}
          onValueChange={(v) => {
            alias.setInput(v);
            setError('');
          }}
          error={error}
          busy={busy}
          onAdd={() => {
            setError('');
            alias.add();
          }}
          onRemove={alias.remove}
          onCancel={p.onClose}
        />
      )}
      {pane === 'merge' && (
        <TagMenuMergePane
          path={p.node.path}
          candidates={candidates}
          hasChildren={p.node.children.length > 0}
          impact={impact}
          error={error}
          busy={busy}
          onCancel={p.onClose}
          onConfirm={ops.merge}
        />
      )}
      {pane === 'carry' && (
        <TagMenuCarryPane
          tagId={p.node.id}
          path={p.node.path}
          rows={p.tagRows}
          roles={roles}
          pinned={p.tagMru?.pinnedTags}
          mru={p.tagMru?.mruTags.entries()}
          onCancel={p.onClose}
        />
      )}
      {pane === 'role' && (
        <TagMenuRolePane tagId={p.node.id} path={p.node.path} roles={roles} onCancel={p.onClose} />
      )}
    </div>
  );
}
