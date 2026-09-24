/**
 * 唯一输入框(设计 2026-09-24 §3/§4):主窗顶部常驻,先只接管「记笔记」。
 *
 * 状态全在 `useUnifiedInput` 的纯状态机里,本组件做四件事:接线(自动增高/焦点请求/受控值)、
 * 保存(Ctrl+Enter/按钮 -> `api.saveInputNote`)、渲染(输入框 + 保存按钮 + 提示行)、以及候选下拉的模式门控与键盘路由。
 *
 * 候选下拉(Task 5):候选由 `useUnifiedCandidates` 经浮层控制器取回(驱动也在那个 hook 里),高亮行
 * 直接复用控制器的 `activeIndex`;只在有前缀且不是实时筛选模式且浮层没开时渲染(记录模式恒不渲染
 * D6;`/` 只做实时筛选,§4)。键盘与浮层同口径:↓/↑ -> Tab/Enter 采纳 -> Esc 交状态机 ->
 * Ctrl+Enter **永远**保存;采纳只交出索引,三类前缀的副作用由容器 `StreamView` 决策并执行(Task 6)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { prepareForSave } from '../../shared/note-source';
import type { InputMode } from '../../shared/input-prefix';
import { BTN_PRIMARY } from '../shell/button-classes';
import { PrefixHint } from './PrefixHint';
import { UnifiedDropdownSlot } from './UnifiedDropdown';
import { useUnifiedCandidates, type UnifiedCandidateWiring } from './use-unified-candidates';
import { useUnifiedKeys } from './use-unified-keys';
import { useUnifiedInput, type UnifiedController } from './use-unified-input';

export interface UnifiedInputProps {
  /** 保存成功后回调(父组件刷新:回第一页 + 重读标签) */
  onSaved: () => void;
  /** 正在编辑某条笔记时该框只读(与今天 Composer 一致) */
  editing: boolean;
  /** 下拉节点覆盖位(给定节点/测试用;缺省时按 `candidates` 渲染内置下拉) */
  dropdown?: ReactNode | null;
  /** 候选接线(控制器 + 装饰 + 作废键 + 错误出口);不给 = 没有任何下拉 */
  candidates?: UnifiedCandidateWiring | null;
  /** 采纳回调(索引):本任务只关下拉,副作用在 Task 6 接 */
  onAccept?: (index: number) => void;
  /** 模式/统计文案(父组件按需给,用于提示行) */
  stat?: string;
  /** 控制器上抛:父组件(快捷键、验收脚本)需要 setRaw/prefill */
  onController?: (c: UnifiedController) => void;
  /** 正在写内容时的模式变化上报(父组件据此驱动筛选/候选/采纳决策) */
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
  // 候选:三类前缀由 hook 驱动浮层控制器取回(记录/筛选模式返回空)
  const wiring = p.candidates ?? null;
  const cands = useUnifiedCandidates({
    mode: c.state.mode,
    query: c.state.query,
    refreshKey: wiring?.refreshKey ?? 0,
    onError: wiring?.onError ?? (() => {}),
    controller: wiring?.palette ?? null,
  });

  // controller 对象每次渲染都是新的(方法本身是 useCallback 稳定身份):直接上报会让把它存进 state
  // 的父组件死循环,故状态用 getter 读最新一份、外壳只建一次。
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

  // 模式/query 上报:统一发状态机的**派生值**(不在 onChange 里现算 raw)——
  // 除了输入,esc/clear 也会换模式,父组件据此取消挂起的筛选防抖
  useEffect(() => {
    p.onStateChange?.({ mode: c.state.mode, query: c.state.query, prefix: c.state.prefix });
  }, [p.onStateChange, c.state.mode, c.state.query, c.state.prefix]);

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

  // 候选:记录模式与实时筛选模式没有下拉(状态机已保证这两个模式的 dropdownOpen 恒假,D6/§4);
  // 浮层开着时让位给浮层(两个候选 UI 互斥)
  const pal = wiring?.palette ?? null;
  const showDropdown = c.state.dropdownOpen && !(pal?.isOpen ?? false);

  /** 采纳:先关下拉(状态机保留模式),再把索引交给 Task 6 的副作用出口 */
  const accept = (index: number) => {
    c.closeDropdown();
    p.onAccept?.(index);
  };

  // 键盘路由(与浮层同口径,含输入法组合守卫):↓/↑ 移动 -> Tab 采纳 -> Enter 采纳(有行时才)-> Esc -> Ctrl+Enter 保存
  const routeKey = useUnifiedKeys({
    dropdownShown: showDropdown,
    activeIndex: pal?.activeIndex ?? 0,
    count: cands.rows.length,
    save: () => void save(),
    esc: () => c.esc(), // 两级:有下拉先关下拉(模式/内容不动),没下拉才退模式
    highlight: (index) => pal?.setActiveIndex(index),
    accept,
  });

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
            setError(''); // 一有输入就收起保存失败提示,否则它会长期占着提示行
            resize();
          }}
          onKeyDown={routeKey}
          style={{ maxHeight: MAX_HEIGHT, overflowY: 'auto' }}
          className="block h-8 min-w-0 flex-1 resize-none rounded-sm border border-border-strong bg-raised px-2.5 py-1.5 text-ui text-text outline-none"
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
      {showDropdown && pal !== null
        ? (p.dropdown ?? (
            <UnifiedDropdownSlot
              rows={cands.rows}
              total={cands.total}
              truncated={cands.truncated}
              palette={pal}
              decorations={wiring?.decorations}
              onAccept={accept}
            />
          ))
        : null}
    </div>
  );
}
