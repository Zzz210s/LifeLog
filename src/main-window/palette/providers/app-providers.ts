/**
 * 三个 provider 的注册表装配(自 use-app-palette 抽出以守行数红线):
 * 命令 / 笔记 / 标签的接线只在这里,host 只把数据源、上下文与装饰用的 ref 递进来。
 *
 * 标签侧(复审 I1):取候选走 `TagCandidates` 的版本缓存 —— 同一数据版本内连续输入
 * 不再每键一次全树 `list_tags`。
 * 标签版本用 **getter** 传入(复审 m2):装配出来的注册表因此不随版本换新对象 ——
 * 版本一变就换 registry 会让 `useProviderItems` 的 effect 在任意前缀下都重跑一次。
 * 版本变化只该让 `#` 重取候选,那由 `useProviderItems` 的 `refreshKey` 负责。
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
import { createNoteProvider, NOTES_OPEN_PREFIX } from './notes';
import type { NoteProviderOptions } from './notes';
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
  /** 现读标签数据版本(主窗 loadTags 成功时递增);不放进装配依赖,故注册表身份稳定 */
  getTagsVersion: () => number;
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
        const rows = await o.tagPool.current(o.getTagsVersion());
        o.tagsRef.current = rows;
        return rows;
      },
    }),
  );
  // 笔记 provider 的取数只写一份:`''` 给浮层默认档,`@` 给统一输入框的「打开笔记」
  // (注册表前缀前缀不重复,两个条目共用一个候选池与同一份 noteIndex)
  const noteOptions: NoteProviderOptions = {
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
  };
  registry.register(createNoteProvider(noteOptions));
  registry.register(createNoteProvider({ ...noteOptions, prefix: NOTES_OPEN_PREFIX }));
  return registry;
}
