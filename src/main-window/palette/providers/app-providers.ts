/**
 * provider 注册表装配(计划 T3.2):命令 provider + **一个实体 provider**。
 *
 * 原「笔记池 / 标签池」两个 provider 已合并:同一个 `entityItems` 模块注册三次 ——
 * 默认档(`''`)与 `@`(打开)取全部实体,`#`(引用)收窄到树内实体。
 *
 * 标签侧取候选走 `EntityCandidates` 的版本缓存:同一数据版本内连续输入不再每键一次全量
 * `complete_notes` + `list_tags`。版本用 **getter** 传入:装配出来的注册表因此不随版本换新对象
 * —— 版本一变就换 registry 会让 `useProviderItems` 的 effect 在任意前缀下都重跑一次。
 * 版本变化只该让实体前缀重取候选,那由 `useProviderItems` 的 `refreshKey` 负责。
 */
import type { RefObject } from 'react';
import type { CommandRegistry } from '../../../shared/commands';
import { createProviderRegistry } from '../../../shared/quickpick/providers';
import type { ProviderRegistry } from '../../../shared/quickpick/providers';
import type { TagCount } from '../../../shared/types';
import type { Context } from '../../../shared/when';
import type { EntityCandidates } from '../entity-candidates';
import { createCommandProvider } from './commands';
import {
  createEntityProvider,
  ENTITIES_OPEN_PREFIX,
  ENTITIES_OPEN_PROVIDER_ID,
  ENTITIES_PREFIX,
  ENTITIES_PROVIDER_ID,
  ENTITIES_TREE_PREFIX,
  ENTITIES_TREE_PROVIDER_ID,
} from './entities';

export interface AppProvidersOptions {
  /** 已接线的命令注册表(use-app-commands) */
  registry: CommandRegistry;
  /** 现读上下文键(命令 provider 的 when 求值) */
  getContext: () => Context;
  /** 实体候选池(`#` / `@` / 默认档共用的唯一池;按数据版本缓存) */
  entityPool: EntityCandidates;
  /** 现读实体数据版本(主窗 loadTags 成功时递增);不放进装配依赖,故注册表身份稳定 */
  getVersion: () => number;
  /** 最后一次取到的树内实体(标签装饰用;由实体池取数时顺带填充) */
  tagsRef: RefObject<readonly TagCount[]>;
}

export function buildAppProviders(o: AppProvidersOptions): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(
    createCommandProvider({ registry: o.registry, getContext: o.getContext }),
  );
  const getPool = () => o.entityPool.current(o.getVersion());
  // 默认档与 `@` 是同一份全部实体;`#` 收窄到树内实体(引用入口)
  registry.register(
    createEntityProvider({
      getPool,
      inTreeOnly: false,
      prefix: ENTITIES_PREFIX,
      id: ENTITIES_PROVIDER_ID,
    }),
  );
  registry.register(
    createEntityProvider({
      getPool,
      inTreeOnly: false,
      prefix: ENTITIES_OPEN_PREFIX,
      id: ENTITIES_OPEN_PROVIDER_ID,
    }),
  );
  registry.register(
    createEntityProvider({
      getPool,
      inTreeOnly: true,
      prefix: ENTITIES_TREE_PREFIX,
      id: ENTITIES_TREE_PROVIDER_ID,
    }),
  );
  return registry;
}
