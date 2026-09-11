// 第三方包类型垫片(无官方 types 的包)
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const taskLists: MarkdownIt.PluginSimple;
  export default taskLists;
}
