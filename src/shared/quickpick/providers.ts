/**
 * QuickPick provider 注册表(D8,设计 §4.1):前缀 → provider,按前缀长度降序匹配。
 *
 * - 空前缀 = 默认 provider(输入为空,或没命中任何前缀时兜底)。
 * - 前缀在匹配时**剥掉**,不参与打分:输入 `>abc` 交给命令 provider 的是 `abc`。
 * - 生产在启动时注册一次,不做动态注册;getItems 的异步/取消由调用方负责(设计 §4.2 纪律 4)。
 */
import type { QuickPickItem } from './model';

export interface QuickPickProvider {
  /** 空前缀表示默认 provider(全局只能有一个) */
  readonly prefix: string;
  readonly id: string;
  /** 候选来自数据层(T6/T8 接线);query 已剥掉前缀 */
  getItems(query: string): readonly QuickPickItem[] | Promise<readonly QuickPickItem[]>;
}

export interface ProviderMatch {
  readonly provider: QuickPickProvider;
  /** 剥掉前缀后的查询 */
  readonly query: string;
}

export interface ProviderRegistry {
  register(provider: QuickPickProvider): void;
  /** 前缀长度降序里第一个命中的;都没有则用默认 provider;没有默认则 undefined(不硬猜) */
  resolve(input: string): ProviderMatch | undefined;
  /** 前缀长度降序(同长度保持注册顺序);返回**副本**,改返回值动不了注册表 */
  providers(): readonly QuickPickProvider[];
  /** 清空注册表(仅供测试隔离;生产启动时注册一次) */
  clear(): void;
}

export function createProviderRegistry(): ProviderRegistry {
  const list: QuickPickProvider[] = [];

  return {
    register(provider: QuickPickProvider): void {
      const prefix = provider.prefix ?? '';
      const id = (provider.id ?? '').trim();
      if (id === '') throw new Error('provider id 不能为空');
      if (list.some((item) => item.id === id)) throw new Error(`provider id 重复:${id}`);
      if (list.some((item) => item.prefix === prefix)) throw new Error(`provider 前缀重复:${prefix || '(默认)'}`);
      list.push(Object.freeze({ prefix, id, getItems: provider.getItems }));
      list.sort((a, b) => b.prefix.length - a.prefix.length);
    },

    resolve(input: string): ProviderMatch | undefined {
      for (const provider of list) {
        if (provider.prefix !== '' && input.startsWith(provider.prefix)) {
          return { provider, query: input.slice(provider.prefix.length) };
        }
      }
      const fallback = list.find((provider) => provider.prefix === '');
      return fallback ? { provider: fallback, query: input } : undefined;
    },

    providers: () => [...list],

    clear(): void {
      list.length = 0;
    },
  };
}

const REGISTRY = createProviderRegistry();

export function registerProvider(provider: QuickPickProvider): void {
  REGISTRY.register(provider);
}

export function resolveProvider(input: string): ProviderMatch | undefined {
  return REGISTRY.resolve(input);
}

export function registeredProviders(): readonly QuickPickProvider[] {
  return REGISTRY.providers();
}

/** 仅供测试重置全局注册表 */
export function resetProviders(): void {
  REGISTRY.clear();
}
