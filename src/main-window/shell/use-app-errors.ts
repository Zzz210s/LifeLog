/**
 * 主窗错误槽(自 App 抽出,纯搬移):按来源留存/清除。
 * G4 单值槽会被跨源覆盖造成错误被吞,改为每个来源一份,成功路径只清同源。
 */
import { useCallback, useState } from 'react';
import type { ErrorKind } from './ErrorBar';
import { dropError, putError } from './errors';
import type { ErrorMap } from './errors';

export interface AppErrorApi {
  errors: ErrorMap;
  setError: (kind: ErrorKind, message: string) => void;
  clearError: (kind: ErrorKind) => void;
}

export function useAppErrors(): AppErrorApi {
  const [errors, setErrors] = useState<ErrorMap>({});
  const setError = useCallback((kind: ErrorKind, message: string) => {
    setErrors((prev) => putError(prev, kind, message));
  }, []);
  const clearError = useCallback((kind: ErrorKind) => {
    setErrors((prev) => dropError(prev, kind));
  }, []);
  return { errors, setError, clearError };
}
