// 主题三态的统一入口(两个窗口都用它):
// - 主窗 broadcast=true:切换时写库并广播 lifelog://theme,让输入栏即时跟随;
// - 输入栏 follow=true:监听广播即时应用(自己不改库,真源仍在主窗设置页)。
// 落点是根节点 class 与 color-scheme(见 shared/theme.css);system 时跟随系统即时切换。
import { useCallback, useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { api } from './api';
import {
  parseThemeMode,
  parseThemePayload,
  readThemeMirror,
  resolveDark,
  writeThemeMirror,
  THEME_DEFAULT,
  THEME_EVENT,
  THEME_KEY,
  type ThemeMode,
} from './theme-mode';

/** 系统是否偏好暗色;无 matchMedia(测试/老运行时)时按亮色处理 */
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** 把三态落到根节点:class 决定 token 取值,color-scheme 由 theme.css 跟随 .dark */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolveDark(mode, systemPrefersDark()));
}

/** 每次应用主题都要回写镜像:下次启动的 <head> 内联脚本据此在首帧前落 .dark */
export function applyAndMirror(mode: ThemeMode): void {
  applyThemeMode(mode);
  writeThemeMirror(mode);
}

/** 监听系统深浅色变化(仅 system 态需要);返回取消订阅函数 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export interface UseThemeModeOptions {
  /** 主窗:写库成功后广播主题(输入栏收到即应用) */
  broadcast?: boolean;
  /** 输入栏:收到广播即应用,不写库 */
  follow?: boolean;
  onError?: (message: string) => void;
}

export interface ThemeModeController {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export function useThemeMode(options: UseThemeModeOptions = {}): ThemeModeController {
  const { broadcast = false, follow = false, onError } = options;
  const [mode, setModeState] = useState<ThemeMode>(() => parseThemeMode(readThemeMirror()));
  // 回调与当前态放在 ref 里:订阅只建一次,避免每次切换都重订阅
  const latest = useRef({ mode: THEME_DEFAULT, onError });
  latest.current = { mode, onError };

  // 挂载:先按镜像应用(与 index.html/input.html 的 <head> 内联脚本同一判定,不动首帧已落地的
  // class),再读库纠正;读取失败保持默认并由调用方提示
  useEffect(() => {
    applyAndMirror(parseThemeMode(readThemeMirror()));
    let alive = true;
    void api
      .getSetting(THEME_KEY)
      .then((raw) => {
        if (!alive) return;
        const next = parseThemeMode(raw);
        setModeState(next);
        applyAndMirror(next);
      })
      .catch((e) => latest.current.onError?.('读取主题设置失败: ' + String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // 系统主题变化:只有 system 态需要重新判定(显式亮/暗不受系统影响)
  useEffect(
    () =>
      watchSystemTheme(() => {
        if (latest.current.mode === 'system') applyAndMirror('system');
      }),
    []
  );

  // 输入栏:主窗广播后即时应用(非字符串载荷忽略;非法字符串按 parseThemeMode 回退 system)
  useEffect(() => {
    if (!follow) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<unknown>(THEME_EVENT, (event) => {
      const next = parseThemePayload(event.payload);
      if (next === null) return;
      setModeState(next);
      applyAndMirror(next);
    })
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch((e) => latest.current.onError?.('主题广播订阅失败: ' + String(e)));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [follow]);

  /** 切换:界面即时生效,再写库;主窗写库成功后广播(失败提示但界面保持用户选择) */
  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      applyAndMirror(next);
      void api
        .setSetting(THEME_KEY, next)
        .then(() => {
          if (broadcast) void emit(THEME_EVENT, next).catch(() => {}); // 广播失败不阻断,输入栏下次启动仍读库
        })
        .catch((e) => latest.current.onError?.('保存主题设置失败: ' + String(e)));
    },
    [broadcast]
  );

  return { mode, setMode };
}
