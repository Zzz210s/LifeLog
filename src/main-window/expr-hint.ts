/**
 * 表达式语法速查表数据(spec 3.5 对话框里的「语法速查」区,单独成文件便于纯函数断言)。
 * 内容与后端实际行为一致(`crate::expr` 的 lexer/parser/validate):
 * 位置与长度等硬性约束不放这里,由验证命令与本地长度检查负责。
 */

/** 六类形式与含义(form 文案被测试逐条锁定,改动需同步更新 ExprDialog.test.ts) */
export const SYNTAX_HINTS: { form: string; meaning: string }[] = [
  { form: '#路径', meaning: '标签,含该标签及其全部子级(如 #工作 命中 工作/项目A)' },
  { form: '#=路径', meaning: '标签,仅本级,不含子级(如 #=工作 只命中挂在 工作 上的笔记)' },
  { form: '裸词 / "短语"', meaning: '关键词,同时匹配正文与标签;引号内不能为空' },
  {
    form: 'date>=2026-09-01',
    meaning: '按时间标签比较:>、>=、=、<=、< 五种;只认小写 date,日期为 YYYY-MM-DD',
  },
  { form: 'AND / OR / NOT', meaning: '与 / 或 / 非;&& || ! 完全等价,且大小写不敏感' },
  { form: '( ) 分组', meaning: '改变优先级:非 > 与 > 或' },
];

/** 速查表的补充说明(审查发现的实际行为,容易踩坑的几条) */
export const SYNTAX_NOTES: string[] = [
  '裸的 & | ! 会终止关键词(如 a&b 只会按 a 匹配);要搜含这些符号的字面量请用引号,如 "C++"',
  '标签名内可以含 . · 等内嵌标点(如 v1.0、工作·复盘),但必须夹在名称字符之间',
  '表达式与其它筛选条件同时生效(按与组合);最多 500 字符',
];

/** 可直接点填的示例(均由后端校验通过) */
export const EXAMPLES: string[] = [
  '#工作 AND NOT #临时',
  '(#工作 OR #生活) AND NOT #=临时',
  '#工作 AND date>=2026-09-01',
  '"买牛奶" OR #生活/购物',
];
