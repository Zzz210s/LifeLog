/**
 * 笔记写库的唯一出口(T6 修复轮 I2 的门禁):所有会新建/改写/删除笔记与标签关系的命令都在这里
 * 调,成功后统一 notifyTagsChanged() —— 浮层 `#` 候选与侧栏标签树据此作废。
 *
 * 为什么必须收口:卸载兜底保存没有任何 reload 回调通道,绕过出口就是"库里已有新标签、浮层 `#`
 * 搜不到、关开浮层也不自愈"的陈旧窗口(复审 I2)。tags-freshness.gate.test.ts 静态扫描全仓,
 * 禁止本文件之外的非测试代码直接调 api.updateNote / api.deleteNote。
 */
import { api } from '../../shared/api';
import type { Note } from '../../shared/types';
import { notifyTagsChanged } from './tags-changed';

/** 更新笔记(标签整集合替换语义与 api.updateNote 一致):成功后通知标签新鲜度 */
export async function updateNote(id: number, text: string): Promise<Note | null> {
  const updated = await api.updateNote(id, text);
  notifyTagsChanged();
  return updated;
}

/** 删除笔记:成功后通知(标签计数与孤儿标签都可能变) */
export async function deleteNote(id: number): Promise<void> {
  await api.deleteNote(id);
  notifyTagsChanged();
}
