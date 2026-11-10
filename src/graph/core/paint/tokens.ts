/** 宿主注入的主题令牌读取器（原生读 CSS 变量，Obsidian 插件读 body 上的计算样式）。 */
export type Token = (name: string) => string;

let current: Token = () => '#888888';

export function setToken(fn: Token) {
  current = fn;
}

export function token(name: string): string {
  return current(name);
}
