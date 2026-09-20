import type { ReactNode } from 'react';
import { BTN_GHOST } from './tag-menu-ui';

export interface TagMenuAliasPaneProps {
  /** 目标标签完整路径 */
  path: string;
  /** 别名列表(null = 还在加载) */
  aliases: string[] | null;
  /** 新别名输入框的值(受控) */
  value: string;
  onValueChange: (v: string) => void;
  /** 就地错误(空串表示无) */
  error: string;
  /** 请求进行中:禁用添加/删除 */
  busy: boolean;
  onAdd: () => void;
  onRemove: (alias: string) => void;
  onCancel: () => void;
}

const BTN_PRIMARY =
  'h-7 rounded bg-accent px-2 text-xs text-on-accent hover:bg-accent-hover disabled:opacity-50';

/**
 * 别名面板(G3 spec §5.1):列出该标签的别名(可逐行删)+ 输入框添加新别名。
 * 校验在 TagMenu(纯助手 validateAliasInput)与仓库层各做一次,这里只负责渲染与就地错误。
 */
export function TagMenuAliasPane(p: TagMenuAliasPaneProps): ReactNode {
  return (
    <div className="p-1">
      <p className="truncate px-1 py-0.5 text-xs font-medium text-faint" title={p.path}>
        别名:{p.path}
      </p>
      {p.aliases === null && <p className="px-1 py-1 text-xs text-faint">加载中…</p>}
      {p.aliases !== null && p.aliases.length === 0 && (
        <p className="px-1 py-1 text-xs text-faint">还没有别名</p>
      )}
      {p.aliases !== null &&
        p.aliases.map((a) => (
          <div key={a} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate px-1 py-1 text-xs text-muted" title={a}>
              {a}
            </span>
            <button
              type="button"
              disabled={p.busy}
              title={'删除别名 ' + a}
              onClick={() => p.onRemove(a)}
              className="h-6 shrink-0 rounded px-1 text-xs text-faint hover:bg-hover hover:text-danger disabled:opacity-50"
            >
              删除
            </button>
          </div>
        ))}
      <div className="mt-1 flex gap-1">
        <input
          value={p.value}
          onChange={(e) => p.onValueChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter 直接添加;Esc 交给菜单级的关闭逻辑(不拦)
            if (e.key === 'Enter') {
              e.preventDefault();
              p.onAdd();
            }
          }}
          placeholder="新别名"
          aria-label="新别名"
          className="h-7 min-w-0 flex-1 rounded border border-border bg-raised px-1.5 text-xs text-text outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={p.busy || p.value === ''}
          onClick={p.onAdd}
          className={BTN_PRIMARY}
        >
          添加
        </button>
      </div>
      <p className="mt-1 px-1 text-xs text-faint">
        写 <span className="font-mono">#别名</span> 会自动归一到本标签
      </p>
      {p.error !== '' && <p className="mt-1 px-1 text-xs text-danger">{p.error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={p.onCancel} className={BTN_GHOST}>
          取消
        </button>
      </div>
    </div>
  );
}
