"""Збирає src/assets/atlas.png: сітка 16 колонок × 16px. Індекс: Tiny Town = n (0..131), Tiny Dungeon = 132 + n.
Запуск: python3 -I scripts/build-atlas.py (потрібен Pillow). Джерела: assets/kenney/*/ (CC0, Kenney)."""
from PIL import Image
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
N, COLS = 132, 16
atlas = Image.new('RGBA', (COLS * 16, ((2 * N + COLS - 1) // COLS) * 16))
for base, pack in ((0, 'tiny-town'), (N, 'tiny-dungeon')):
    for n in range(N):
        im = Image.open(os.path.join(root, 'assets/kenney', pack, 'tile_%04d.png' % n)).convert('RGBA')
        i = base + n
        atlas.paste(im, ((i % COLS) * 16, (i // COLS) * 16))
atlas.save(os.path.join(root, 'src/assets/atlas.png'), optimize=True)
