# Свої спрайти для демо

Демо-сторінка (`/demo-packs.html?manifest`) читає `sprites/manifest.json` і замінює персонажів вашими PNG
(піксельарт, 16×16 або 32×16, прозоре тло). Приклад:

```json
{ "characters": { "knight": { "png": "sprites/knight.png" }, "wizard": { "png": "sprites/wizard.png" } } }
```
Імена: knight, lumberjack, wizard, smith, farmer, hunter, miner, rogue, villager, dwarf. Файли кладіть у `public/sprites/`.
