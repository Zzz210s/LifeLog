/** 阻止 OS 文件拖入把 webview 导航到 file://。
 *  dragDropEnabled:false 后(wry 不再吞外部拖放),Chromium 默认会把文件当导航目标,
 *  界面会被替换成文件内容;内部标签/视图拖拽不 setData,types 为空,不受影响。 */
export function installFileDropGuard(): void {
  for (const type of ['dragover', 'drop'] as const) {
    window.addEventListener(type, (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
  }
}
