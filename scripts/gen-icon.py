"""LifeLog 应用图标生成器(设计源;输出 1024x1024 PNG,再由 pnpm tauri icon 派生全套)。

视觉语言参考瑞幸咖啡的图标:深蓝实底 + 纯白极简剪影 + 无渐变无阴影的高对比扁平风。
图形本身是自有的:一条信息流从底部汇聚、向上分成两支并各带一个节点 —— 对应本软件的
"统一信息流 + 层级标签"两个核心概念(不是鹿的剪影,避免撞商标)。

用法:python scripts/gen-icon.py src-tauri/icons/source.png   (需要 Pillow)
然后:pnpm tauri icon src-tauri/icons/source.png 派生全套尺寸/ico/icns
设计源另见 docs/icon.svg(同一套几何,可缩放,README 里用它)
"""
import sys

from PIL import Image, ImageDraw

S = 4  # 超采样倍数:先在 4 倍画布上画,最后 LANCZOS 缩到 1024,边缘才够干净
N = 1024
BLUE = (0, 45, 98, 255)      # 深蓝实底(瑞幸品牌蓝同一色域)
WHITE = (255, 255, 255, 255)
STROKE = 84                  # 主线宽(1024 坐标系):16px 下约 1.3px,再细就糊了
RADIUS = 230                 # 圆角半径(squircle)
SCALE = 1.2                  # 图形整体放大(围绕 MARK_CENTER):留白太多会显得没精神
MARK_CENTER = (512, 524)     # 图形视觉中心(略高于几何中心:底部的汇聚点更重)


def bezier(p0, p1, p2, p3, steps=160):
    """三次贝塞尔采样成点列(够密即可当折线画,配合圆头圆角就是平滑描边)"""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def stroke(draw, pts, width):
    """用"沿路径密集画圆"的方式描边:天然圆头 + 圆角转折,不依赖 join 参数"""
    r = width / 2
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=WHITE)


def main(out_path):
    img = Image.new('RGBA', (N * S, N * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # ① 深蓝圆角实底(整块出血,Windows 任务栏下最稳)
    d.rounded_rectangle((0, 0, N * S - 1, N * S - 1), radius=RADIUS * S, fill=BLUE)

    def sc(pts):
        """把 1024 设计坐标整体缩放/平移到画布中心,再乘超采样倍数"""
        out = []
        for x, y in pts:
            x = MARK_CENTER[0] + (x - MARK_CENTER[0]) * SCALE
            y = MARK_CENTER[1] + (y - MARK_CENTER[1]) * SCALE
            out.append((x * S, y * S))
        return out

    fork = (474, 566)
    # ② 主干:从左下汇聚到分叉点
    stem = bezier((318, 758), (352, 646), (412, 604), fork)
    # ③ 左支与右支:向上分叉,像河道三角洲,也像标签层级的两支
    left = bezier(fork, (498, 478), (458, 388), (398, 300))
    right = bezier(fork, (548, 528), (638, 492), (716, 366))
    for path in (stem, left, right):
        stroke(d, sc(path), STROKE * S)

    # ④ 三个节点:底端一个、两个分支末端各一个(圆点 = 一条记录/一个标签)
    for (cx, cy), r in (((318, 758), 48), ((398, 300), 48), ((716, 366), 48)):
        (x0, y0), (x1, y1) = sc([(cx - r, cy - r)])[0], sc([(cx + r, cy + r)])[0]
        d.ellipse((x0, y0, x1, y1), fill=WHITE)

    img = img.resize((N, N), Image.LANCZOS)
    img.save(out_path)
    # 自检读数:白色像素占比与四角是否为底蓝(便于无图环境核对)
    px = img.load()
    white = sum(1 for y in range(0, N, 4) for x in range(0, N, 4) if px[x, y][:3] == (255, 255, 255))
    total = len(range(0, N, 4)) ** 2
    print(f'输出 {out_path} | {img.size} | 白像素占比 {white / total * 100:.1f}%')
    print('取样:中心', px[512, 512][:3], '| 主干', px[360, 700][:3], '| 左上角', px[8, 8][:3], '| 右上角', px[N - 8, 8][:3])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'icon-1024.png')
