import type { Note } from '../shared/types';

export function RecentList({ notes, onPick }: { notes: Note[]; onPick: (n: Note) => void }) {
  if (notes.length === 0) {
    return <div className="px-3 py-2 text-xs text-gray-300">暂无记录</div>;
  }
  return (
    <div className="max-h-44 overflow-y-auto border-t border-gray-100">
      {notes.map((n) => (
        <button
          key={n.id}
          onClick={() => onPick(n)}
          className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-gray-100"
          title={n.content}
        >
          <span className="text-gray-400 mr-1 shrink-0">{n.created_at.slice(5, 16)}</span>
          {n.tags.length > 0 && (
            <span className="text-blue-500 mr-1">{n.tags.map((t) => `#${t}`).join(' ')}</span>
          )}
          {n.content}
        </button>
      ))}
    </div>
  );
}
