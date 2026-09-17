/**
 * 设置页「笔记」分区的数据层(spec 2026-09-17 D4/D5,纯函数 + 设置键):
 * `auto_time_tag` 控制新建笔记是否自动加时间标签;`time_tag_template` 决定加什么路径。
 * 读取失败或非法值一律回默认;模板校验的真源是后端命令 `validate_time_tag_template`
 * (与创建路径共用 timetag::validate_template),前端只把结果翻译成中文提示。
 */

/** 保存时自动带时间标签(默认开) */
export const AUTO_TIME_TAG_KEY = 'auto_time_tag';
/** 自动时间标签的路径模板(默认三段年/月/日) */
export const TIME_TAG_TEMPLATE_KEY = 'time_tag_template';
/** 默认模板,与 Rust `timetag::DEFAULT_TEMPLATE` 一致 */
export const DEFAULT_TIME_TAG_TEMPLATE = '时间排序/{y}/{m}/{d}';

/** 'false' 之外的值(空、拼写、类型)一律回默认 true(默认开) */
export function parseAutoTimeTag(raw: string | null): boolean {
  return raw !== 'false';
}

/** 空串/纯空白(未设过)回默认模板;非空值原样保留(前后空白由后端校验判定) */
export function normalizeTemplate(raw: string | null): string {
  const text = raw ?? '';
  return text.trim() === '' ? DEFAULT_TIME_TAG_TEMPLATE : text;
}

/** 模板校验结果 -> 是否落库与界面提示;非法一律不落库(避免把坏模板写进库) */
export function templateVerdict(errorText: string | null): { save: boolean; message: string } {
  return errorText === null
    ? { save: true, message: '模板合法,已保存' }
    : { save: false, message: `模板不合法:${errorText}(未保存)` };
}
