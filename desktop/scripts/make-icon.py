#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成桌面应用图标（纯标准库，无需第三方依赖）。

输出：
  desktop/build/icon.png    1024×1024 源图，供Linux与Windows打包使用
  desktop/build/icon.icns   macOS图标，由iconutil从iconset合成

图形与网页界面保持一致：近黑色圆角方块（#1a1a1a）＋白色上升折线（余额趋势）＋绿色端点（状态正常）。
用法：python3 desktop/scripts/make-icon.py
"""

import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

SIZE = 1024
BG = (26, 26, 26)
LINE = (255, 255, 255)
ACCENT = (23, 134, 74)
CORNER_RADIUS = 224

# 折线节点（画布坐标），自左下向右上，表示余额上升
POLYLINE = [(286, 672), (438, 522), (552, 592), (742, 372)]
STROKE_RADIUS = 30
DOT_RADIUS = 64


# ---------------------------------------------------------------- 几何工具

def rounded_rect_sdf(x, y, half_w, half_h, radius):
    """圆角矩形的有符号距离：内部为负、外部为正。"""
    qx = abs(x) - (half_w - radius)
    qy = abs(y) - (half_h - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def segment_sdf(x, y, ax, ay, bx, by, radius):
    """带圆角端点的线段（胶囊体）有符号距离。"""
    pax, pay = x - ax, y - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * t, pay - bay * t) - radius


def coverage(distance):
    """把有符号距离转换成0到1的抗锯齿覆盖率。"""
    return max(0.0, min(1.0, 0.5 - distance))


# ---------------------------------------------------------------- 绘制

def blend(buf, index, rgb, alpha):
    if alpha <= 0:
        return
    inv = 1.0 - alpha
    for c in range(3):
        buf[index + c] = int(round(buf[index + c] * inv + rgb[c] * alpha))
    buf[index + 3] = max(buf[index + 3], int(round(255 * alpha)))


def render():
    buf = bytearray(SIZE * SIZE * 4)
    half = SIZE / 2.0
    segments = [(POLYLINE[i], POLYLINE[i + 1]) for i in range(len(POLYLINE) - 1)]
    dot_x, dot_y = POLYLINE[-1]

    for py in range(SIZE):
        y = py + 0.5 - half
        for px in range(SIZE):
            x = px + 0.5 - half
            cx = px + 0.5
            cy = py + 0.5
            index = (py * SIZE + px) * 4

            bg_alpha = coverage(rounded_rect_sdf(x, y, half, half, CORNER_RADIUS))
            if bg_alpha <= 0:
                continue
            blend(buf, index, BG, bg_alpha)

            line_dist = min(segment_sdf(cx, cy, a[0], a[1], b[0], b[1], STROKE_RADIUS) for a, b in segments)
            dot_dist = math.hypot(cx - dot_x, cy - dot_y) - DOT_RADIUS
            shape_dist = min(line_dist, dot_dist)
            if shape_dist < 0.5:
                shape_alpha = coverage(shape_dist)
                blend(buf, index, LINE if line_dist <= dot_dist else ACCENT, shape_alpha)

    return buf


def write_png(path, buf):
    raw = bytearray()
    stride = SIZE * 4
    for row in range(SIZE):
        raw.append(0)
        raw += buf[row * stride:(row + 1) * stride]

    def chunk(tag, data):
        payload = tag + data
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(png)


def make_icns(png_path, icns_path):
    work_dir = tempfile.mkdtemp(prefix='balance-iconset-')
    iconset = os.path.join(work_dir, 'icon.iconset')
    os.makedirs(iconset)
    specs = [
        ('icon_16x16.png', 16), ('icon_16x16@2x.png', 32),
        ('icon_32x32.png', 32), ('icon_32x32@2x.png', 64),
        ('icon_128x128.png', 128), ('icon_128x128@2x.png', 256),
        ('icon_256x256.png', 256), ('icon_256x256@2x.png', 512),
        ('icon_512x512.png', 512), ('icon_512x512@2x.png', 1024),
    ]
    for name, size in specs:
        subprocess.run(['sips', '-z', str(size), str(size), png_path, '--out', os.path.join(iconset, name)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns_path], check=True)
    shutil.rmtree(work_dir)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, 'build')
    os.makedirs(out_dir, exist_ok=True)
    png_path = os.path.join(out_dir, 'icon.png')
    icns_path = os.path.join(out_dir, 'icon.icns')
    print('正在绘制图标…')
    write_png(png_path, render())
    print(f'已生成：{png_path}')
    if sys.platform == 'darwin':
        make_icns(png_path, icns_path)
        print(f'已生成：{icns_path}')


if __name__ == '__main__':
    main()
