/**
 * 编辑态源码合成:正文 + 换行追加 #标签。
 * note.content 是已剥离标签的正文,编辑时补回 #标签 供用户查看/修改(保存时后端重新剥离)。
 * 用换行而非空格追加:否则正文以围栏代码块结尾时 ` #tag` 会落在闭合围栏行上,
 * 使围栏失效并让实时预览吞掉余下内容。
 */
export function composeSource(content: string, tags: string[]): string {
  const body = content.trim();
  const tagLine = tags.map((t) => '#' + t).join(' ');
  if (!tagLine) return body;
  return body ? `${body}\n${tagLine}` : tagLine;
}
