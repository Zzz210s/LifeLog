/**
 * 视图图标白名单(spec 4):图标名是入库的稳定键(如 inbox),这里显式映射到 lucide 组件。
 * 用显式映射表而不是 `import * as icons`:后者会把整套图标打进 bundle(spec 8 风险项)。
 * 白名单外 / null 一律返回 null(不渲染、不报错);名字即 lucide 组件名的 kebab 形式,便于核对。
 * 注:lucide-react 1.46 没有 CheckSquare / History / Home 导出,清单里对应项改用
 * square-check / hourglass / house(库里其余名字逐一对得上组件)。
 */
import type { ComponentType, ReactNode } from 'react';
import {
  Archive, Book, Bookmark, Briefcase, Calendar, CalendarDays, Camera, Circle, Clock, Code, Coffee,
  Dumbbell, FileText, Film, Flag, Folder, FolderOpen, Gamepad2, GraduationCap, HeartPulse, Hourglass,
  House, Inbox, Library, List, ListChecks, Map, Moon, Music, Notebook, Plane, ShoppingCart, SquareCheck,
  Star, Sun, Tag, Tags, User, Users, Utensils, Zap,
} from 'lucide-react';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** 精选图标名:顺序即选择器网格顺序(约 40 个贴合个人记录场景) */
export const VIEW_ICON_NAMES: readonly string[] = [
  'inbox', 'list', 'list-checks', 'square-check', 'circle', 'star', 'flag', 'bookmark', 'tag', 'tags',
  'folder', 'folder-open', 'file-text', 'notebook', 'book', 'library', 'calendar', 'calendar-days',
  'clock', 'hourglass', 'sun', 'moon', 'coffee', 'utensils', 'shopping-cart', 'dumbbell', 'heart-pulse',
  'plane', 'map', 'music', 'film', 'gamepad-2', 'camera', 'code', 'briefcase', 'graduation-cap',
  'house', 'user', 'users', 'zap', 'archive',
];

/** 名字 -> 组件(只含白名单;查不到即白名单外,不渲染) */
const ICONS: Record<string, IconComponent> = {
  inbox: Inbox,
  list: List,
  'list-checks': ListChecks,
  'square-check': SquareCheck,
  circle: Circle,
  star: Star,
  flag: Flag,
  bookmark: Bookmark,
  tag: Tag,
  tags: Tags,
  folder: Folder,
  'folder-open': FolderOpen,
  'file-text': FileText,
  notebook: Notebook,
  book: Book,
  library: Library,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  clock: Clock,
  hourglass: Hourglass,
  sun: Sun,
  moon: Moon,
  coffee: Coffee,
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  dumbbell: Dumbbell,
  'heart-pulse': HeartPulse,
  plane: Plane,
  map: Map,
  music: Music,
  film: Film,
  'gamepad-2': Gamepad2,
  camera: Camera,
  code: Code,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  house: House,
  user: User,
  users: Users,
  zap: Zap,
  archive: Archive,
};

export interface ViewIconProps {
  /** 图标名(入库值);null / 白名单外 -> 不渲染 */
  name: string | null;
  className?: string;
}

/** 侧栏视图行与选择器共用的图标渲染:白名单外一律返回 null,不占位也不报错 */
export function ViewIcon(p: ViewIconProps): ReactNode {
  const Icon = p.name === null ? undefined : ICONS[p.name];
  return Icon ? <Icon className={p.className} aria-hidden={true} /> : null;
}

/** 选择器点选语义:点未选中的项 -> 选中它;再点同一项(已选中)-> 清空(null) */
export function nextIconValue(current: string | null, clicked: string | null): string | null {
  return clicked !== null && clicked === current ? null : clicked;
}
