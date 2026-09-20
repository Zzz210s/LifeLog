import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TagCount } from '../../shared/types';
import { mergeImpactText } from './tag-menu-pure';
import { BTN_GHOST, ITEM_CLASS } from './tag-menu-ui';

export interface TagMenuMergePaneProps {
  /** 源标签完整路径 */
  path: string;
  /** 合并候选目标(上层已剔除自身与子孙),按原路径序展示 */
  candidates: TagCount[];
  /** 源标签有子节点:显示提示并禁用确认(子节点如何映射到目标没有唯一正解) */
  hasChildren: boolean;
  /** 源标签影响面读数;null = 还在计算(确认按钮禁用) */
  impact: { tags: number; notes: number } | null;
  /** 就地错误(空串表示无) */
  error: string;
  /** 请求进行中 */
  busy: boolean;
  onCancel: () => void;
  /** 确认合并:target 为选中的候选行(id 寻址 + path 用于级联改写筛选条件) */
  onConfirm: (target: TagCount, keepAlias: boolean) => void;
}

const BTN_PRIMARY =
  'h-7 rounded bg-accent px-2 text-xs text-on-accent hover:bg-accent-hover disabled:opacity-50';

/**
 * 合并面板(G3 spec §5.1):选目标标签(缩进与高亮风格同移动面板)+「保留旧名作为别名」(
 * 默认勾选)+ 影响面文案 + 取消/确认。目标未选或影响面未回前不能确认。
 */
export function TagMenuMergePane(p: TagMenuMergePaneProps): ReactNode {
  const [target, setTarget] = useState<TagCount | null>(null);
  const [keepAlias, setKeepAlias] = useState(true);
  const blocked = p.hasChildren || target === null || p.impact === null;

  return (
    <div className="p-1">
      <p className="mb-1 truncate px-1 text-xs text-faint" title={p.path}>
        {p.hasChildren ? '合并『' + p.path + '』' : '合并『' + p.path + '』到'}
      </p>
      {p.hasChildren ? (
        <p className="px-1 py-1 text-xs text-warn">该标签还有子标签,请先移走或合并子标签</p>
      ) : (
        p.candidates.map((r) => (
          <button
            key={r.path}
            type="button"
            title={r.path}
            disabled={p.busy}
            onClick={() => setTarget(r)}
            style={{ paddingLeft: 10 + r.depth * 12 }}
            className={ITEM_CLASS + (r.path === target?.path ? ' bg-accent-soft text-accent-text' : '')}
          >
            {r.path}
            {r.path === target?.path ? ' - 已选' : ''}
          </button>
        ))
      )}
      <p className="mt-1 px-1 text-xs text-faint">
        {p.impact === null ? '计算影响面…' : mergeImpactText(p.impact.notes)}
      </p>
      {!p.hasChildren && (
        <p className="mt-1 px-1 text-xs text-faint">合并后这些笔记改挂到目标标签,源标签会被删除</p>
      )}
      <label className="mt-1 flex items-center gap-1.5 px-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={keepAlias}
          disabled={p.busy}
          onChange={(e) => setKeepAlias(e.target.checked)}
        />
        保留旧名作为别名
      </label>
      {p.error !== '' && <p className="mt-1 px-1 text-xs text-danger">{p.error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
        <button
          type="button"
          onClick={() => target && p.onConfirm(target, keepAlias)}
          disabled={p.busy || blocked}
          className={BTN_PRIMARY}
        >
          {p.busy ? '合并中…' : '确认合并'}
        </button>
      </div>
    </div>
  );
}
