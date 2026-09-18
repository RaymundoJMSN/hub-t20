"""Gera os ícones do PWA (static/icone-192.png, icone-512.png, icone-maskable-512.png) com Pillow.
Vinho escuro do tema, borda dourada, "T20" na fonte Tormenta20 (static/fontes, fora do git).
python tools/gerar-icones.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
STATIC = RAIZ / "static"
FUNDO, PAINEL, OURO, SANGUE = (18, 8, 9), (36, 19, 23), (201, 162, 39), (226, 56, 62)


def icone(tamanho: int, margem: float) -> Image.Image:
    img = Image.new("RGBA", (tamanho, tamanho), FUNDO + (255,))
    d = ImageDraw.Draw(img)
    m = int(tamanho * margem)
    raio = int(tamanho * 0.18)
    d.rounded_rectangle((m, m, tamanho - m, tamanho - m), radius=raio, fill=PAINEL, outline=OURO, width=max(2, tamanho // 48))
    fonte = None
    for nome in ("Tormenta20.ttf", "IowanBold.otf"):
        try:
            fonte = ImageFont.truetype(str(STATIC / "fontes" / nome), int(tamanho * (0.42 - margem)))
            break
        except OSError:
            continue
    fonte = fonte or ImageFont.load_default()
    texto = "T20"
    caixa = d.textbbox((0, 0), texto, font=fonte)
    w, h = caixa[2] - caixa[0], caixa[3] - caixa[1]
    x, y = (tamanho - w) / 2 - caixa[0], (tamanho - h) / 2 - caixa[1]
    d.text((x + tamanho * 0.012, y + tamanho * 0.012), texto, font=fonte, fill=(0, 0, 0, 200))
    d.text((x, y), texto, font=fonte, fill=SANGUE)
    return img


if __name__ == "__main__":
    icone(192, 0.04).save(STATIC / "icone-192.png")
    icone(512, 0.04).save(STATIC / "icone-512.png")
    icone(512, 0.16).save(STATIC / "icone-maskable-512.png")  # zona segura do círculo do Android
    print("ícones gerados em", STATIC)
