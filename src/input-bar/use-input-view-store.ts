import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { clampOpacity, clampScale, shouldApplyStored } from '../shared/input-scale';
import type { InputSettings } from '../shared/input-settings';
import { readGeometry } from './logical-size';

/** 透明度落库节流:连续 Ctrl+滚轮只写最后一次 */
const PERSIST_MS = 200;
/** 缩放会改变窗口的 CSS 空间,高度要按新比例重算(等 IPC 落地后再测) */
const RESYNC_MS = 120;
/** 视图状态的两个设置键:节流/在途期间未结算,重载回读必须跳过(见 shouldApplyStored) */
const OPACITY_KEY = 'input_opacity';
const ZOOM_KEY = 'input_zoom';

const noop = () => {};

/**
 * 输入栏视图状态的本地值与落库(透明度、缩放系数),供滚轮/中键接线使用。
 * **防回读覆盖**(复审 Warning):透明度落库有 200ms 节流、缩放 IPC 在途时库里还是旧值,
 * 而 use-input-settings 会在窗口获得焦点时重载设置 -> 回读会把用户刚调好的值弹回去。
 * 两道保险:①失焦/卸载前立即 flush 节流中的透明度;②本会话内尚未结算的键跳过回读。
 * 缩放另含 IPC 串行化(避免多个 set_input_scale 交错落地)与失败回滚 + 提示。
 */
export function useInputViewStore(opts: {
  settings: InputSettings;
  onResized: () => void;
  onError?: (message: string) => void;
}) {
  const { settings, onResized, onError = noop } = opts;
  const [opacity, setOpacity] = useState(settings.defaultOpacity);
  const opacityRef = useRef(opacity);
  const zoomRef = useRef(1);
  /** 窗口上真实生效的系数:命令成功后推进,失败时据此回滚 */
  const appliedRef = useRef(1);
  const scaleSeq = useRef(0);
  /** 透明度写入序号:只有最新意图的写入落定后才允许回读库值 */
  const opacitySeq = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const persistTimer = useRef<number | null>(null);
  const resyncTimer = useRef<number | null>(null);
  /** 本会话内已改但尚未结算(节流中或 IPC 在途)的设置键:重载回读时跳过 */
  const pendingKeys = useRef<Set<string>>(new Set());

  /** 写透明度:写入期间保持 pending,等本次写入落定且无更新意图时才清除 */
  const persistOpacity = useCallback((value: number, id: number) => {
    void api
      .setSetting(OPACITY_KEY, String(Math.round(value)))
      .catch(() => {})
      .finally(() => {
        if (id === opacitySeq.current) pendingKeys.current.delete(OPACITY_KEY);
      });
  }, []);

  /** 立即结算节流中的透明度(失焦/隐藏前调用):让库里先拿到新值,不等节流到期 */
  const flushOpacity = useCallback(() => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (pendingKeys.current.has(OPACITY_KEY)) persistOpacity(opacityRef.current, ++opacitySeq.current);
  }, [persistOpacity]);

  // 设置重载(含窗口重新显示)时读回当前透明度与缩放;input_opacity 未设过则用默认透明度。
  // 尚未结算的键跳过:节流中/在途的本地值比库里新,回读会把它弹回旧值(修法②)
  useEffect(() => {
    let alive = true;
    void Promise.all([api.getSetting(OPACITY_KEY), api.getSetting(ZOOM_KEY)])
      .then(([rawOpacity, rawZoom]) => {
        if (!alive) return;
        const pendingSet = pendingKeys.current;
        if (shouldApplyStored(OPACITY_KEY, pendingSet)) {
          const o =
            rawOpacity === null || rawOpacity.trim() === ''
              ? clampOpacity(settings.defaultOpacity)
              : clampOpacity(Number(rawOpacity));
          opacityRef.current = o;
          setOpacity(o);
        }
        if (shouldApplyStored(ZOOM_KEY, pendingSet)) {
          zoomRef.current =
            rawZoom === null || rawZoom.trim() === '' ? 1 : clampScale(Number(rawZoom));
          appliedRef.current = zoomRef.current;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings]);

  useEffect(
    () => () => {
      flushOpacity(); // 卸载前结算未落库的透明度
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
    },
    [flushOpacity],
  );

  // 失焦(= 隐藏只差一步)立即结算:窗口常驻不卸载,只靠卸载清理会漏
  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | null = null;
    void win
      .onFocusChanged(({ payload: focused }) => {
        if (alive && !focused) flushOpacity();
      })
      .then((off) => {
        if (alive) unlisten = off;
        else off();
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (unlisten) unlisten();
    };
  }, [flushOpacity]);

  const applyOpacity = useCallback(
    (value: number) => {
      opacityRef.current = value;
      setOpacity(value);
      // 本地意图一出现就标未结算:节流窗口内还没写库,此时的回读必须跳过,
      // 否则库里的旧值会把用户刚调好的透明度弹回去(复审 Warning 的根因)
      pendingKeys.current.add(OPACITY_KEY);
      const id = ++opacitySeq.current;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        persistTimer.current = null;
        persistOpacity(value, id);
      }, PERSIST_MS);
    },
    [persistOpacity],
  );

  const applyScale = useCallback(
    (value: number) => {
      zoomRef.current = value; // 立即生效:连续滚轮按新基准继续,视觉不等 IPC
      pendingKeys.current.add(ZOOM_KEY);
      const id = ++scaleSeq.current;
      // 串行化:IPC 按调用顺序排队,避免多个 set_input_scale 在 Rust 侧交错落地
      pending.current = pending.current
        .then(() => api.setInputScale(value))
        .then(() => {
          appliedRef.current = value;
          // Minor 6:ratio(逻辑像素/CSS 像素)只在 readGeometry 成功时刷新,缩放刚落定就重读一次;
          // 否则重算高度前的约 120ms 内热区换算仍按旧 ratio,热区会比实际缩放偏宽/偏窄。
          void readGeometry();
          if (id !== scaleSeq.current) return; // 有更新的意图在排队,由它负责重算高度
          pendingKeys.current.delete(ZOOM_KEY); // 缩放已结算,之后才认库里的 input_zoom
          if (resyncTimer.current) clearTimeout(resyncTimer.current);
          resyncTimer.current = window.setTimeout(onResized, RESYNC_MS);
        })
        .catch(() => {
          if (id !== scaleSeq.current) return; // 不是最新意图:留给它结算
          pendingKeys.current.delete(ZOOM_KEY); // 命令失败时库里仍是旧值,回读它才是对的
          // 命令失败时 input_zoom 未被改写:回滚本地基准到真实生效值,并提示(不静默)
          zoomRef.current = appliedRef.current;
          onError('缩放失败,已回滚');
        });
    },
    [onResized, onError],
  );

  return { opacity, opacityRef, zoomRef, applyOpacity, applyScale, flushOpacity };
}
