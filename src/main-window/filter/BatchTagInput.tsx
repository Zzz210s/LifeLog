/**
 * 批量浮条上的标签输入(spec 2026-10-17 §4.1/§4.2):输入框 + `#` 补全池 + 加 / 去两个按钮。
 *
 * 补全**复用统一输入框的同一引擎**:候选池走 `shared/entity-pool` 的两条既有 IPC 合并,
 * 收窄与打分走 `palette/providers/entities` 的 `entityItems`(与 `#` 前缀档完全同一份实现),
 * 这里只把选中行的路径映射回实体 id —— 不另造一套匹配。
 * 目标**不隐式创建**:输入没命中任何已有标签就报「标签不存在」,不发 IPC。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { mergeEntityPool } from '../../shared/entity-pool';
import type { EntityCandidate } from '../../shared/entity-pool';
import { entityItems } from '../palette/providers/entities';
import { BTN_SECONDARY } from '../shell/button-classes';
import { useDismiss } from '../shell/use-dismiss';

export interface BatchTagInputProps {
  /** 0 选或在途时禁用(按钮与输入框同一条闸门) */
  disabled: boolean;
  /** 标签数据版本:变了才重打候选池 */
  dataVersion: number;
  add: (target: number, label: string) => void;
  remove: (target: number, label: string) => void;
}

export function BatchTagInput(p: BatchTagInputProps): ReactNode {
  const [raw, setRaw] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<readonly EntityCandidate[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => setOpen(false));

  // 候选池与统一输入框同源(complete_notes 显示首行 + list_tags 树内路径),按数据版本重取
  useEffect(() => {
    let stale = false;
    void Promise.all([api.completeNotes(), api.listTags()])
      .then(([titles, tree]) => {
        if (!stale) setPool(mergeEntityPool(titles, tree));
      })
      .catch(() => {
        if (!stale) setPool([]);
      });
    return () => {
      stale = true;
    };
  }, [p.dataVersion]);

  const items = useMemo(() => entityItems(pool, raw, true), [pool, raw]);

  /** 输入原文 -> 树内实体:只认**完整路径**精确命中的已有标签(不隐式建点) */
  const resolve = (): { id: number; path: string } | null => {
    const text = raw.trim();
    const hit = pool.find((c) => c.path !== null && c.path === text);
    return hit === undefined ? null : { id: hit.id, path: hit.path as string };
  };

  const act = (kind: 'add' | 'remove') => {
    const hit = resolve();
    if (hit === null) {
      setError(`标签不存在：${raw.trim() === '' ? '(空)' : raw.trim()}`);
      return;
    }
    setError(null);
    setOpen(false);
    setRaw('');
    if (kind === 'add') p.add(hit.id, hit.path);
    else p.remove(hit.id, hit.path);
  };

  return (
    <div ref={root} className="flex shrink-0 items-center gap-1">
      <div className="relative">
        <input
          value={raw}
          disabled={p.disabled}
          placeholder="#标签"
          aria-label="批量标签"
          data-testid="batch-tag-input"
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') act('add');
          }}
          className="h-8 w-32 rounded-sm border border-border-strong bg-app px-2 text-ui text-text outline-none placeholder:text-faint disabled:opacity-50"
        />
        {open && items.length > 0 && (
          <ul
            role="listbox"
            data-testid="batch-tag-candidates"
            className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-border bg-raised py-1 shadow-lg"
          >
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  data-testid="batch-tag-candidate"
                  onClick={() => {
                    setRaw(it.id);
                    setOpen(false);
                    setError(null);
                  }}
                  className="flex h-7 w-full items-center px-2 text-left text-ui text-text hover:bg-hover"
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        data-testid="batch-tag-add"
        disabled={p.disabled}
        className={BTN_SECONDARY}
        onClick={() => act('add')}
      >
        加标签
      </button>
      <button
        type="button"
        data-testid="batch-tag-remove"
        disabled={p.disabled}
        className={BTN_SECONDARY}
        onClick={() => act('remove')}
      >
        去标签
      </button>
      {error !== null && (
        <span data-testid="batch-tag-error" className="text-label text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
