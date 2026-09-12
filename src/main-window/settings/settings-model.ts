// 设置页的数据模型:快捷输入分区 9 行的元数据、整批恢复默认与构建期版本号。
// 只放纯数据与纯逻辑(便于单测),控件与页面见同目录 controls/QuickWindowSection 等。
import {
  QUICK_DEFAULTS,
  saveQuickSetting,
  type QuickSettings,
} from '../../shared/quick-settings';
import { OPACITY_MAX, OPACITY_MIN, STEP_MAX, STEP_MIN } from '../../shared/quick-scale';

/** 主窗的两个整页视图:信息流与设置 */
export type MainView = 'stream' | 'settings';

/** 数值行的合法区间:与快捷窗读取时的钳制共用同一真源(quick-scale) */
export interface RowRange {
  min: number;
  max: number;
}

/** 下拉行的可选值(当前只有双击动作) */
export type SelectValue = 'hide' | 'none';

export interface SettingsRow {
  key: keyof QuickSettings;
  label: string;
  hint: string;
  kind: 'percent' | 'number' | 'toggle' | 'select';
  options?: { value: SelectValue; label: string }[];
  range?: RowRange;
}

/** 顺序与设计文档第 4 节的表格一致(与 QuickSettings 字段声明顺序无关) */
const ROWS: SettingsRow[] = [
  {
    key: 'alwaysOnTop',
    label: '窗口置顶',
    hint: '快捷窗唤起时是否始终显示在其他窗口前面',
    kind: 'toggle',
  },
  {
    key: 'hideOnBlur',
    label: '失焦自动隐藏',
    hint: '快捷窗失去焦点时自动隐藏;关闭则常驻(贴纸模式)',
    kind: 'toggle',
  },
  {
    key: 'zoomStep',
    label: '滚轮缩放步长',
    hint: `滚轮每格改变缩放的比例,单位为百分点整数(${STEP_MIN}-${STEP_MAX})`,
    kind: 'percent',
    range: { min: STEP_MIN, max: STEP_MAX },
  },
  {
    key: 'defaultOpacity',
    label: '默认透明度',
    hint: `鼠标中键点击恢复到的透明度,单位为百分比整数(${OPACITY_MIN}-${OPACITY_MAX})`,
    kind: 'percent',
    range: { min: OPACITY_MIN, max: OPACITY_MAX },
  },
  {
    key: 'opacityStep',
    label: '透明度步长',
    hint: `Ctrl+滚轮每格改变透明度的点数(整数,${STEP_MIN}-${STEP_MAX})`,
    kind: 'percent',
    range: { min: STEP_MIN, max: STEP_MAX },
  },
  {
    key: 'lockMove',
    label: '阻止移动',
    hint: '开启后按住窗口边缘也不再移动窗口',
    kind: 'toggle',
  },
  {
    key: 'lockClose',
    label: '阻止关闭',
    hint: '开启后 Esc 与失焦都不再隐藏快捷窗',
    kind: 'toggle',
  },
  {
    key: 'lockContent',
    label: '锁定内容',
    hint: '开启后输入框只读,Ctrl+Enter 保存无效',
    kind: 'toggle',
  },
  {
    key: 'doubleClickAction',
    label: '双击动作',
    hint: '在窗口边缘双击时执行的动作',
    kind: 'select',
    options: [
      { value: 'hide', label: '隐藏窗口' },
      { value: 'none', label: '无动作' },
    ],
  },
];

/** 设置页展示的 9 行元数据(每次返回浅拷贝,调用方改不到真源) */
export function quickRows(): SettingsRow[] {
  return ROWS.map((row) => ({ ...row, options: row.options?.map((o) => ({ ...o })) }));
}

/** 「恢复快捷输入分区默认」需要写回的键 */
export function quickResetKeys(): (keyof QuickSettings)[] {
  return ROWS.map((row) => row.key);
}

/** 更新单个设置字段:计算属性写在泛型函数里,避免联合类型键导致的赋值窄化报错 */
export function withQuickSetting<K extends keyof QuickSettings>(
  settings: QuickSettings,
  key: K,
  value: QuickSettings[K],
): QuickSettings {
  return { ...settings, [key]: value };
}

/** 恢复快捷输入分区全部默认值(逐键写库;任一失败由调用方提示并回读) */
export function resetQuickSettings(): Promise<void[]> {
  return Promise.all(quickResetKeys().map((key) => writeDefault(key)));
}

function writeDefault<K extends keyof QuickSettings>(key: K): Promise<void> {
  return saveQuickSetting(key, QUICK_DEFAULTS[key]);
}

declare const __APP_VERSION__: string | undefined;

/** 构建期注入的应用版本(见 vite.config.ts 的 define,取自 tauri.conf.json);未注入时给占位符 */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ !== '' ? __APP_VERSION__ : '未知';
}
