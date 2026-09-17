// 输入栏唤起快捷键的录制行:点「录制」进入捕获态,按下组合键即注册并落库;Esc 取消。
// 本地 preflight 只给即时提示,最终判定以 Rust 为准(命令返回的中文原因原样显示,
// 且失败时旧快捷键继续可用)。显示文案与启发式见 shared/hotkey-display。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { api } from '../../shared/api';
import {
  DEFAULT_HOTKEY,
  HOTKEY_KEY,
  effectiveAccelerator,
  formatAccelerator,
  formatKeys,
  hotkeyHint,
  isModifierOnly,
  normalizeParts,
  partsFromEvent,
} from '../../shared/hotkey-display';
import { SettingsRow } from './controls';

const LABEL = '唤起/隐藏快捷键';

export function HotkeyRecorder(): ReactNode {
  const [accelerator, setAccelerator] = useState<string | null>(null); // null = 读取中
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLButtonElement>(null);

  // 显示运行时**生效值**(与真实注册状态一致),取不到才回退库值
  useEffect(() => {
    void (async () => {
      try {
        const [live, raw] = await Promise.all([
          api.getInputHotkey(),
          api.getSetting(HOTKEY_KEY),
        ]);
        setAccelerator(live ?? effectiveAccelerator(raw));
      } catch (e) {
        setError('读取快捷键设置失败: ' + String(e));
        setAccelerator(DEFAULT_HOTKEY);
      }
    })();
  }, []);

  // 捕获态必须让按钮拿到焦点,否则 keydown 落在别处;提交失败后焦点丢了也要补回来
  useEffect(() => {
    if (capturing && !busy) boxRef.current?.focus();
  }, [capturing, busy]);

  /** 提交给 Rust:成功才退出捕获态;失败(非法/被占用/保存失败)保留捕获态并显示原因 */
  const submit = useCallback(async (next: string) => {
    setBusy(true);
    try {
      const saved = await api.setInputHotkey(next);
      setAccelerator(saved);
      setError('');
      setPreview('');
      setCapturing(false);
    } catch (e) {
      setError(String(e)); // Rust 侧已是完整中文文案,不再叠加前缀
    } finally {
      setBusy(false);
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return;
    // 捕获态吞掉浏览器保留键(F5 刷新等):风险表要求录制器明确接管
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (e.repeat) return; // 长按会按系统重复率连发:忽略重复事件,只认第一次按下
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
      setError(hint); // 非法组合就地提示,不发命令(旧快捷键不受影响)
      return;
    }
    const next = normalizeParts(parts);
    if (next) void submit(next);
  };

  const shown = capturing && preview !== '' ? formatKeys(preview) : formatAccelerator(accelerator ?? '');

  return (
    <>
      <SettingsRow
        label={LABEL}
        hint="全局快捷键:输入栏显示中则隐藏,隐藏中则恢复显示;点录制后按下组合键,Esc 取消"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={boxRef}
            aria-label={capturing ? '请按下快捷键' : '录制快捷键'}
            onClick={() => {
              setCapturing(true);
              setPreview('');
              setError('');
            }}
            onBlur={() => {
              setCapturing(false);
              setPreview(''); // 只清预览:注册失败的中文原因要留到用户看见,不清错误
            }}
            onKeyDown={onKeyDown}
            className={
              'h-8 min-w-[9rem] rounded-md border px-3 text-xs tabular-nums ' +
              (capturing
                ? 'border-accent bg-accent/10 text-accent-text'
                : 'border-border text-muted hover:border-accent hover:text-accent-text')
            }
          >
            {capturing ? (preview === '' ? '请按下快捷键…' : shown) : shown}
          </button>
          <button
            type="button"
            disabled={busy || accelerator === DEFAULT_HOTKEY}
            onClick={() => void submit(DEFAULT_HOTKEY)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent-text disabled:opacity-50"
          >
            恢复默认
          </button>
        </div>
      </SettingsRow>
      {error && <p className="pb-3 text-xs text-danger">{error}</p>}
    </>
  );
}
