interface Props {
  pinned: boolean;
  zoom: number;
  onTogglePin: () => void;
  onHide: () => void;
}

export function HeaderControls({ pinned, zoom, onTogglePin, onHide }: Props) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center gap-2 px-2 py-1 text-xs text-gray-400 select-none bg-gray-50"
    >
      <span data-tauri-drag-region className="flex-1 font-medium">快捷输入</span>
      <span>{Math.round(zoom * 100)}%</span>
      <button onClick={onTogglePin} className="hover:text-gray-800" title="切换置顶">
        {pinned ? '[置顶]' : '[浮动]'}
      </button>
      <button onClick={onHide} className="hover:text-gray-800" title="隐藏 (Esc)">
        收起
      </button>
    </div>
  );
}
