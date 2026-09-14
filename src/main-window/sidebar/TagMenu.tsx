/**
 * 标签右键管理菜单(spec 6.1):重命名 / 移动(选新父级,含移到根级)/ 删除。
 * 删除进入面板时先取 tag_impact,显示「将影响 M 条笔记」并二次确认;
 * 重命名与移动成功后回报 pathChange(旧路径 -> 新路径),上层用它级联改写当前筛选条件。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { TagCount } from '../../shared/types';
import { isValidTagPath } from '../../shared/filter-conditions';
import type { ManagedNode } from './tag-tree';

export interface TagMenuProps {
  /** 目标标签(id 必非 null:上层 TagsSection 已拦结构节点,ManagedNode 类型固化这一约束) */
  node: ManagedNode;
  /** 菜单出现坐标(contextmenu 事件的 clientX/clientY,已由上层钳制到视口内) */
  x: number;
  y: number;
  /** 移动候选:全部标签行(含 id),自身与子孙由本组件剔除 */
  tagRows: TagCount[];
  onClose: () => void;
  /** 操作成功:提示文案 + 改名/移动时的路径变化(删除断链不产生) */
  onDone: (message: string, pathChange?: { from: string; to: string }) => void;
}

type Pane = 'main' | 'rename' | 'move' | 'delete';

const ITEM_CLASS =
  'block w-full rounded px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700';
const BTN_GHOST = 'h-7 rounded border border-gray-300 px-2 text-xs text-gray-600 hover:border-blue-500';

/** 右键菜单本体:主面板 + 重命名/移动/删除三个子面板,定位由上层传入 */
export function TagMenu(p: TagMenuProps): ReactNode {
  const [pane, setPane] = useState<Pane>('main');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(p.node.name);
  const [impact, setImpact] = useState<{ tags: number; notes: number } | null>(null);

  // Esc 关闭;点击菜单外关闭(捕获阶段,不冒泡到窗口级)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-tag-menu]')) p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [p]);

  // 进入删除面板时取影响面;失败就地显示,不静默
  useEffect(() => {
    if (pane !== 'delete' || impact !== null) return;
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

  // 移动候选:剔除自身与子孙(路径前缀),按原路径序展示
  const candidates = useMemo(
    () => p.tagRows.filter((r) => r.path !== p.node.path && !r.path.startsWith(p.node.path + '/')),
    [p.tagRows, p.node.path]
  );
  const currentParent = p.node.path.includes('/') ? parentPrefix.slice(0, -1) : '';

  return (
    <div
      data-tag-menu
      role="menu"
      aria-label="标签管理"
      className="fixed z-50 max-h-80 w-56 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg"
      style={{ left: p.x, top: p.y }}
    >
      {pane === 'main' && (
        <>
          <p className="truncate px-2.5 py-1 text-xs font-medium text-gray-500" title={p.node.path}>
            {p.node.path}
          </p>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => { setError(''); setPane('rename'); }}>
            重命名
          </button>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => { setError(''); setPane('move'); }}>
            移动
          </button>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => { setError(''); setImpact(null); setPane('delete'); }}>
            删除
          </button>
        </>
      )}
      {pane === 'rename' && (
        <div className="p-1">
          <p className="mb-1.5 px-1 text-xs text-gray-500">重命名为</p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) doRename();
            }}
            aria-label="新标签名"
            className="h-7 w-full rounded border border-gray-300 px-2 text-xs outline-none focus:border-blue-500"
          />
          {error !== '' && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button type="button" onClick={p.onClose} className={BTN_GHOST}>取消</button>
            <button type="button" onClick={doRename} disabled={busy} className="h-7 rounded bg-blue-600 px-2 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '保存中…' : '确定'}</button>
          </div>
        </div>
      )}
      {pane === 'move' && (
        <div className="p-1">
          <p className="mb-1 px-1 text-xs text-gray-500">移动「{p.node.name}」到</p>
          <button
            type="button"
            onClick={() => doMove(null, p.node.name)}
            className={ITEM_CLASS + (currentParent === '' ? ' bg-blue-50 text-blue-700' : '')}
          >
            (根级){currentParent === '' ? ' - 当前' : ''}
          </button>
          {candidates.map((r) => (
            <button
              key={r.path}
              type="button"
              title={r.path}
              disabled={busy}
              onClick={() => doMove(r.id, r.path + '/' + p.node.name)}
              style={{ paddingLeft: 10 + r.depth * 12 }}
              className={ITEM_CLASS + (r.path === currentParent ? ' bg-blue-50 text-blue-700' : '')}
            >
              {r.path}
              {r.path === currentParent ? ' - 当前' : ''}
            </button>
          ))}
          {error !== '' && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button type="button" onClick={p.onClose} className={BTN_GHOST}>取消</button>
          </div>
        </div>
      )}
      {pane === 'delete' && (
        <div className="p-1">
          <p className="px-1 text-xs text-gray-600">删除「{p.node.path}」?</p>
          <p className="mt-1 px-1 text-xs text-gray-500">
            {impact === null ? '计算影响面…' : `将影响 ${impact.notes} 条笔记` + (impact.tags > 0 ? `、${impact.tags} 个子标签` : '')}
          </p>
          {error !== '' && <p className="mt-1 px-1 text-xs text-red-500">{error}</p>}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button type="button" onClick={p.onClose} className={BTN_GHOST}>取消</button>
            <button type="button" onClick={doDelete} disabled={busy || impact === null} className="h-7 rounded bg-red-600 px-2 text-xs text-white hover:bg-red-700 disabled:opacity-50">{busy ? '删除中…' : '确认删除'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
