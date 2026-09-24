/**
 * 标签右键管理菜单(spec 6.1 / G3 §5.1):重命名 / 移动(选新父级,含移到根级)/ 别名 / 合并 / 删除。
 * 删除与合并进入面板时先取 tag_impact 显示影响面(合并面板的文案据此表述);
 * 重命名/移动/合并成功后回报 pathChange(旧路径 -> 新路径)让上层级联改写当前筛选条件。
 * 本文件只保留状态、异步动作与容器;五个子面板各自成文件(行数上限)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { isValidTagPath } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagMenuAliasPane } from './TagMenuAliasPane';
import { TagMenuDeletePane } from './TagMenuDeletePane';
import { TagMenuMainPane } from './TagMenuMainPane';
import { TagMenuMergePane } from './TagMenuMergePane';
import { TagMenuMovePane } from './TagMenuMovePane';
import { TagMenuRenamePane } from './TagMenuRenamePane';
import { useDismiss } from '../shell/use-dismiss';
import { mergeCandidates } from './tag-menu-pure';
import type { Pane } from './tag-menu-ui';
import type { ManagedNode } from './tag-tree';
import { useTagMenuAliases } from './use-tag-menu-aliases';

export interface TagMenuProps {
  /** 目标标签(id 必非 null:上层 TagsSection 已拦结构节点,ManagedNode 类型固化这一约束) */
  node: ManagedNode;
  /** 菜单出现坐标(contextmenu 事件的 clientX/clientY,已由上层钳制到视口内) */
  x: number;
  y: number;
  /** 移动/合并候选:全部标签行(含 id),自身与子孙由本组件用 mergeCandidates 剔除 */
  tagRows: TagCount[];
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
  const [impact, setImpact] = useState<{ tags: number; notes: number } | null>(null);

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
  const newPathOf = (name: string): string => parentPrefix + name;
  /** 失败兑现:就地显示后端中文错误并解除 busy(不动菜单状态) */
  const fail = (e: unknown): void => {
    setError(String(e));
    setBusy(false);
  };
  const alias = useTagMenuAliases(p.node.id, pane === 'alias', fail, setBusy);
  /** 切换面板:进入前清掉就地错误;删除/合并面板重新取影响面,别名面板重置列表 */
  const pickPane = (next: Pane): void => {
    setError('');
    if (next === 'delete' || next === 'merge') setImpact(null);
    if (next === 'alias') alias.reset();
    setPane(next);
  };

  const doRename = (): void => {
    const t = newName.trim();
    if (t === '') return setError('标签名不能为空');
    if (t.includes('/') || !isValidTagPath(t)) return setError('标签名不合法(仅限文字、数字、_ - 等)');
    if (t === p.node.name) return p.onClose();
    setBusy(true);
    void api
      .renameTag(p.node.id, t)
      .then(() => p.onDone('已重命名标签', { from: p.node.path, to: newPathOf(t) }))
      .catch(fail);
  };

  const doMove = (parentId: number | null, to: string): void => {
    setBusy(true);
    void api
      .moveTag(p.node.id, parentId)
      .then(() => p.onDone('已移动标签', { from: p.node.path, to }))
      .catch(fail);
  };

  const doDelete = (): void => {
    setBusy(true);
    void api
      .deleteTag(p.node.id)
      .then(() => p.onDone('已删除标签'))
      .catch(fail);
  };

  /** 合并:成功后回报 源路径 -> 目标路径,让上层级联改写筛选条件(源标签已被删除) */
  const doMerge = (target: TagCount, keepAlias: boolean): void => {
    setBusy(true);
    void api
      .mergeTags(p.node.id, target.id, keepAlias)
      .then(() => p.onDone('已合并标签', { from: p.node.path, to: target.path }))
      .catch(fail);
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
      {pane === 'main' && <TagMenuMainPane path={p.node.path} onPick={pickPane} />}
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
          onSubmit={doRename}
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
          onMove={doMove}
        />
      )}
      {pane === 'delete' && (
        <TagMenuDeletePane
          path={p.node.path}
          impact={impact}
          error={error}
          busy={busy}
          onCancel={p.onClose}
          onConfirm={doDelete}
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
          onConfirm={doMerge}
        />
      )}
    </div>
  );
}
