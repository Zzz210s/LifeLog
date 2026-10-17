/**
 * 批量三个写动作的编排(spec 2026-10-17 §4.1-§4.3/§6):与 React 状态解耦 —— 只吃 id 列表与三个出口
 * (回执 / 刷新 / 清选中),便于单测,也免得选择态那支 hook 顶到 200 行。
 *
 * 共同口径:写后必须 `notifyTagsChanged()`(侧栏计数 / 关系小字的唯一刷新出口,项目规则 #1518),
 * 再刷新信息流(`refresh()`)—— 加 / 去标签可能让条目不再满足当前标签筛选,本地判不了复合条件。
 */
import { confirm } from '@tauri-apps/plugin-dialog';
import { api } from '../../shared/api';
import { notifyTagsChanged } from '../data/tags-changed';
import { BATCH_DELETE_WARN, addTagNotice, removeTagNotice } from './batch-mode';

export interface WriteIO {
  notify: (text: string) => void;
  /** 回第一页重查(调用方是 fire-and-forget 的 void 函数) */
  refresh: () => unknown;
  /** 删除成功后把已删 id 移出选中集(否则「已选 N」虚高) */
  dropIds: (ids: number[]) => void;
}

/** 加标签(幂等):`added = 0` 说明没什么可改的,此时不刷新(库里确实没变) */
export async function writeAddTag(
  ids: number[],
  target: number,
  label: string,
  io: WriteIO
): Promise<void> {
  try {
    const r = await api.tagPoints(ids, target);
    io.notify(addTagNotice(r.added, r.existed, label));
    if (r.added === 0) return;
    notifyTagsChanged();
    await io.refresh();
  } catch (e) {
    io.notify(String(e));
  }
}

/** 去标签:只删无名字线;名线被保留时回执里交代(否则用户以为关系也没了) */
export async function writeRemoveTag(
  ids: number[],
  target: number,
  label: string,
  io: WriteIO
): Promise<void> {
  try {
    const r = await api.untagPoints(ids, target);
    io.notify(removeTagNotice(r.removed, r.keptNamed, label));
    if (r.removed === 0) return;
    notifyTagsChanged();
    await io.refresh();
  } catch (e) {
    io.notify(String(e));
  }
}

/** 删除:二次确认 -> 后端写前快照 + 单事务删;取消确认则什么都不做 */
export async function writeDelete(ids: number[], io: WriteIO): Promise<void> {
  const extra =
    ids.length >= BATCH_DELETE_WARN ? '\n这次将删除 200 条以上，请确认已看过快照。' : '';
  try {
    const ok = await confirm(
      `删除选中的 ${ids.length} 条条目？删除前会自动生成一份数据库快照。${extra}`,
      { title: '批量删除', kind: 'warning' }
    );
    if (!ok) return;
    const r = await api.deletePoints(ids);
    io.dropIds(ids);
    io.notify(`已删除 ${r.deleted} 条；快照：${r.snapshot}`);
    notifyTagsChanged();
    await io.refresh();
  } catch (e) {
    io.notify('删除失败：' + String(e));
  }
}
