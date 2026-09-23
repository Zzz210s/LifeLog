/**
 * 主键名表:与 Rust 侧真源逐条对齐(global-hotkey 0.8 的 `parse_key` 别名表 +
 * keyboard-types 0.7 的规范名)。两侧必须一致 —— TS 放行 Rust 不认的键名,录制器就会
 * 把「按了没反应」的死键写进库;TS 拒绝 Rust 认得的键,用户又录不进合法组合。
 *
 * 漂移探测:`fixtures/hotkey-spec.json` 的 `mainKeys` 被两侧测试同时读取 ——
 * TS(`hotkey-keys.test.ts`)断言本表集合与它逐条相等,Rust(`hotkey_fixtures_tests.rs`)
 * 断言每个名字喂回 `hotkey_spec::check` 后仍是自身(即表里没有 Rust 不认的名字)。
 *
 * 只做形态与别名归一(未知键名 -> null);「单键只允许 F1-F24」等组合规则在 hotkey-display。
 */
const TABLE = [
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `${c} key${c}`),
  ...'0123456789'.split('').map((d) => `${d} digit${d}`),
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  'backquote `',
  'backslash \\',
  'bracketleft [',
  'bracketright ]',
  'comma ,',
  'equal =',
  'minus -',
  'period .',
  "quote '",
  'semicolon ;',
  'slash /',
  'pause pausebreak',
  'backspace',
  'capslock',
  'enter',
  'space',
  'tab',
  'delete',
  'end',
  'home',
  'insert',
  'pagedown',
  'pageup',
  'printscreen',
  'scrolllock',
  'numlock',
  'arrowdown down',
  'arrowleft left',
  'arrowright right',
  'arrowup up',
  ...Array.from({ length: 10 }, (_, i) => `numpad${i} num${i}`),
  'numpadadd numadd numpadplus numplus',
  'numpaddecimal numdecimal',
  'numpaddivide numdivide',
  'numpadenter numenter',
  'numpadequal numequal',
  'numpadmultiply nummultiply',
  'numpadsubtract numsubtract',
  'escape esc',
  'audiovolumedown volumedown',
  'audiovolumeup volumeup',
  'audiovolumemute volumemute',
  'mediaplay',
  'mediapause',
  'mediaplaypause',
  'mediastop',
  'mediatracknext',
  'mediatrackprevious mediatrackprev',
];

/** 别名 -> 规范名(每行第一个词是规范名,其余是插件解析器同样认识的别名) */
const ALIASES = new Map<string, string>();
for (const line of TABLE) {
  const [canonical, ...rest] = line.split(' ');
  ALIASES.set(canonical, canonical);
  for (const alias of rest) ALIASES.set(alias, canonical);
}

/** 全部规范主键名(升序;fixture 的 `mainKeys` 用同一序比对) */
export const MAIN_KEY_NAMES: readonly string[] = [
  ...new Set(TABLE.map((line) => line.split(' ')[0])),
].sort();

/** 键名(含插件别名与大小写混写)-> 规范名;Rust 不认的键名返回 null */
export function canonicalMainKey(token: string): string | null {
  return ALIASES.get(token.trim().toLowerCase()) ?? null;
}
