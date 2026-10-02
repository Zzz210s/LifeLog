// 「外观」段落的数据模型:三个滑块的元数据、外观 8 键的整批恢复默认与两处文案。
// 只放纯数据与纯逻辑(便于单测);控件见 appearance-controls,段落见 InputAppearanceSection。
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  saveAppearance,
  type InputAppearance,
  type SurfaceColor,
} from '../../shared/input-appearance';

/** 外观段落里除色块/预设/页签外的三个数值行 */
export interface AppearanceRow {
  key: 'radius' | 'shadow' | 'opacity';
  label: string;
  hint: string;
}

const ROWS: AppearanceRow[] = [
  {
    key: 'radius',
    label: '圆角',
    hint: '输入栏四角的圆角半径,单位为像素整数(0-16)',
  },
  {
    key: 'shadow',
    label: '阴影',
    hint: '输入栏投影的强度档位',
  },
  {
    key: 'opacity',
    label: '透明度',
    hint: '只作用于输入栏背景,文字色始终按主题或底色保证对比度(0-100)',
  },
];

/** 三个数值行的元数据(每次返回浅拷贝,调用方改不到真源) */
export function appearanceRows(): AppearanceRow[] {
  return ROWS.map((row) => ({ ...row }));
}

/** 「恢复输入栏分区默认」里外观部分的 8 个键(= APPEARANCE_KEYS 的键集) */
export function appearanceResetKeys(): (keyof InputAppearance)[] {
  return Object.keys(APPEARANCE_KEYS) as (keyof InputAppearance)[];
}

function writeDefault<K extends keyof InputAppearance>(key: K): Promise<void> {
  return saveAppearance(key, APPEARANCE_DEFAULTS[key]);
}

/** 恢复外观全部默认值(逐键写库;任一失败由调用方提示并回读)。
 *  KV 只有 set_setting 没有删除命令,所以「恢复」= 写回默认序列化值(与 resetInputSettings 同口径)。 */
export function resetAppearance(): Promise<void[]> {
  return Promise.all(appearanceResetKeys().map(writeDefault));
}

/** 透明度低于 40% 给一句不阻断的提示;其余返回 null */
export function opacityWarning(percent: number): string | null {
  return percent < 40 ? '背景过透可能看不清输入内容' : null;
}

/** 底色行的说明:自定义色要讲清文字色是自动选的,主题/透明各有各的语义 */
export function bgHint(bg: SurfaceColor): string {
  if (bg === 'theme') return '跟随主题的输入栏底色';
  if (bg === 'transparent') return '背景全透明,只靠边框与阴影标示输入区';
  return '文字色按底色明暗自动选,保证对比度不低于 4.5:1';
}
