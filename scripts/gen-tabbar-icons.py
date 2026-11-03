# Requires Pillow: python -m pip install Pillow
from PIL import Image, ImageDraw
from pathlib import Path

# 仓内相对路径（跨平台：以脚本位置定位仓库根）
out = Path(__file__).resolve().parent.parent / "src" / "assets" / "tabbar"
out.mkdir(parents=True, exist_ok=True)


def icon(name, draw_fn, selected=False, dark=False):
    size = 81
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if dark:
        color = (34, 211, 238, 255) if selected else (163, 163, 173, 255)
    else:
        color = (71, 82, 168, 255) if selected else (107, 107, 118, 255)
    draw_fn(d, size, color)
    suffix = ("-dark" if dark else "") + ("-active" if selected else "")
    img.save(out / f"{name}{suffix}.png")


def home(d, s, c):
    d.polygon([(s // 2, 9), (10, s // 2 - 4), (s - 10, s // 2 - 4)], outline=c, width=5)
    d.rectangle([18, s // 2 - 4, s - 18, s - 12], outline=c, width=5)
    d.rectangle([s // 2 - 6, s - 24, s // 2 + 6, s - 12], outline=c, width=4)


def club(d, s, c):
    d.ellipse([12, 16, s - 12, s - 16], outline=c, width=5)
    d.ellipse([s // 2 - 9, 27, s // 2 + 9, 45], outline=c, width=4)
    d.arc([20, 47, s - 20, s - 25], 200, 340, fill=c, width=5)


def roi(d, s, c):
    d.rectangle([15, s - 38, 29, s - 18], outline=c, width=4)
    d.rectangle([s // 2 - 7, s - 50, s // 2 + 7, s - 18], outline=c, width=4)
    d.rectangle([s - 29, s - 34, s - 15, s - 18], outline=c, width=4)
    d.line([12, s - 12, s - 12, s - 12], fill=c, width=4)


def me(d, s, c):
    d.ellipse([s // 2 - 13, 15, s // 2 + 13, 42], outline=c, width=5)
    d.arc([18, 43, s - 18, s - 7], 200, 340, fill=c, width=5)


def task(d, s, c):
    # 清单板：外框 + 三行勾选项
    d.rounded_rectangle([16, 10, s - 16, s - 10], radius=9, outline=c, width=5)
    for i, y in enumerate((28, 42, 56)):
        d.line([28, y, 39, y], fill=c, width=4)
        if i < 2:
            d.line([25, y, 30, y + 4], fill=c, width=4)
            d.line([30, y + 4, 37, y - 4], fill=c, width=4)


for name, fn in [("home", home), ("task", task), ("roi", roi), ("club", club), ("me", me)]:
    for dark in (False, True):
        icon(name, fn, False, dark)
        icon(name, fn, True, dark)
print("ok", sorted(p.name for p in out.iterdir()))
