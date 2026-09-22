/**
 * 三个 provider 的注册表装配(自 use-app-palette 抽出以守行数红线):
 * 命令 / 笔记 / 标签的接线只在这里,host 只把数据源、上下文与装饰用的 ref 递进来。
 *
 * 标签侧(复审 I1):取候选走 `TagCandidates` 的版本缓存 —— 同一数据版本内连续输入
 * 不再每键一次全树 `list_tags`;版本由主窗 `loadTags` 成功时递增。
 */
import type { RefObject } from 'react';
import { api } from '../../../shared/api';
import type { CommandRegistry } from '../../../shared/commands';
import { createProviderRegistry } from '../../../shared/quickpick/providers';
import type { ProviderRegistry } from '../../../shared/quickpick/providers';
import type { Note, TagCount } from '../../../shared/types';
import type { Context } from '../../../shared/when';
import type { NoteCandidates } from '../note-candidates';
import { searchConditions } from '../note-candidates';
import type { TagCandidates } from '../tag-candidates';
import { createCommandProvider } from './commands';
import { createNoteProvider } from './notes';
import { createTagProvider } from './tags';

export interface AppProvidersOptions {
  /** 已接线的命令注册表(use-app-commands) */
  registry: CommandRegistry;
  /** 现读上下文键(命令 provider 的 when 求值) */
  getContext: () => Context;
  /** 笔记候选池(最近 200 条;每次打开浮层作废) */
  pool: NoteCandidates;
  /** 标签候选池(按数据版本缓存) */
  tagPool: TagCandidates;
  /** 标签数据版本 */
  tagsVersion: number;
  /** 取到过的笔记(笔记装饰按 id 查日期与标签) */
  noteIndex: RefObject<Map<number, Note>>;
  /** 最后一次取到的标签树(标签装饰用) */
  tagsRef: RefObject<readonly TagCount[]>;
}

export function buildAppProviders(o: AppProvidersOptions): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(
    createCommandProvider({ registry: o.registry, getContext: o.getContext }),
  );
  registry.register(
    createTagProvider({
      listTags: async () => {
        const rows = await o.tagPool.current(o.tagsVersion);
        o.tagsRef.current = rows;
        return rows;
      },
    }),
  );
  registry.register(
    createNoteProvider({
      getCandidates: async () => {
        const rows = await o.pool.current();
        for (const note of rows) o.noteIndex.current.set(note.id, note);
        return rows;
      },
      search: async (query) => {
        const rows = await api.queryNotes(searchConditions(query), 0);
        for (const note of rows) o.noteIndex.current.set(note.id, note);
        return rows;
      },
    }),
  );
  return registry;
}
