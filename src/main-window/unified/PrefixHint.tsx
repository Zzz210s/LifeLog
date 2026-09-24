/**
 * 唯一输入框下缘的小字前缀提示行(设计 2026-09-24 §3.1)。
 *
 * 纯展示:列出可用的四种前缀(点一下交给上层 withPrefix 写入输入框),
 * 有前缀时把当前那一段高亮并可显示实时统计;编辑态整行换成只读说明。
 * 保存失败时整行换成红色错误文案(与提示行共用一行,顶区不额外长高)。
 * 三态优先级:error > readonly > 正常(设计 §3 的形态图只有两行)。
 * 不持有状态、不聚焦输入框 —— 接线由 useUnifiedInput 负责。
 */
import type { ReactNode } from 'react';
import { NOTE_PREFIX, PREFIXES, type InputMode } from '../../shared/input-prefix';

export interface PrefixHintProps {
  /** 当前模式(由 useUnifiedInput 给) */
  mode: InputMode;
  /** 有前缀时的实时统计文案,如「12 个匹配」「命中 38 条」;无则不显示 */
  stat?: string;
  /** 编辑某条笔记时整行换成只读说明 */
  readonly?: boolean;
  /** 保存失败的中文原因;有值时整行换成红色文案(优先级高于 readonly) */
  error?: string;
  /** 点前缀段:把该前缀写进输入框(由上层 withPrefix 处理) */
  onPickPrefix: (prefix: string) => void;
}

const ROW_CLASS = 'flex flex-wrap items-center gap-x-2 px-1 pt-1 text-label text-muted';
/** V4 门禁要求主窗按钮只允许 h-7/h-8 两档高度;提示段是 12px 小字,故用 28 高 + 小内边距 */
const SEG_CLASS = 'h-7 px-0.5';

export function PrefixHint(p: PrefixHintProps): ReactNode {
  if (p.error) {
    return (
      <div data-testid="prefix-hint" role="alert" className={ROW_CLASS}>
        <span className="text-danger">{p.error}</span>
      </div>
    );
  }
  if (p.readonly) {
    return <div data-testid="prefix-hint" className={ROW_CLASS}>编辑中 — 保存或取消后可继续记录</div>;
  }
  const active = PREFIXES.find((s) => s.mode === p.mode);
  return (
    <div data-testid="prefix-hint" className={ROW_CLASS}>
      {p.mode === NOTE_PREFIX.mode ? <span>{NOTE_PREFIX.hint}</span> : null}
      {PREFIXES.map((spec) => {
        const isActive = spec.prefix === active?.prefix;
        return (
          <button
            key={spec.prefix}
            type="button"
            data-prefix={spec.prefix}
            data-active={isActive ? 'true' : undefined}
            title={`${spec.label}(${spec.prefix} 开头)`}
            onClick={() => p.onPickPrefix(spec.prefix)}
            className={isActive ? `${SEG_CLASS} text-accent-text` : `${SEG_CLASS} hover:text-accent-text`}
          >
            {`${spec.prefix} ${spec.hint}`}
          </button>
        );
      })}
      {active && p.stat ? <span data-testid="prefix-stat">{p.stat}</span> : null}
    </div>
  );
}
