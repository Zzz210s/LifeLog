// 输入栏唤起快捷键的纯逻辑与显示文案(可单测,不碰 DOM 与 IPC)。
// 规则与 Rust 侧 src-tauri/src/hotkey.rs 对齐:1-3 个键、单键只允许 F1-F24、
// 规范化顺序 Ctrl+Alt+Shift+Super+主键。本地只做形态预检(即时中文提示),
// **正式判定以 Rust 为准**(未知键名只有插件解析器认得出来,由命令返回中文原因)。
export const DEFAULT_HOTKEY = 'ctrl+shift+q';
export const HOTKEY_KEY = 'input_hotkey';

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'super'] as const;
const MOD_ALIASES: Record<string, string> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  super: 'super',
  cmd: 'super',
  command: 'super',
  meta: 'super',
};
/** 单个按键只允许功能键(避免把全系统的普通键劫持成全局热键) */
const SINGLE_FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/;
/** 主键名的形态:字母/数字/插件规范名(space、numpadadd…);具体合法性交给 Rust */
const MAIN_KEY_SHAPE = /^[a-z0-9]{1,16}$/;
/** 插件别名归一:KeyQ -> q、Digit5 -> 5(与 Rust 的规范名一致) */
const KEY_ALIAS = /^key([a-z])$/;
const DIGIT_ALIAS = /^digit([0-9])$/;

function canonicalMainKey(token: string): string {
  const lower = token.toLowerCase();
  return KEY_ALIAS.exec(lower)?.[1] ?? DIGIT_ALIAS.exec(lower)?.[1] ?? lower;
}
/** 修饰键自身的 DOM code:按下修饰键时不算按下了主键 */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** 键名片段 -> 规范化加速键;形态非法返回 null */
export function normalizeParts(parts: string[]): string | null {
  const tokens = parts.map((p) => p.trim()).filter((p) => p !== '');
  if (tokens.length === 0 || tokens.length > 3) return null;
  const mods: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const mod = MOD_ALIASES[token.toLowerCase()];
    if (mod) {
      if (!mods.includes(mod)) mods.push(mod);
      continue;
    }
    const key = canonicalMainKey(token);
    if (!MAIN_KEY_SHAPE.test(key)) return null;
    keys.push(key);
  }
  if (keys.length !== 1) return null;
  if (tokens.length === 1 && !SINGLE_FUNCTION_KEY.test(keys[0])) return null;
  return [...MOD_ORDER.filter((m) => mods.includes(m)), keys[0]].join('+');
}

/** 加速键字符串 -> 规范化;非法返回 null */
export function normalizeAccelerator(raw: string): string | null {
  return normalizeParts(raw.split('+'));
}

/** 读库值 -> 规范化,缺失/非法一律回退默认(H1) */
export function effectiveAccelerator(raw: string | null | undefined): string {
  return (raw === null || raw === undefined ? null : normalizeAccelerator(raw)) ?? DEFAULT_HOTKEY;
}

const MOD_LABELS: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Super',
};
/** 常见命名键的中文/惯用写法;未列出的键名(字母数字)统一大写 */
const KEY_LABELS: Record<string, string> = {
  space: '空格',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: '上',
  arrowdown: '下',
  arrowleft: '左',
  arrowright: '右',
};

/** 加速键字符串 -> 界面文案(非法值按默认键显示) */
export function formatAccelerator(raw: string): string {
  return formatKeys(normalizeAccelerator(raw) ?? DEFAULT_HOTKEY);
}

/** 按键片段 -> 界面文案(不校验、不回退:录制态原样展示用户刚按下的组合) */
export function formatKeys(raw: string): string {
  return raw
    .split('+')
    .filter((part) => part !== '')
    .map((part) => MOD_LABELS[part] ?? KEY_LABELS[part] ?? part.toUpperCase())
    .join(' + ');
}

/** DOM code -> 键名片段(KeyQ -> q、Digit5 -> 5、Space -> space;修饰键 code 返回 null) */
export function keyNameFromCode(code: string): string | null {
  if (MODIFIER_CODES.has(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(code)) return code.toLowerCase();
  return null;
}

/** 录制态的按键事件(只取需要的字段,便于单测) */
export interface KeyEventLike {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
}

/** 按键事件 -> 键名片段(修饰键在前,主键在后) */
export function partsFromEvent(e: KeyEventLike): string[] {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('super');
  const key = keyNameFromCode(e.code);
  if (key) parts.push(key);
  return parts;
}

/** 录制态的中文即时提示;'' 表示本地预检通过(仍需 Rust 最终判定) */
export function hotkeyHint(parts: string[]): string {
  const tokens = parts.map((p) => p.trim()).filter((p) => p !== '');
  if (tokens.length === 0) return '请按下快捷键';
  if (tokens.length > 3) return '最多支持 3 个键的组合';
  const isMod = (t: string): boolean => MOD_ALIASES[t.toLowerCase()] !== undefined;
  const main = tokens.filter((t) => !isMod(t));
  if (main.length === 0) return '还需要一个主键(如 Q 或 F5)';
  if (main.length > 1) return '只能有一个主键';
  if (tokens.length === 1 && !SINGLE_FUNCTION_KEY.test(canonicalMainKey(main[0]))) {
    return '单个按键只允许 F1-F24';
  }
  return '';
}
