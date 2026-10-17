// 设置页「维护」小节(任务书 2026-10-17 档 1 第 ③ 条):三件原本只有命令面板能做的事,
// 补一条可发现的界面入口 —— 重建搜索索引(先确认,回条数与耗时)、导出整库(复用既有导出命令,
// 保存对话框里有默认文件名)、专注模式(开关,显示当前状态)。
// 命令面板的三条命令全部保留:这里不是搬家,是补入口。
import { useState, type ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { BTN_SECONDARY } from '../shell/button-classes';
import { reindexNow, type ReindexResult } from '../shell/reindex';
import { SettingsRow, Toggle } from './controls';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';
import { EXPORT_DEFAULT_PATH } from '../data/use-export';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'maintenance')!;

export interface MaintenanceProps {
  /** 重建索引(缺省 `shell/reindex.ts` 的同一条实现;测试注入假实现时才有值) */
  reindex?: () => Promise<ReindexResult>;
  /** 整库导出(既有 useNotesExport.onExport;取消/失败由它自己落定) */
  exportAll?: () => Promise<void>;
  exporting?: boolean;
  /** 专注模式(与命令面板 `focus.mode` 同一份状态) */
  focus?: { on: boolean; toggle: () => void };
}

type Receipt = { text: string; tone: 'ok' | 'error' };

export function MaintenanceSection(p: MaintenanceProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  /** 重建索引:先确认(写库 + 会短暂变慢),再跑同一条实现,最后回条数与耗时 */
  const onReindex = async (): Promise<void> => {
    if (busy) return;
    const ok = await confirm('重建搜索索引会扫描全部条目并重写 FTS 索引,期间搜索可能短暂变慢。继续吗?', {
      title: '重建搜索索引',
      kind: 'warning',
    }).catch(() => false);
    if (!ok) return;
    setBusy(true);
    setReceipt(null);
    try {
      const { rows, ms } = await (p.reindex ?? reindexNow)();
      setReceipt({ text: `搜索索引已重建(${rows} 条,耗时 ${ms} ms)`, tone: 'ok' });
    } catch (e) {
      setReceipt({ text: '重建失败: ' + String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const focusOn = p.focus?.on === true;
  return (
    <SettingsSection meta={META}>
      <SettingsRow
        label="搜索索引"
        hint="会扫描全部条目并重写 FTS 索引,期间搜索可能短暂变慢;完成后回条数与耗时。"
      >
        <button
          type="button"
          data-testid="maintenance-reindex"
          onClick={() => void onReindex()}
          disabled={busy}
          className={BTN_SECONDARY}
        >
          {busy ? '正在重建…' : '立即重建'}
        </button>
      </SettingsRow>
      {receipt !== null && (
        <p
          data-testid="maintenance-receipt"
          className={'border-b border-border py-2 text-label ' + (receipt.tone === 'error' ? 'text-danger' : 'text-success')}
        >
          {receipt.text}
        </p>
      )}
      <SettingsRow
        label="导出整库"
        hint={`保存对话框里默认文件名「${EXPORT_DEFAULT_PATH}」;导出期间顶栏显示进度,完成也由顶栏回执。`}
      >
        <button
          type="button"
          data-testid="maintenance-export"
          onClick={() => void p.exportAll?.()}
          disabled={p.exportAll === undefined || p.exporting === true}
          className={BTN_SECONDARY}
        >
          {p.exporting === true ? '正在导出…' : '导出…'}
        </button>
      </SettingsRow>
      <SettingsRow
        label="专注模式"
        hint={`隐藏侧栏,只留内容;关闭时恢复原来的显隐。与命令面板的「专注模式」是同一份状态。当前:${focusOn ? '开' : '关'}`}
      >
        <Toggle
          testId="maintenance-focus-toggle"
          checked={focusOn}
          label="专注模式"
          onChange={() => p.focus?.toggle()}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
