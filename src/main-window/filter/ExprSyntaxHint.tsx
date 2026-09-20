/**
 * 表达式对话框里的「语法速查」折叠区(spec 3.5):六类形式表 + 补充说明 + 可点填示例。
 * 独立成文件是为了让 ExprDialog 守 200 行上限;数据全部来自 expr-hint.ts。
 */
import type { ReactNode } from 'react';
import { EXAMPLES, SYNTAX_HINTS, SYNTAX_NOTES } from './expr-hint';

export interface ExprSyntaxHintProps {
  /** 点示例:把该示例填进输入框 */
  onPick: (example: string) => void;
}

export function ExprSyntaxHint(p: ExprSyntaxHintProps): ReactNode {
  return (
    <details open className="mt-2 rounded-md border border-border px-2 py-1">
      <summary className="cursor-pointer text-xs text-muted">语法速查</summary>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {SYNTAX_HINTS.map((h) => (
            <tr key={h.form}>
              <td className="whitespace-nowrap py-0.5 pr-2 align-top font-mono text-accent-text">
                {h.form}
              </td>
              <td className="py-0.5 text-muted">{h.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-1 list-disc pl-4 text-xs text-faint">
        {SYNTAX_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            title={`填入示例:${e}`}
            onClick={() => p.onPick(e)}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted hover:border-accent hover:text-accent-text"
          >
            {e}
          </button>
        ))}
      </div>
    </details>
  );
}
