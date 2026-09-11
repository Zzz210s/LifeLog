/**
 * 编辑态源码合成:正文 + 换行追加 #标签。
 * note.content 是已剥离标签的正文,编辑时补回 #标签 供用户查看/修改(保存时后端重新剥离)。
 * 用换行而非空格追加:否则正文以围栏代码块结尾时 ` #tag` 会落在闭合围栏行上,
 * 使围栏失效并让实时预览吞掉余下内容。
 * 正文只裁行尾空白(不裁行首):整条笔记是缩进代码块时,整体 trim 会吞掉首行缩进造成往返损失。
 */
export function composeSource(content: string, tags: string[]): string {
  const body = content.trimEnd();
  const tagLine = tags.map((t) => '#' + t).join(' ');
  if (!tagLine) return body;
  return body ? `${body}\n${tagLine}` : tagLine;
}

/**
 * 保存前归一:只裁行尾空白。
 * 不能整体 trim:整条笔记是缩进代码块时,trim 会把首行缩进切掉,使“编辑-保存”往返损失数据。
 */
export function normalizeForSave(source: string): string {
  return source.trimEnd();
}

/**
 * 创建路径保存前准备:纯空白返回 null(拒绝保存),否则只裁行尾空白。
 * 与编辑路径共用归一规则:整体 trim 会吞掉首行缩进(整条笔记是缩进代码块时数据损失)。
 */
export function prepareForSave(source: string): string | null {
  return source.trim() ? normalizeForSave(source) : null;
}
