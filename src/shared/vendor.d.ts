// 第三方包类型垫片:markdown-it-task-lists 无官方类型,
// 且 markdown-it@15 自带 typings 优先于 @types/markdown-it(故后者已移除)。
// 内置类型里没有 MarkdownIt.PluginSimple,这里按实际调用形态声明为
// markdown-it 的 plugin 签名 `(md, ...params) => void`,用 unknown 占位 md。
declare module 'markdown-it-task-lists' {
  const plugin: (
    md: unknown,
    opts?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }
  ) => void;
  export default plugin;
}
