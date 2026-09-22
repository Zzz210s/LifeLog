/**
 * 浮层设置的 React 装配(自 `use-app-palette.ts` 抽出以守行数红线):
 * 启动读一次(读不坏),MRU 落盘点 = **接受后空闲** + 窗口关闭 + 组件卸载。
 * 「只在接受时标脏」由调用方在 onAccept 里 touch;这里只负责什么时候写盘。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { loadPaletteSettings } from './palette-mru';
import type { PaletteSettings, SettingIo } from './palette-mru';

export type { PaletteSettings, SettingIo } from './palette-mru';

/** 接受后延迟落盘 MRU 的空闲窗口(合并连续接受,避免每选一次就写一次库) */
export const MRU_IDLE_SAVE_MS = 1500;

export interface PaletteSettingsApi {
  /** 还没读回来时为 null(浮层先用默认上限/无 MRU 渲染,不阻塞打开) */
  settings: PaletteSettings | null;
  /** 标脏后的空闲落盘(重复调用重置计时) */
  saveMruSoon(): void;
}

export function usePaletteSettings(io?: SettingIo): PaletteSettingsApi {
  const [settings, setSettings] = useState<PaletteSettings | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const store: SettingIo = io ?? { read: api.getSetting, write: api.setSetting };
    void loadPaletteSettings(store).then((next) => {
      if (alive) setSettings(next);
    });
    return () => {
      alive = false;
    };
  }, [io]);

  // 退出/卸载兜底:窗口关闭事件 + effect cleanup 各写一次(有改动才真的写)
  useEffect(() => {
    if (settings === null) return;
    const save = (): void => settings.saveMru();
    window.addEventListener('beforeunload', save);
    return () => {
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [settings]);

  const saveMruSoon = useCallback(() => {
    if (settings === null) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      settings.saveMru();
    }, MRU_IDLE_SAVE_MS);
  }, [settings]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { settings, saveMruSoon };
}
