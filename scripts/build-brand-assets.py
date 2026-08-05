from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/brand/agent-record-logo-source.png"
BRAND_DIR = ROOT / "assets/brand"
EXTENSION_DIR = ROOT / "extension/icons"
STUDIO_DIR = ROOT / "studio/public/brand"
# Next.js 站点的静态资源必须位于 public 下，旧版 website/assets 不会被部署。
WEBSITE_DIR = ROOT / "website/public/assets"


def contain(image: Image.Image, size: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    return image


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


source = Image.open(SOURCE).convert("RGBA")
alpha_bbox = source.getchannel("A").getbbox()
if alpha_bbox is None:
    raise RuntimeError("Logo 没有可见内容")

glyph = source.crop(alpha_bbox)
glyph_color = Image.new("RGBA", glyph.size, (10, 10, 10, 0))
glyph_color.putalpha(glyph.getchannel("A"))
glyph = glyph_color

logo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
logo_glyph = contain(glyph, 760)
logo.alpha_composite(
    logo_glyph,
    ((1024 - logo_glyph.width) // 2, (1024 - logo_glyph.height) // 2),
)
save_png(logo, BRAND_DIR / "agent-record-logo.png")

app_icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
background = Image.new("RGBA", app_icon.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(background)
draw.rounded_rectangle(
    (64, 64, 960, 960),
    radius=208,
    fill=(255, 255, 255, 255),
    outline=(10, 10, 10, 255),
    width=28,
)
app_icon.alpha_composite(background)
icon_glyph = contain(glyph, 576)
app_icon.alpha_composite(
    icon_glyph,
    ((1024 - icon_glyph.width) // 2, (1024 - icon_glyph.height) // 2),
)
save_png(app_icon, BRAND_DIR / "agent-record-app-icon.png")

for size in (16, 32, 48, 128):
    save_png(
        app_icon.resize((size, size), Image.Resampling.LANCZOS),
        EXTENSION_DIR / f"icon{size}.png",
    )

save_png(app_icon.resize((32, 32), Image.Resampling.LANCZOS), STUDIO_DIR / "icon-32.png")
save_png(app_icon.resize((180, 180), Image.Resampling.LANCZOS), STUDIO_DIR / "icon-180.png")
save_png(app_icon.resize((256, 256), Image.Resampling.LANCZOS), STUDIO_DIR / "app-icon.png")
save_png(logo, STUDIO_DIR / "logo.png")
save_png(app_icon.resize((64, 64), Image.Resampling.LANCZOS), WEBSITE_DIR / "app-icon.png")
save_png(logo, WEBSITE_DIR / "logo.png")

print("品牌资源已生成")
