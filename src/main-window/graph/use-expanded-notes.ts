/**
 * 展开条目(G2 Task 6):把一个标签下的笔记取回来,算成画布要画的那圈小圆。
 * 「展开」是就地看这批笔记的落点,不把图换成笔记视图。
 *
 * **取数**:`queryNotes(expandedConditions(path), 0)` —— 条件对象与信息流**同一份形状**
 * (从 `defaultFilterState()` 出发只覆盖 `tags`),这样「图里展开的笔记」与
 * 「点筛到信息流后的结果」是同一批;页大小由后端定(50 条),够覆盖 `NOTE_LIMIT` 个圆。
 * 只取第一页:第二页在 G2 没有消费者(单条定位是 G3 的事)。
 *
 * **条数口径**:总数取 `GraphNode.notes`(**含子孙**去重,与侧栏计数同源;展开的是"这一支的全部") ,
 * `noteFan` 内部按 `NOTE_LIMIT` 封顶,略去的条数交给 `+N`。取数结果的用处是三件事:
 * ① 确认这批笔记真的取得出来 —— 标签刚改名/合并而图数据还没重拉时库里可能是空的,
 * 照 `node.notes` 画就是一圈点不出东西的幽灵圆;② 知道最多画得出几个圆;
 * ③ 给每个圆带上**笔记实体 id**(L4 的 link 边靠它在两个圆之间连线)。
 * 因此取到 0 条时一个圆都不画(而不是画满 20 个)。
 *
 * **坐标**:对外全是**屏幕坐标**(先把标签落点过一遍 `screenOf`,半径直接用屏幕像素)
 * —— G3 起笔记小圆与标签点同口径:不随相机缩放,`k=0.2` 时不会缩进标签点里面。
 * 点小圆的命中吃 client 坐标,故 `onNoteClick` 拿容器原点现算(命中容差 `NOTE_R + HIT_SLOP`,
 * 与 `graph-hit` 对标签点的口径一致:G2 只做「带着该标签回信息流」,单条定位留给 G3)。
 * `+N` 提示位的命中不在这里(它画在标签环外偏下,归 `use-graph-interactions` 的单击分支),但那一份
 * 提示位与这里的是**同一个对象**(带 `id`,见 `layer`)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { GraphNode } from '../../shared/types';
import { defaultFilterState } from '../filter/filter-state';
import { screenOf, type Camera } from './graph-camera';
import { radiusOf, type NoteDot } from './graph-draw-plan';
import { HIT_SLOP } from './graph-hit';
import { noteFan, NOTE_R, type NoteSpace } from './graph-notes';
import type { Point } from './radial';

/** 小圆离标签圆心的间距(屏幕像素:标签点与笔记小圆都在屏幕口径) */
const FAN_GAP = 14;

/**
 * 展开条目的查询条件:与信息流同一份形状,只有 `tags` 收窄到该路径。
 * `includeChildren: true` 与 `node.notes`(含子孙)和「筛到信息流」(侧栏点标签)同口径
 * —— 三处必须一起动,否则图里展开的那批会与筛过去的结果对不上。
 */
export function expandedConditions(path: string): FilterConditions {
  return { ...defaultFilterState(), tags: [{ path, includeChildren: true }] };
}

/** 一次取数的读数:失败也留痕(空数组分不出"库里没有"与"压根没问到");
 *  `ids` 是第一页笔记的 id(顺序 = 小圆顺序):L4 的 link 边靠它认出小圆是哪个条目 */
interface PageRead {
  id: number;
  ok: boolean;
  ids: number[];
}

/**
 * 递进 `drawPlan` 与命中的展开层。**身份稳定是硬要求**:内容不变就是同一个对象
 * —— 每次渲染新建对象会让 plan 的 memo 白重建(见 use-graph-plan 的依赖说明)。
 */
export interface ExpandedLayer {
  /** 展开的标签 id */
  id: number;
  /** 小圆的坐标口径(恒为屏幕):别在下游猜 */
  space: NoteSpace;
  /** 笔记小圆(屏幕坐标 + 笔记实体 id:L4 的 link 边要在它们之间连线) */
  dots: NoteDot[];
  /** 略去的条数提示位(屏幕坐标,标签环外偏下,带所属标签 id);没有略去时为 null */
  overflow: { id: number; x: number; y: number; n: number } | null;
}

export interface ExpandedNotesApi {
  /** 没展开 / 取不到笔记时为 null(一个圆都不画,也不留一个点不出东西的提示位) */
  layer: ExpandedLayer | null;
  loading: boolean;
  failed: boolean;
  /** 点中小圆返回 true(上层据此不再当画布点击 —— 那会先把选中清掉) */
  onNoteClick: (e: { clientX: number; clientY: number }) => boolean;
}

export function useExpandedNotes(input: {
  /** 当前展开的标签;null = 没展开(不发请求) */
  node: GraphNode | null;
  /** 标签落点(世界坐标:相机叠加记忆位置之后的那一份) */
  points: Map<number, Point>;
  cam: Camera;
  /** 容器左上角的视口位置(命中要把 client 坐标换算进画布) */
  origin: () => Point;
  /** 点中笔记小圆:带着该标签回信息流 */
  onFilterToStream: (path: string) => void;
}): ExpandedNotesApi {
  const { node, points, cam, origin, onFilterToStream } = input;
  const id = node?.id ?? null;
  const path = node?.path ?? null;
  const [read, setRead] = useState<PageRead | null>(null);

  useEffect(() => {
    if (id === null || path === null) return; // 没展开就不发请求
    let alive = true;
    void api.queryNotes(expandedConditions(path), 0).then(
      (rows) => {
        if (alive) setRead({ id, ok: true, ids: rows.map((r) => r.id) });
      },
      () => {
        if (alive) setRead({ id, ok: false, ids: [] });
      },
    );
    return () => {
      alive = false; // 换对象/收起后迟到的回包不碰状态
    };
  }, [id, path]);

  // 读数只认当前展开的那个标签:换了对象就当还没回包(渲染期归零,不留一帧错配)
  const cur = read !== null && read.id === id ? read : null;

  const layer = useMemo((): ExpandedLayer | null => {
    const p = node === null ? undefined : points.get(node.id);
    if (node === null || p === undefined || cur === null || !cur.ok) return null;
    const total = Math.max(node.notes, 0);
    // 屏幕口径:标签点先换成屏幕坐标,半径也是屏幕像素 —— 小圆不随相机缩放
    const f = noteFan({
      center: screenOf(p, cam),
      count: total,
      radius: radiusOf(total) + FAN_GAP,
      space: 'screen',
    });
    // 只画真取到的小圆(取不到的笔记没有实体;取到 0 条就是一圈都不画),
    // 并把**笔记实体 id** 带到每个圆上:第 i 个圆就是第一页第 i 个条目,两者同一顺序
    // (有了它,L4 的 link 边才能从"两个笔记实体 id"找到两个画得出来的落点)
    const dots: NoteDot[] = f.dots
      .slice(0, cur.ids.length)
      .map((d, i) => ({ id: cur.ids[i], x: d.x, y: d.y }));
    if (dots.length === 0) return null;
    // `+N` 画在环外偏下,身份得跟着层走:命中它的人要知道带哪个标签回信息流
    return { id: node.id, space: f.space, dots, overflow: f.overflow === null ? null : { ...f.overflow, id: node.id } };
  }, [node, points, cam, cur]);

  const onNoteClick = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (layer === null || path === null) return false;
      const o = origin();
      const reach = NOTE_R + HIT_SLOP;
      // 小圆已经是屏幕坐标:直接拿 client 减原点的画布坐标比距离,不再过相机
      const hit = layer.dots.some(
        (d) => Math.hypot(d.x - (e.clientX - o.x), d.y - (e.clientY - o.y)) <= reach,
      );
      if (hit) onFilterToStream(path);
      return hit;
    },
    [layer, origin, onFilterToStream, path],
  );

  return { layer, loading: id !== null && cur === null, failed: cur !== null && !cur.ok, onNoteClick };
}
