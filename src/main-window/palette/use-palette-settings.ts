/**
 * 浮层设置的 React 装配(自 `use-app-palette.ts` 抽出以守行数红线):
 * 启动读一次(读不坏),MRU 落盘点 = **接受后空闲** + 窗口关闭 + 组件卸载 + **Rust 退出前广播**。
 * 「只在接受时标脏」由调用方在 onAccept 里 touch;这里只负责什么时候写盘。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../../shared/api';
import { loadPaletteSettings } from './palette-mru';
import type { PaletteSettings, SettingIo } from './palette-mru';

export type { PaletteSettings, SettingIo } from './palette-mru';

/** 接受后延迟落盘 MRU 的空闲窗口(合并连续接受,避免每选一次就写一次库) */
export const MRU_IDLE_SAVE_MS = 1500;

/**
 * Rust `windowing::events::quit` 在 `exit` 前广播的落盘事件(两处字符串必须一致)。
 * 退出路径 webview 不做卸载、`beforeunload` 不触发,只能靠这次广播补上最后一次接受。
 */
export const APP_QUITTING_EVENT = 'app-quitting';

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

  // 退出/卸载兜底:窗口关闭 + 组件卸载 + Rust 退出前广播各写一次(有改动才真的写)。
  // 退出走 `AppHandle::exit(0)`:webview 不做正常卸载,`beforeunload` 不触发,
  // 停在内存里的 MRU 会丢最后一次接受 —— 靠 Rust 广播的 app-quitting 补这一跳(见 events::quit)。
  useEffect(() => {
    if (settings === null) return;
    const save = (): void => settings.saveMru();
    window.addEventListener('beforeunload', save);
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen(APP_QUITTING_EVENT, save)
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {
        // 无 Tauri 运行时(单测 jsdom)或订阅失败:退出兜底失效,不影响正常使用
      });
    return () => {
      cancelled = true;
      dispose?.();
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
