# Перенесення старих гілок на нову структуру

Великі файли розрізано (крок 2). Гілки, створені до цього, правлять файли, яких більше немає, тому `git merge` чи `rebase` дасть конфлікт «змінено / видалено». Цей файл каже, куди переїхав кожен шматок. Коли всі гілки нижче перенесено або відкинуто, файл можна видалити.

## Як переносити
1. Нова гілка від свіжого `main`. Стару гілку не зливай.
2. Нові файли старої гілки забирай цілком: `git checkout origin/<гілка> -- <шлях>`, потім поклади в каталог за новою структурою й виправ імпорти.
3. Зміни в розрізаних файлах дивись по одному файлу: `git diff <база>...origin/<гілка> -- src/sim/step.ts`. Кожен шматок переноси у файл із таблиць нижче.
4. Додай нові файли в `CLAUDE.md` каталогу, запусти `npm run check -- --fast`, перед PR повний `npm run check`.

## Куди переїхав код

### `src/sim/step.ts`
| Було | Стало |
|---|---|
| `PHASE`, індекси `WOOD`, `MINER`, `ST_WALK`, `T('walk')` | `sim/jobs/consts.ts` (`T(...)` тепер `taskId(...)`) |
| `mul`, `hungerEff`, `workTicks`, `richOf`, `wait`, `spotNear` | `sim/jobs/common.ts` |
| `isStorage`, `stockOf`, `capOf` | `sim/stock.ts` |
| `setPath`, `advance` | `sim/jobs/move.ts` |
| `nearestStorage`, `nearestAcceptor`, `planDeposit`, `case WALK_DEPOSIT` | `sim/jobs/logistics.ts` |
| `findNode`, `claimedByOther`, хвіст `plan` (добувач), `case WALK_NODE / WORK_NODE / WALK_HOME / WORK_HOME` | `sim/jobs/gather.ts` (`planGather`, `walkNode`, `workNode`, `walkHome`, `workHome`) |
| `fieldSpot`, `planFarmer`, `case FARM_WALK / FARM_WORK` | `sim/jobs/farm.ts` |
| `biggestStock`, `planCarrier`, `case CARRY_PICK / CARRY_DROP` | `sim/jobs/carrier.ts` |
| `planSawyer`, `startMill`, `case WALK_TAKE / WALK_MILL / WORK_MILL` | `sim/jobs/sawmill.ts` |
| `planEat`, `isFoodJob`, `case EAT`, спад ситості в `stepWorld` | `sim/jobs/eat.ts` (`hungerTick`) |
| `plan` (вибір за професією), `stepNpc` | `sim/jobs/npc.ts` |
| `stepOn`, `decayTrails`, `updateRoadAttached`, групування `trail_stage_changed` | `sim/systems/trails.ts` |
| `regrow` | `sim/systems/growth.ts` (`growthTick`) |
| `houses`, `countPop` | `sim/systems/population.ts` (`housesTick`) |
| `syncPlayerResources` | `sim/systems/resources.ts` |
| `stepWorld` | `sim/step.ts` (лише порядок викликів) |

Кожен `case` у `stepNpc` став функцією типу `JobFn`; `break` усередині став `return`.

### `src/sim/balance.ts`
Став каталогом `sim/balance/`, імпорти `from './balance'` працюють як раніше.

| Було | Стало |
|---|---|
| `COSTS`, `FOOTPRINT`, `SOLID_RECT`, `MAX_WORKERS`, `DEFAULT_WORKERS`, `JOB_OF`, `STORAGE_CAP` | поля записів таблиці `BUILDINGS` у `balance/buildings.ts` (ці мапи тепер похідні, руками їх не правимо) |
| `*_TICKS`, `CARRY_CAP`, `CARRIER_CAP`, `WORK_RADIUS`, `MILL_BUFFER`, `WOOD_RESERVE`, `FARM_*`, `FISH_*` | `balance/work.ts` |
| `NPC_*`, `POP_*`, `START_*`, `HOUSE_SPAWN_INTERVAL`, їжа й голод | `balance/people.ts` |
| `TREE_*`, `STONE_*` | `balance/nature.ts` |
| `ROAD_*`, `TRAIL_DECAY_BY_STAGE` | `balance/trails.ts` |

### `src/sim/economy.test.ts`
Помічники (`setup`, `place`, `run`, `hall`, `free`, `mk`) переїхали в `sim/testkit.ts`. Тести розкладено: логістика й склади в `jobs/logistics.test.ts`, добувачі й полювання в `jobs/gather.test.ts`, їжа, ферма й риболовля в `jobs/food.test.ts`, стежки в `systems/trails.test.ts`, слоти й призначення в `assign.test.ts`, маршрути в `route.test.ts`. У `economy.test.ts` лишились наскрізні.

### `src/render/cityView.ts`
Став каталогом `render/city/`. Поля класу розійшлись на `Scene` (`scene.cam`, `scene.rows`, `scene.rowCont`, `scene.atmo`, `scene.parts`, `scene.animT`) і `Ui` (`ui.build` замість `selected`, `ui.sel`, `ui.hover`, `ui.following`, `ui.speed`).

| Було (метод `CityView`) | Стало |
|---|---|
| константи `TILE`, `NB`, `BUCKET`, `Obj`, `quad` | `city/scene.ts` (ряд шару глибини тепер `rowOf(y)`) |
| конструктор (порядок шарів), `draw`, `simulate`, `rebuild`, `setBuild`, `select`, `setSpeed`, `debugState` | `city/view.ts` |
| `key`, `move`, `down`, `up`, `wheel`, `showBox`, `boxSelect` | `city/input.ts` |
| `cmd`, `addWorker`, `assignTo`, `anchor`, розміщення споруди з `up`, хуки `CityHud` | `city/actions.ts` |
| `applyCam`, зум із `wheel`, `followCam` | `city/camera.ts` |
| `pickTile`, `pickSel`, `npcScreen`, `npcXY`, `posOf`, добір об'єктів у `boxSelect` | `city/picking.ts` |
| `frame_` | `city/frames.ts` (`drawFrame`) |
| `drawWater`, `drawShine` | `city/water.ts` |
| `drawFog` | `city/fog.ts` |
| `rebuildGround`, `groundDirty` | `city/roads.ts` (`Roads.redrawIfDirty`, `roads.dirty`) |
| `nodeObj`, `nodeObj0` | `city/nodes.ts` |
| `buildingObjs`, `smokers`, `fieldLayer` | `city/buildings.ts`, `city/layers.ts` |
| інкрементальна частина `rebuild`, `signature`, `cull` | `city/layers.ts` (`DepthLayers`) |
| `drawNpcs`, `NpcVis` | `city/npcs.ts` |
| `drawFishing` | `city/fishingFx.ts` |
| `emitHit`, `emitAmbient` | `city/fx.ts` (`emitHit`, `emitSmoke`) |

`render/surroundings.ts`, `render/buildingGhost.ts`, `render/fishing.ts` переїхали в `render/city/` без змін.

## Гілки, що чекають перенесення
База — коміт `main`, від якого гілка відходить (для `git diff <база>...origin/<гілка>`).

### Звірі й полювання: `claude/project-thread-3sd4bf`, база `ccf333b`
- `sim/fauna.ts` стає `sim/systems/fauna.ts` (звірі живуть самі), виклик зі `stepWorld`.
- Стрільба мисливця зі `stepNpc` і `planEat`: новий файл `sim/jobs/hunt.ts` із власними фазами замість гілки в добувачах; мисливця прибрати з `gather.ts`.
- `render/fauna.ts` стає `render/city/fauna.ts`, виклик у `view.ts` (`draw`), спрайти звірів у шарах глибини через `scene.rowCont[rowOf(y)]`.
- `shared/fauna.ts`, `shared/state.ts`, `shared/save.ts`: контракт змінює форму стану, тож `SAVE_VERSION` піднімай від поточного значення в `main`, а не від того, що в гілці.
- `scripts/smoke-fauna.cjs` підхопиться `check.cjs` сам.

### Вогнище для вільних NPC: `claude/project-thread-2fglph`, база `ccf333b`
- `sim/camp.ts` стає `sim/systems/camp.ts` (слоти біля вогнища, бродіння вільних), рядок у `stepWorld`.
- Вільний NPC зараз обробляється на початку `stepNpc` (`if (!b)`) у `sim/jobs/npc.ts`: туди йде виклик бродіння.
- Зміни `world.ts` (`NpcRt`), `commands.ts` (`checkPlace`, `startCity`), `assign.ts`, `npcs.ts` лягають у ті самі файли.
- Якщо вогнище — споруда, вона стає записом у `BUILDINGS`.

### LOD, колихання дерев і трави: `claude/project-thread-m7l8rt`, база `c14cf04`
- `render/lod.ts` і `render/grassLayer.ts` стають `render/city/lod.ts` і `render/city/grassLayer.ts`.
- Рівень деталізації від зуму рахується раз на кадр у `view.ts` (`draw`) і передається частинам; відсікання й дерева — `city/layers.ts` і `city/nodes.ts`, спрощення жителів — `city/npcs.ts`.
- Гілка старіша за дороги-капсули й риболовлю: зміни в малюванні землі звіряй із `city/roads.ts`.

### Рубка дерев і ріст стадіями: `claude/project-thread-hngzt5`, база `ccf333b`
- Стадії росту замість `regrow`: `sim/systems/growth.ts`.
- Вибір лише дорослих дерев у `findNode` і три дерева за рейс: `sim/jobs/gather.ts`, числа в `sim/balance/nature.ts` і `sim/balance/work.ts`.
- Подія падіння дерева (`shared/net.ts`) піднімає `NET_PROTOCOL_VERSION`.
- Падіння, пеньки, стадії у вигляді: `render/city/nodes.ts` (спрайт за стадією) і новий `render/city/treeFall.ts` для анімації; підпис рядка в `city/layers.ts` має враховувати стадію.
- `sim/trees.test.ts` стає `sim/systems/growth.test.ts`, помічники бере з `sim/testkit.ts`.
