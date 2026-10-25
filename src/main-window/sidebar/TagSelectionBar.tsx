/**
 * 多选态的浮条(2026-10-25):显示已选条数,提供「删除」与「取消」。
 *
 * 只做**最小的两个动作**:删除(带二次确认,逐条走产品自己的 `delete_tag`)与取消。
 * 移动 / 合并 / 加关系属于下一步(需要目标选择器与影响面预览),这里先不铺开 ——
 * 与批量条目那边(加/去标签、删除、导出)刻意保持不同:标签的批量破坏性更高。
 *
 * 删除逐个而不是一次事务:每个标签的删除都带 `gc_orphans` 与 FTS 触发器,
 * 走同一条命令才能保证树列、子级线、搜索三者一致;55 条以内体感无差。
 */
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { BTN_SECONDARY } from '../shell/button-classes';
import { api } from '../../shared/api';

export interface TagSelectionBarProps {
  count: number;
  /** 选中的路径(按可见顺序) */
  paths: readonly string[];
  /** path -> 点 id(取不到的行跳过并报告) */
  ids: ReadonlyMap<string, number>;
  onClear: () => void;
  /** 删完刷新侧栏(计数/树)与条件栏 */
  onDeleted: () => void;
  /** 顶部回执 */
  onFlash: (message: string, tone?: 'ok' | 'error') => void;
}

export function TagSelectionBar(p: TagSelectionBarProps): ReactNode {
  const remove = async (): Promise<void> => {
    const ok = await confirm(`删除选中的 ${p.count} 个实体?附着的条目会失去该标签(条目本身不删)。`, {
      title: '批量删除实体',
      kind: 'warning',
    });
    if (!ok) return;
    let done = 0;
    const failed: string[] = [];
    for (const path of p.paths) {
      const id = p.ids.get(path);
      if (id === undefined) {
        failed.push(path);
        continue;
      }
      try {
        await api.deleteTag(id);
        done += 1;
      } catch {
        failed.push(path);
      }
    }
    p.onClear();
    p.onFlash(failed.length === 0 ? `已删除 ${done} 个实体` : `已删除 ${done} 个,${failed.length} 个失败`, failed.length === 0 ? 'ok' : 'error');
    p.onDeleted();
  };

  return (
    <div
      data-testid="tag-selection-bar"
      className="mx-1 mb-1 flex items-center gap-2 rounded-sm border border-border-strong bg-raised px-2 py-1"
    >
      <span className="text-label text-muted">已选 {p.count}</span>
      <span className="flex-1" />
      <button type="button" onClick={() => void remove()} disabled={p.count === 0} className={BTN_SECONDARY}>
        删除
      </button>
      <button type="button" onClick={p.onClear} className={BTN_SECONDARY}>
        取消
      </button>
    </div>
  );
}
