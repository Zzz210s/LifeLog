// 设置页「笔记」分区(spec 2026-09-17 D4/D5):
// 开关决定新建笔记是否自动带时间标签(关掉只影响新建,已有标签一个不动);
// 模板决定自动标签的路径,改动即等于改时间标签的存放位置。
// 模板走后端命令即时校验(与创建路径同一实现),非法给中文提示且不落库。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import { SettingsRow, Toggle } from './controls';
import { BTN_SECONDARY } from '../shell/button-classes';
import {
  AUTO_TIME_TAG_KEY,
  DEFAULT_TIME_TAG_TEMPLATE,
  TIME_TAG_TEMPLATE_KEY,
  normalizeTemplate,
  parseAutoTimeTag,
  templateVerdict,
} from './time-tag-settings';

/** 模板输入的校验防抖窗口(与表达式框同量级) */
const DEBOUNCE_MS = 250;

type Verdict = { ok: boolean; message: string };

export function NotesSection(): ReactNode {
  const [auto, setAuto] = useState(true);
  const [template, setTemplate] = useState(DEFAULT_TIME_TAG_TEMPLATE);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    setError('');
    Promise.all([api.getSetting(AUTO_TIME_TAG_KEY), api.getSetting(TIME_TAG_TEMPLATE_KEY)])
      .then(([a, t]) => {
        setAuto(parseAutoTimeTag(a));
        setTemplate(normalizeTemplate(t));
        setLoaded(true);
      })
      .catch((e) => setError('读取笔记设置失败: ' + String(e)));
  }, []);

  useEffect(load, [load]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const applyAuto = (v: boolean) => {
    setAuto(v);
    void api
      .setSetting(AUTO_TIME_TAG_KEY, String(v))
      .then(() => setError(''))
      .catch((e) => setError('保存失败: ' + String(e)));
  };

  /** 输入即校验:合法才落库;非法保留输入内容并提示原因(不写库) */
  const onTemplateInput = (v: string) => {
    setTemplate(v);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      api
        .validateTimeTagTemplate(v)
        .then(() => templateVerdict(null))
        .catch((e) => templateVerdict(String(e)))
        .then((r) => {
          setVerdict({ ok: r.save, message: r.message });
          if (!r.save) return;
          void api
            .setSetting(TIME_TAG_TEMPLATE_KEY, v)
            .then(() => setError(''))
            .catch((e) => setError('保存失败: ' + String(e)));
        });
    }, DEBOUNCE_MS);
  };

  return (
    <section className="rounded-lg border border-border bg-raised">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium text-text">笔记</h2>
        <p className="mt-0.5 text-xs text-faint">新建笔记与时间标签的存放规则;改动立即保存</p>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-danger">{error}</p>}
      {!loaded ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <span className="text-xs text-faint">加载中...</span>
          {error && (
            <button
              type="button"
              onClick={() => load()}
              className={BTN_SECONDARY}
            >
              重试
            </button>
          )}
        </div>
      ) : (
        <div className="px-4">
          <SettingsRow
            label="保存时自动带时间标签"
            hint="新保存的笔记自动加上时间标签;关闭只影响新建,已存在的标签一个不动"
          >
            <Toggle checked={auto} label="保存时自动带时间标签" onChange={applyAuto} />
          </SettingsRow>
          <SettingsRow
            label="时间标签格式"
            hint="模板决定自动标签路径,改这里就等于改时间标签的存放位置;必须含 {y}、{m}、{d}"
          >
            <input
              type="text"
              value={template}
              aria-label="时间标签格式"
              spellCheck={false}
              onChange={(e) => onTemplateInput(e.target.value)}
              className={
                'h-8 w-56 rounded-sm border px-2.5 font-mono text-ui outline-none ' +
                (verdict !== null && !verdict.ok ? 'border-danger bg-danger-soft' : 'border-border-strong')
              }
            />
          </SettingsRow>
          {verdict !== null && (
            <p className={'pb-2 text-xs ' + (verdict.ok ? 'text-success' : 'text-danger')} role="status">
              {verdict.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
