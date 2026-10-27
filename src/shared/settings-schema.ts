/**
 * 设置项的**单一声明**(架构精简 E,2026-10-27)。
 *
 * 之前每个键在读取处各写一遍字面量:类型、默认值、落在设置页哪个分区、用什么控件,
 * 全都散在调用点。于是出现过两次真实缺陷 ——
 *   ① `ui.search_row_height` 不认「没存过」,把空串当 0 拨到最小;
 *   ② 「恢复本分区默认」只覆盖了它自己知道的那几个键,漏掉新加的行。
 *
 * 这里把每项写成一条记录:`key / 默认值 / 类型 / 分区 / 读法`。
 * 读侧统一走 `useSetting(...)`(见 `use-setting.ts`),设置页与「恢复默认」按 `section` 分组。
 * **新加设置项必须在这里登记**,否则 `settings-schema.test.ts` 会红。
 */
export type SettingKind = 'bool' | 'int' | 'text' | 'json';

export interface SettingSpec {
  /** 数据库 `settings` 表里的键 */
  key: string;
  /** 没存过时用的值;`null` 表示"没有默认"(由读侧自己兜) */
  def: string | null;
  kind: SettingKind;
  /** 设置页分区 id(与左导航一致);`null` = 不在设置页出现(内部键) */
  section: string | null;
  /** 一句话说明:只给不直观的行写,能自明的不写 */
  hint?: string;
  /** 写入后需要广播给其它窗口(输入栏那一类) */
  broadcast?: boolean;
}

export const SETTINGS: readonly SettingSpec[] = [
  // —— 筛选 / 视图 ——
  { key: 'filter_current', def: null, kind: 'json', section: null },
  { key: 'sort', def: 'newest', kind: 'text', section: null },
  { key: 'graph_positions', def: '{}', kind: 'json', section: null },
  { key: 'ui.pinned.tags', def: '[]', kind: 'json', section: null },
  { key: 'ui.mru.notes', def: '[]', kind: 'json', section: null },
  { key: 'ui.mru.tags', def: '[]', kind: 'json', section: null },
  { key: 'ui.palette.limit', def: '20', kind: 'int', section: null },

  // —— 外观 ——
  { key: 'theme', def: 'system', kind: 'text', section: 'appearance' },
  {
    key: 'ui.search_row_height',
    def: '36',
    kind: 'int',
    section: 'appearance',
    hint: '36 约等于 Edge 地址栏;字号跟着行高走',
    broadcast: true,
  },

  // —— 输入栏外观 ——
  { key: 'input_always_on_top', def: 'true', kind: 'bool', section: 'input-look', broadcast: true },
  { key: 'input_focus_on_show', def: 'false', kind: 'bool', section: 'input-look', broadcast: true },
  { key: 'input_zoom_step', def: '10', kind: 'int', section: 'input-look', broadcast: true },
  { key: 'input_default_opacity', def: '100', kind: 'int', section: 'input-look', broadcast: true },
  { key: 'input_opacity_step', def: '10', kind: 'int', section: 'input-look', broadcast: true },

  // —— 输入栏行为 ——
  { key: 'input_hide_on_blur', def: 'false', kind: 'bool', section: 'input-behavior', broadcast: true },
  { key: 'input_lock_move', def: 'false', kind: 'bool', section: 'input-behavior', broadcast: true },
  { key: 'input_lock_close', def: 'false', kind: 'bool', section: 'input-behavior', broadcast: true },
  { key: 'input_lock_content', def: 'false', kind: 'bool', section: 'input-behavior', broadcast: true },
  {
    key: 'input_double_click_action',
    def: 'edit',
    kind: 'text',
    section: 'input-behavior',
    broadcast: true,
  },
  { key: 'input_hotkey', def: 'Ctrl+Shift+Q', kind: 'text', section: 'input-behavior' },

  // —— 条目(笔记)——
  { key: 'auto_time_tag', def: 'true', kind: 'bool', section: 'notes' },
  { key: 'time_tag_template', def: '时间/{y}/{m}/{d}', kind: 'text', section: 'notes' },

  // —— 实体关系 ——
  { key: 'sidebar_click_mode', def: 'filter', kind: 'text', section: 'relations' },
  { key: 'tag_tree_show_relations', def: 'true', kind: 'bool', section: 'relations' },
  { key: 'tag_view_mode', def: 'tree', kind: 'text', section: 'relations' },

  // —— 快捷键 ——
  { key: 'main_palette_hotkey', def: 'Ctrl+Shift+P', kind: 'text', section: 'hotkeys' },
  { key: 'main_quick_open_hotkey', def: 'Ctrl+P', kind: 'text', section: 'hotkeys' },

  // —— 启动 ——
  { key: 'startup_mode', def: 'tray', kind: 'text', section: 'startup' },
  { key: 'startup_restore_filter', def: 'true', kind: 'bool', section: 'startup' },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** 取一条;未登记的键返回 undefined(读侧据此退回原行为并留痕) */
export const specOf = (key: string): SettingSpec | undefined => BY_KEY.get(key);

/** 某分区的全部设置项(设置页与「恢复本分区默认」共用) */
export const specsInSection = (section: string): SettingSpec[] =>
  SETTINGS.filter((s) => s.section === section);

/** 按 kind 解析成运行时值;解析不出来时丢默认值(而不是把空串当 0) */
export function parseSetting(spec: SettingSpec, raw: string | null): unknown {
  const text = raw === null || raw === '' ? spec.def : raw;
  if (text === null) return null;
  if (spec.kind === 'bool') return text === 'true' || text === '1';
  if (spec.kind === 'int') {
    const n = Number(text);
    return Number.isFinite(n) ? n : Number(spec.def ?? 0);
  }
  if (spec.kind === 'json') {
    try {
      return JSON.parse(text);
    } catch {
      return spec.def ? JSON.parse(spec.def) : null;
    }
  }
  return text;
}
