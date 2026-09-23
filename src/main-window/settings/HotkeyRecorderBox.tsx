/**
 * 快捷键录制框(可复用的捕获 UI):点「录制」进入捕获态,按下组合键即交给调用方提交;
 * 失败时**保留捕获态并显示中文原因**(旧键仍然可用)。
 *
 * 作用域差异全部留给调用方:组件自己不读不写任何设置,只把**原始键名片段串**(如 ctrl+shift+p)
 * 交出去 —— 系统级那行交给 Rust 注册,应用内两行交给 set_app_hotkey。
 * 捕获态吞掉浏览器保留键(F5 刷新等),长按只认第一次按下(e.repeat),Esc 取消。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { formatKeys, hotkeyHint, isModifierOnly, partsFromEvent } from '../../shared/hotkey-display';

export interface HotkeyCapture {
  capturing: boolean;
  /** 捕获中已按下的组合(未捕获时为空串) */
  preview: string;
  error: string;
  busy: boolean;
  begin: () => void;
  /** 失焦收敛:只清预览,错误要留到用户看见 */
  end: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  /** 外部动作(恢复默认/清除)也走这里,与录制同一条错误通道 */
  run: (raw: string) => Promise<boolean>;
  ref: React.RefObject<HTMLButtonElement | null>;
  /** 按钮文字:捕获态显示预览或「请按下快捷键…」,否则显示当前值 */
  text: string;
}

export interface HotkeyCaptureOptions {
  /** 未捕获时按钮上的文字(调用方已格式化,含该作用域的默认值) */
  display: string;
  /** 提交:收到原始键名片段串,成功返回(即退出捕获态),失败抛中文原因 */
  onSubmit: (raw: string) => Promise<void>;
}

export function useHotkeyCapture({ display, onSubmit }: HotkeyCaptureOptions): HotkeyCapture {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  // 捕获态必须让按钮拿到焦点,否则 keydown 落在别处;提交失败后焦点丢了也要补回来
  useEffect(() => {
    if (capturing && !busy) ref.current?.focus();
  }, [capturing, busy]);

  const begin = useCallback(() => {
    setCapturing(true);
    setPreview('');
    setError('');
  }, []);

  const end = useCallback(() => {
    setCapturing(false);
    setPreview('');
  }, []);

  const run = useCallback(
    async (raw: string): Promise<boolean> => {
      setBusy(true);
      try {
        await onSubmit(raw);
        setError('');
        setPreview('');
        return true;
      } catch (e) {
        setError(String(e)); // Rust 侧已是完整中文文案,不再叠加前缀
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSubmit]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (!capturing) return;
      // 捕获态吞掉浏览器保留键(F5 刷新等):风险表要求录制器明确接管
      e.preventDefault();
      e.stopPropagation();
      if (busy || e.repeat) return;
      if (e.key === 'Escape') {
        setCapturing(false);
        setPreview('');
        setError('');
        return;
      }
      const parts = partsFromEvent(e.nativeEvent);
      setPreview(parts.join('+'));
      setError(''); // 每次求值先清上一条提示,避免中途态的旧提示残留
      // 只按下修饰键是录制的正常中途态:给中性提示,不亮红灯(红字只留给真正的非法组合)
      if (isModifierOnly(parts)) return;
      const hint = hotkeyHint(parts);
      if (hint) {
        setError(hint); // 形态非法就地提示,不发命令(旧键不受影响)
        return;
      }
      // 原始片段直接交给 Rust 判定:TS 的形态预检会放行 ctrl+zzz 这类键名,由 Rust 给中文原因
      void run(parts.join('+')).then((ok) => {
        if (ok) setCapturing(false);
      });
    },
    [busy, capturing, run]
  );

  return {
    capturing,
    preview,
    error,
    busy,
    begin,
    end,
    onKeyDown,
    run,
    ref,
    text: capturing ? (preview === '' ? '请按下快捷键…' : formatKeys(preview)) : display,
  };
}

export interface RecorderButtonProps {
  box: HotkeyCapture;
  /** 非捕获态的 aria-label(默认「录制快捷键」;设置页命令 hotkey.edit 依赖这个名字) */
  ariaLabel?: string;
  disabled?: boolean;
}

/** 录制按钮:捕获态高亮 + 焦点,非捕获态悬停转 accent */
export function RecorderButton({ box, ariaLabel, disabled = false }: RecorderButtonProps): ReactNode {
  return (
    <button
      type="button"
      ref={box.ref}
      aria-label={box.capturing ? '请按下快捷键' : (ariaLabel ?? '录制快捷键')}
      disabled={disabled}
      onClick={box.begin}
      onBlur={box.end}
      onKeyDown={box.onKeyDown}
      className={
        'h-8 min-w-[9rem] rounded-sm border px-3 text-ui tabular-nums ' +
        (box.capturing
          ? 'border-accent bg-accent/10 text-accent-text'
          : 'border-border text-muted hover:border-accent hover:text-accent-text')
      }
    >
      {box.text}
    </button>
  );
}
