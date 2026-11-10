// Obsidian 视图：canvas + graph-core（与 LifeLog 软件同一份布局/绘制代码）。
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { radialLayout } from './core/layout/radial';
import { fitToView } from './core/camera/camera';
import { drawPlan } from './core/draw/graph-draw-plan';
import { NO_EMPHASIS } from './core/draw/graph-focus';
import { paint } from './core/paint/paint';
import { setToken } from './core/paint/tokens';
import type { GraphData } from './core/types/graph';

export const VIEW_TYPE = 'lifelog-graph';
const LAYER_GAP = 90;

function cssToken(name: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || '#888888';
}

export class GraphItemView extends ItemView {
  private data: GraphData | null = null;
  private canvas: HTMLCanvasElement | null = null;

  private source: () => Promise<GraphData>;

  constructor(leaf: WorkspaceLeaf, source: () => Promise<GraphData>) {
    super(leaf);
    this.source = source;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '拾枝关系图';
  }

  async onOpen(): Promise<void> {
    setToken(cssToken);
    const root = this.contentEl;
    root.empty();
    root.style.padding = '0';
    this.canvas = root.createEl('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.data = await this.source();
    this.draw();
    this.registerDomEvent(window, 'resize', () => this.draw());
  }

  async setData(data: GraphData): Promise<void> {
    this.data = data;
    this.draw();
  }

  draw(): void {
    const el = this.canvas;
    const data = this.data;
    if (!el || !data) return;
    const w = el.parentElement?.clientWidth ?? 800;
    const h = el.parentElement?.clientHeight ?? 600;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const points = radialLayout(data.nodes, { layerGap: LAYER_GAP });
    const cam = fitToView([...points.values()], w, h);
    const rootColor = new Map<number, string>();
    for (const n of data.nodes) if (n.depth === 1) rootColor.set(n.id, cssToken('--color-accent'));
    const plan = drawPlan({
      nodes: data.nodes,
      edges: data.edges,
      points,
      cam,
      w,
      h,
      rootColor,
      fallbackColor: cssToken('--color-border-strong'),
      emphasis: NO_EMPHASIS,
    });
    paint(ctx, plan, w, h);
  }
}
