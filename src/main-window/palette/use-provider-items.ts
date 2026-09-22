/**
 * 浮层候选的取回(设计 §4.2 纪律 4:异步候选必须可取消,旧回包直接丢)。
 *
 * 纯函数 `loadProviderItems` 负责"解析 provider + 取候选 + 判定是否过期";
 * `useProviderItems` 只把序号守卫接到 React 上(prefix/query 一变就作废旧请求)。
 * 前缀与 query 分开放:输入框里的 `>` / `#` 由 use-palette 剥掉后进 query,
 * 这里用 `prefix + query` 还原成注册表的输入形态再解析(前缀长度降序匹配)。
 */
import { useEffect, useRef, useState } from 'react';
import type { QuickPickItem } from '../../shared/quickpick/model';
import type { ProviderRegistry } from '../../shared/quickpick/providers';

/**
 * 解析 provider 并取候选;`isStale()` 为真表示期间又发起了新请求 -> 返回 null(旧回包丢弃)。
 * 没有 provider(注册表为空)时给空列表,不硬猜。
 */
export async function loadProviderItems(
  registry: ProviderRegistry,
  input: string,
  isStale: () => boolean,
): Promise<readonly QuickPickItem[] | null> {
  const match = registry.resolve(input);
  if (match === undefined) return [];
  const items = await match.provider.getItems(match.query);
  return isStale() ? null : items;
}

export interface ProviderItemsOptions {
  registry: ProviderRegistry;
  isOpen: boolean;
  prefix: string;
  query: string;
  /**
   * 候选数据源的作废键(复审 m2):变化即重跑一次取候选。标签 provider 传数据版本;
   * 命令/笔记 provider 与标签无关,传常量(不随版本重跑)。
   */
  refreshKey?: number;
  /** 取回失败(IPC/后端错误):中文原因交主窗错误条 */
  onError: (message: string) => void;
}

export function useProviderItems(options: ProviderItemsOptions): readonly QuickPickItem[] {
  const { registry, isOpen, prefix, query, refreshKey, onError } = options;
  const [items, setItems] = useState<readonly QuickPickItem[]>([]);
  const seq = useRef(0);
  const latestOnError = useRef(onError);
  latestOnError.current = onError;

  useEffect(() => {
    const id = ++seq.current;
    if (!isOpen) {
      setItems([]);
      return;
    }
    void loadProviderItems(registry, prefix + query, () => id !== seq.current)
      .then((next) => {
        if (next !== null) setItems(next);
      })
      .catch((e) => {
        if (id !== seq.current) return;
        setItems([]);
        latestOnError.current('浮层加载失败: ' + String(e));
      });
  }, [registry, isOpen, prefix, query, refreshKey]);

  return items;
}
