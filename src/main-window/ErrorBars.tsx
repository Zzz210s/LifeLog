import type { ReactNode } from 'react';
import { ErrorBar } from './ErrorBar';
import type { ErrorKind } from './ErrorBar';
import { ERROR_KINDS } from './errors';
import type { ErrorMap } from './errors';

export interface ErrorBarsProps {
  errors: ErrorMap;
  /** 查询失败的重试入口(重发首页);其他来源无重试语义 */
  onRetry: () => void;
  onDismiss: (kind: ErrorKind) => void;
}

/** 多来源错误纵向堆叠,逐个可关闭:查询错误额外给"重试",其余只有"关闭" */
export function ErrorBars(p: ErrorBarsProps): ReactNode {
  return (
    <>
      {ERROR_KINDS.map((kind) => {
        const message = p.errors[kind];
        return message ? (
          <ErrorBar
            key={kind}
            error={{ kind, message }}
            onRetry={p.onRetry}
            onDismiss={() => p.onDismiss(kind)}
          />
        ) : null;
      })}
    </>
  );
}
