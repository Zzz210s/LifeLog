/**
 * 顶栏的多库切换(2026-10-26):`拾枝 · 日常 ▾`,点开是库列表 + 管理项。
 *
 * 切库是**换连接**再让所有窗口重载(成功时 `switchLibrary` 已把 `Db` 里的连接换掉),
 * 所以这里不保留任何跨库状态:重载后各窗口按新库重新拉数据。
 * 新建/重命名用 `window.prompt`?不用 —— 与仓内其它输入弹窗一致,走一个内联输入行,
 * 避免原生 prompt 在 WebView2 里被禁用/样式突兀。
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { LibraryList } from '../../shared/types';
import { BTN_SECONDARY, BTN_TEXT } from './button-classes';

export interface LibrarySwitchProps {
  /** 重载所有窗口(切库成功后调) */
  onSwitched: () => void;
}

/** 菜单项:与图标按钮同档高度,宽度撑满 */
const ITEM_CLASS = 'flex h-7 w-full items-center rounded-sm px-2 text-left text-ui hover:bg-hover';

type Pane = null | { kind: 'create' } | { kind: 'rename'; id: string; name: string };

export function LibrarySwitch(p: LibrarySwitchProps): ReactNode {
  const [list, setList] = useState<LibraryList | null>(null);
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>(null);
  const [draft, setDraft] = useState('');
  // 自己的错误行:顶栏没有全局 toast 通道(闪回文字在信息流首部),这里就近显示
  const [error, setError] = useState('');

  const reload = (): void => {
    void api
      .listLibraries()
      .then(setList)
      .catch(() => setList(null));
  };
  useEffect(reload, []);

  const current = list?.libraries.find((l) => l.id === list.current);

  const run = (fn: () => Promise<unknown>, okMsg: string, after?: () => void): void => {
    void fn()
      .then(() => {
        setError('');
        setPane(null);
        reload();
        after?.();
      })
      .catch((e) => setError(String(e)));
    void okMsg;
  };

  const switchTo = (id: string): void => {
    if (id === list?.current) {
      setOpen(false);
      return;
    }
    void api
      .switchLibrary(id)
      .then(() => {
        setOpen(false);
        p.onSwitched(); // 连接已换:所有窗口重载
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <span className="relative flex items-center">
      <button
        type="button"
        data-testid="library-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="切换库"
        className={`${BTN_TEXT} gap-1 font-semibold text-text`}
      >
        拾枝
        {current ? <span className="text-muted">· {current.name}</span> : null}
        <span aria-hidden="true" className="text-label text-muted">▾</span>
      </button>
      {open && (
        <div
          data-testid="library-menu"
          role="menu"
          className="absolute left-0 top-7 z-30 w-56 rounded-md border border-border-strong bg-raised p-1 shadow-lg"
        >
          <p className="px-2 py-1 text-label text-muted">库</p>
          {error ? (
            <p data-testid="library-error" className="px-2 pb-1 text-label text-danger">
              {error}
            </p>
          ) : null}
          {(list?.libraries ?? []).map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === list?.current}
              onClick={() => switchTo(l.id)}
              className={
                'flex h-7 w-full items-center gap-1 rounded-sm px-2 text-left text-ui ' +
                (l.id === list?.current ? 'bg-accent-soft text-accent-text' : 'hover:bg-hover')
              }
            >
              <span className="flex-1 truncate">{l.name}</span>
              {l.id === list?.current ? <span className="text-label">当前</span> : null}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPane({ kind: 'create' });
              setDraft('');
            }}
            className={ITEM_CLASS}
          >
            新建库…
          </button>
          {current && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPane({ kind: 'rename', id: current.id, name: current.name });
                setDraft(current.name);
              }}
              className={ITEM_CLASS}
            >
              重命名当前库…
            </button>
          )}
          {current && list && list.libraries.length > 1 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const other = list.libraries.find((l) => l.id !== current.id);
                if (!other) return;
                run(() => api.deleteLibrary(current.id), `已删除库「${current.name}」`, () => switchTo(other.id));
              }}
              className={ITEM_CLASS + ' text-danger hover:bg-danger-soft'}
            >
              删除当前库…
            </button>
          )}
        </div>
      )}
      {pane && (
        <div
          data-testid="library-name-pane"
          className="absolute left-0 top-7 z-40 w-64 rounded-md border border-border-strong bg-raised p-2 shadow-lg"
        >
          <p className="mb-1 text-label text-muted">
            {pane.kind === 'create' ? '新库名(建出来是空的)' : '改个名字(目录不变)'}
          </p>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPane(null);
              if (e.key === 'Enter') {
                if (pane.kind === 'create') run(() => api.createLibrary(draft), `已新建库「${draft}」`);
                else run(() => api.renameLibrary(pane.id, draft), '已重命名');
              }
            }}
            className="mb-2 h-8 w-full rounded-sm border border-border-strong bg-canvas px-2 text-ui outline-none"
          />
          <div className="flex justify-end gap-1">
            <button type="button" className={BTN_SECONDARY} onClick={() => setPane(null)}>
              取消
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                if (pane.kind === 'create') run(() => api.createLibrary(draft), `已新建库「${draft}」`);
                else run(() => api.renameLibrary(pane.id, draft), '已重命名');
              }}
            >
              {pane.kind === 'create' ? '新建' : '保存'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
