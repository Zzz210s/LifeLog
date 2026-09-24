/**
 * 唯一输入框(设计 2026-09-24 §3/§4):主窗顶部常驻,先只接管「记笔记」。
 *
 * 状态全在 `useUnifiedInput` 的纯状态机里,本组件只做三件事:
 *  1) 接线:自动增高、焦点请求(`focusSignal`)、受控值;
 *  2) 保存:Ctrl+Enter / 按钮 -> `prepareForSave` -> `api.saveInputNote`;
 *  3) 渲染:输入框 + 保存按钮(同一行)+ 小字提示行(错误/编辑说明复用该行)。
 *
 * 形态照设计 §3 的图:输入框行 + 提示行,共两行(顶区预算 <= 210)。
 * 下拉行是占位(Task 5 接真候选):只在**有前缀**的模式下渲染,记录模式恒不渲染(D6)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { prepareForSave } from '../../shared/note-source';
import { parseInput, type InputMode } from '../../shared/input-prefix';
import { BTN_PRIMARY } from '../shell/button-classes';
import { PrefixHint } from './PrefixHint';
import { useUnifiedInput, type UnifiedController } from './use-unified-input';

export interface UnifiedInputProps {
  /** 保存成功后回调(父组件刷新:回第一页 + 重读标签) */
  onSaved: () => void;
  /** 正在编辑某条笔记时该框只读(与今天 Composer 一致) */
  editing: boolean;
  /** 下拉行(本计划 Task 5 接入;先留可选,未接时不渲染) */
  dropdown?: ReactNode | null;
  /** 模式/统计文案(父组件按需给,用于提示行) */
  stat?: string;
  /** 控制器上抛:父组件(快捷键、验收脚本)需要 setRaw/prefill */
  onController?: (c: UnifiedController) => void;
  /** 正在写内容时的模式变化上报(父组件据此驱动筛选/候选) */
  onStateChange?: (s: { mode: InputMode; query: string; prefix: string }) => void;
}

/** 自动增高上限(约 10 行):超过后转框内滚动 */
const MAX_HEIGHT = 280;
const PLACEHOLDER = '记点什么… #标签 自动归类 · Ctrl+Enter 保存';

export function UnifiedInput(p: UnifiedInputProps): ReactNode {
  const c = useUnifiedInput();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // controller 对象每次渲染都是新的:直接上报会让把它存进 state 的父组件死循环。
  // 方法本身是 useCallback 稳定身份,状态用 getter 读最新一份,外壳只建一次。
  const latest = useRef(c);
  latest.current = c;
  const stable = useMemo<UnifiedController>(
    () => ({
      get state() { return latest.current.state; },
      get focusSignal() { return latest.current.focusSignal; },
      setRaw: (raw: string) => latest.current.setRaw(raw),
      pickPrefix: (prefix: string) => latest.current.pickPrefix(prefix),
      prefill: (prefix: string) => latest.current.prefill(prefix),
      esc: () => latest.current.esc(),
      clear: () => latest.current.clear(),
      openDropdown: () => latest.current.openDropdown(),
      closeDropdown: () => latest.current.closeDropdown(),
    }),
    [],
  );
  useEffect(() => { p.onController?.(stable); }, [p.onController, stable]);

  // 焦点请求:只在计数变化时抢焦点(挂载时不抢,避免顶掉别处的初始焦点)
  const lastFocus = useRef(c.focusSignal);
  useEffect(() => {
    if (lastFocus.current === c.focusSignal) return;
    lastFocus.current = c.focusSignal;
    ref.current?.focus({ preventScroll: true });
  }, [c.focusSignal]);

  /** 自动增高:先归零再按内容撑开,超上限转内部滚动 */
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  };

  const save = async () => {
    const text = prepareForSave(c.state.raw);
    if (!text || saving || p.editing) return;
    setSaving(true);
    setError('');
    try {
      await api.saveInputNote(text);
      c.clear();
      if (ref.current) ref.current.style.height = 'auto';
      p.onSaved();
    } catch (e) {
      setError(String(e)); // 失败保留输入
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border px-4 py-2">
      {/* 输入框与保存按钮同一行(items-start:自动增高时按钮留顶部) */}
      <div className="flex items-start gap-2">
        <textarea
          ref={ref}
          data-testid="unified-input"
          aria-label="统一输入框"
          rows={1}
          value={c.state.raw}
          disabled={p.editing}
          placeholder={PLACEHOLDER}
          onChange={(e) => {
            const raw = e.target.value;
            c.setRaw(raw);
            resize();
            // 模式/query 由新值现算:setRaw 是异步 state 更新,这里读 state 会慢一拍
            const parsed = parseInput(raw);
            p.onStateChange?.({ mode: parsed.mode, query: parsed.query, prefix: parsed.prefix });
          }}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault();
              void save();
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              c.esc();
            }
          }}
          style={{ maxHeight: MAX_HEIGHT, overflowY: 'auto' }}
          className="block min-w-0 flex-1 resize-none rounded-sm border border-border-strong bg-raised px-2.5 py-1.5 text-ui text-text outline-none"
        />
        <button
          onClick={() => void save()}
          disabled={p.editing || !c.state.raw.trim() || saving}
          className={BTN_PRIMARY}
        >
          保存
        </button>
      </div>
      {/* 提示行:错误 > 编辑中 > 正常前缀提示,恒为一行 */}
      <PrefixHint
        mode={c.state.mode}
        stat={p.stat}
        readonly={p.editing}
        error={error ? '保存失败: ' + error : undefined}
        onPickPrefix={c.pickPrefix}
      />
      {c.state.dropdownOpen && c.state.mode !== 'note' ? p.dropdown : null}
    </div>
  );
}
