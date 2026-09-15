/**
 * 「时间」分区折叠状态与持久化(spec 4.5):默认展开,设置键 time_section_open,
 * 读取失败或非法值一律回默认展开;写入失败静默(不影响本次会话)。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';

const KEY_OPEN = 'time_section_open';

/** 'false' 之外的值(空、拼写、类型)一律回默认 true(默认展开) */
const parseOpen = (raw: string | null): boolean => raw !== 'false';

export interface TimeSectionStateApi {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export function useTimeSection(): TimeSectionStateApi {
  const [open, setOpenState] = useState(true);

  useEffect(() => {
    void api
      .getSetting(KEY_OPEN)
      .then((raw) => setOpenState(parseOpen(raw)))
      .catch(() => {
        /* 读失败保持默认展开,不阻断侧栏 */
      });
  }, []);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    void api.setSetting(KEY_OPEN, String(v)).catch(() => {});
  }, []);

  return { open, setOpen };
}
