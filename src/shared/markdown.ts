import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { enableTaskCheckboxes } from './md-task';

/**
 * 代码高亮:识别语言则返回自带 hljs 类名的 pre/code 包装
 * (markdown-it 对以 <pre 开头的返回值原样直用);否则返回空串,
 * 交回 markdown-it 转义兜底(仍带 language-x 类名)。
 */
function highlight(code: string, lang: string): string {
  const name = lang.trim().split(/\s+/)[0].toLowerCase();
  if (name && hljs.getLanguage(name)) {
    try {
      const value = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
      return `<pre class="hljs"><code class="hljs language-${name}">${value}</code></pre>`;
    } catch {
      /* 高亮异常走转义兜底 */
    }
  }
  return '';
}

/** 单例管线:GFM 表格/删除线(默认 preset 内建)+ 任务列表只读复选框 */
const md = new MarkdownIt({
  html: false, // 禁 raw html,所有源码统一转义
  linkify: true,
  typographer: false,
  highlight,
})
  .use(taskLists, { enabled: false }) // 默认禁用复选框;读视图解禁+标序号见 enableTaskCheckboxes(md-task.ts)
  // markdown-it 删除线 token 为 s_open/s_close(默认输出 <s>);对齐 VSCode 预览改用 <del>
  .use((m) => {
    m.renderer.rules.s_open = () => '<del>';
    m.renderer.rules.s_close = () => '</del>';
  });

/** URI 白名单:仅 http(s)/mailto;javascript:/data:/相对路径一并剥离 */
const ALLOWED_URI = /^(?:https?:|mailto:)/i;

/**
 * 所有 <a> 强制新窗口 + 隔离 opener。仅靠属性不够(webview 可忽略 target),
 * 组件层还会拦截点击走系统浏览器(见 main-window/MarkdownBody.tsx);
 * 这里保证任何消费净化产物的地方都拿不到"可同窗导航"的链接。
 * 注:hook 在属性白名单校验之后执行,故不受 ALLOWED_URI_REGEXP 影响。
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer noopener');
  }
});

/**
 * DOMPurify 配置。注意:ALLOWED_URI_REGEXP 会被套用到**非 inert** 属性上
 * (值必须长得像白名单 URI),故 type/start 这类普通属性
 * 必须显式登记为 inert(ADD_URI_SAFE_ATTR),否则被误删
 * (如 `<ol start="3">` 的 start 被剥掉后从 1 重新编号)。
 * class 无需 ADD_ATTR:已在 DOMPurify 默认属性白名单与 inert 属性集合中。
 */
const PURIFY = {
  ADD_URI_SAFE_ATTR: ['type', 'start'],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
};

/** 净化已渲染 HTML(独立导出便于测试与二次净化场景) */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY);
}

/** Markdown 文本 -> 安全 HTML;300ms 防抖不在本层,由组件自行节流 */
export function renderMarkdown(text: string): string {
  return sanitize(md.render(text));
}

/**
 * 交互态渲染(笔记流读视图):与 renderMarkdown 同一管线,
 * 额外给任务列表复选框按文档顺序标上 data-task-index 并解开 disabled;
 * renderMarkdown 自身仍是只读产物(sanitize 后无序号),供需要纯预览的调用方使用。
 */
export function renderMarkdownInteractive(text: string): string {
  return enableTaskCheckboxes(renderMarkdown(text));
}
