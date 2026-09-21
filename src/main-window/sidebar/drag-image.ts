/**
 * 自定义拖拽图像(T6,按 VS Code `.monaco-drag-image`):圆角胶囊、面板底色、边框、阴影,
 * 内容 = 被拖标签名,偏移 (-10,-10);下一 tick 从文档里移除(系统已拷走位图)。
 * 宿主挂到 body 而不挂源行,避免行在拖拽中被卸载时连带移除图像。
 * 类名写成字面量:tailwind 扫描本文件即可生成这些工具类(不能动态拼类名)。
 */
export const DRAG_IMAGE_CLASS =
  'pointer-events-none fixed left-0 top-0 z-[1000] flex max-w-[120px] items-center truncate ' +
  'rounded-full border border-border bg-raised px-2 py-0.5 text-xs text-text shadow-lg';

/** 建胶囊并把位图交给系统拖拽回路 */
export function attachDragImage(dataTransfer: DataTransfer, text: string): void {
  const img = document.createElement('div');
  img.className = DRAG_IMAGE_CLASS;
  img.textContent = text;
  document.body.appendChild(img);
  dataTransfer.setDragImage(img, -10, -10);
  window.setTimeout(() => img.remove(), 0);
}
