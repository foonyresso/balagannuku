import { SECTOR_CELLS, SECTOR_SIZE, type BuildingKind } from '../shared';
import { hasVacancy, slotsOf, getSectorRt, nodeTile, ratePerSec, residents, NODE_STONE, NODE_TREE, type Resident, type SimWorld } from '../sim';
import { MAX_WORKERS, STORAGE_CAP } from '../sim/balance';
import { NPC_STATS, NPC_STAT_BASE, NPC_STAT_COUNT, PERKS, hasPerk } from '../shared';
import { nameOf } from './names';

/** Що виділено в місті. */
export type Sel =
  | { t: 'npc'; id: number }
  | { t: 'building'; id: number }
  | { t: 'node'; cx: number; cy: number }
  | { t: 'road'; x: number; y: number }
  /** Виділення рамкою: кілька об'єктів одного класу (жителі, споруди або ресурси). */
  | { t: 'group'; items: Sel[] };

export const BUILD_NAMES: Partial<Record<BuildingKind, string>> = {
  townhall: 'Ратуша', warehouse: 'Склад', lumberjack: 'Лісоруб', quarry: 'Кар’єр', sawmill: 'Лісопильня', farm: 'Ферма', hunter: 'Мисливець', fisher: 'Рибалка', house: 'Будинок',
};
export const RES_NAMES: Record<string, string> = { wood: 'Дерево', stone: 'Камінь', planks: 'Дошки', food: 'Їжа' };
export const WHY: Record<string, string> = {
  no_node: 'немає дерев/каменю в секторі', no_storage: 'немає куди віднести (склад?)', storage_full: 'склад повний',
  no_wood: 'немає вільного дерева (резерв під будівництво)', no_path: 'немає шляху', no_food: 'немає їжі (голод)', no_game: 'немає дичини поблизу', no_water: 'немає берега', paused: 'на паузі',
};
export const STATE_TXT: Record<string, string> = {
  free: 'чекає роботу', to_node: 'іде до дерева/каменю', working: 'добуває ресурс', to_home: 'несе сировину до хатинки', processing: 'обтесує',
  carrying: 'несе готове на склад', to_storage_take: 'іде по колоди', to_mill: 'несе колоди на пилораму', milling: 'пиляє',
  planning: 'думає, що робити', waiting: 'стоїть, чекає', no_path: 'стоїть: немає шляху',
};
export const PROF_TXT: Record<string, string> = {
  idle: 'без роботи', lumberjack: 'лісоруб', miner: 'каменяр', sawyer: 'пильщик', carrier: 'носій', smith: 'коваль', hero: 'герой',
};
export const STAGE_TXT = ['', 'витоптана стежка', 'дорога', 'вимощена дорога'];
const OUT: Partial<Record<BuildingKind, 'wood' | 'stone' | 'planks' | 'food'>> = { lumberjack: 'wood', quarry: 'stone', sawmill: 'planks', farm: 'food', hunter: 'food', fisher: 'food' };

const STAT_TXT: Record<string, string> = { walk: 'Швидкість ходьби', carry: 'Вантажопідйомність', gather: 'Швидкість добування', rare: 'Шанс рідкісного ресурсу' };
const PERK_TXT: Record<string, string> = { swift: 'Швидкоходик', porter: 'Носій', woodcutter: 'Лісоруб від природи', stonecutter: 'Каменяр від природи', lucky: 'Щасливчик' };

/** Рядки стат і перків жителя (стати в %, 100 = норма; rare — проміле). */
function statRows(w: SimWorld, id: number): [string, string][] {
  const n = w.state.npcs, out: [string, string][] = [];
  for (let s = 0; s < NPC_STAT_COUNT; s++) {
    const v = n.stats[id * NPC_STAT_COUNT + s];
    out.push([STAT_TXT[NPC_STATS[s]], NPC_STATS[s] === 'rare' ? `${(v / 10).toFixed(1)}%` : `${v}%${v === NPC_STAT_BASE[s] ? '' : v > NPC_STAT_BASE[s] ? ' ▲' : ' ▼'}`]);
  }
  const perks = PERKS.filter((p) => hasPerk(n.perks[id], p)).map((p) => PERK_TXT[p]);
  out.push(['Перки', perks.length ? perks.join(', ') : 'немає']);
  return out;
}

export interface Info {
  title: string;
  kind: string; // тип об'єкта (підзаголовок)
  rows: [string, string][];
  workers?: { id: number; name: string; state: string }[];
  /** Для групи: клікабельний список складових. */
  items?: { sel: Sel; text: string }[]; itemsTitle?: string;
  /** Позиція в тайлах (для камери й рамки). */
  pos: { x: number; y: number };
  /** Для жителя: куди можна призначити (вільні місця) і чи можна зняти з роботи. */
  npc?: number; assign?: { building: number; label: string }[]; canUnassign?: boolean;
  /** Для споруди зі слотами: поточна/макс. кількість працівників (кнопки +/−). */
  slots?: { cur: number; cap: number; max: number };
  canPause?: boolean; paused?: boolean; canDemolish?: boolean; building?: number;
  warn?: boolean;
}

export const stateText = (r: Resident): string => {
  const why = r.why && r.state === 'waiting' ? ` (${WHY[r.why] ?? r.why})` : '';
  return `${STATE_TXT[r.state] ?? r.state}${why}`;
};

/** Позиція виділеного об'єкта в тайлах; null — об'єкта вже немає. */
export function selPos(w: SimWorld, sector: number, sel: Sel): { x: number; y: number } | null {
  const n = w.state.npcs;
  switch (sel.t) {
    case 'npc': return n.alive[sel.id] && n.sector[sel.id] === sector ? { x: n.x[sel.id], y: n.y[sel.id] } : null;
    case 'building': { const b = w.byId.get(sel.id); return b ? { x: b.cell.x + b.size.w / 2, y: b.cell.y + b.size.h / 2 } : null; }
    case 'node': { const t = nodeTile(w.state.world.seed, sector, sel.cx, sel.cy); return { x: t.x + 0.5, y: t.y + 0.5 }; }
    case 'road': return { x: sel.x + 0.5, y: sel.y + 0.5 };
    case 'group': {
      const ps = sel.items.map((i) => selPos(w, sector, i)).filter((p): p is { x: number; y: number } => !!p);
      return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null;
    }
  }
}

/** Дані для вікна інформації про виділене. null — виділене зникло (знесено/помер). */
export function describeSel(w: SimWorld, player: string, sector: number, sel: Sel): Info | null {
  const pos = selPos(w, sector, sel);
  if (!pos) return null;
  if (sel.t === 'group') return describeGroup(w, player, sector, sel.items, pos);
  if (sel.t === 'npc') {
    const r = residents(w, player).find((x) => x.id === sel.id);
    if (!r) return null;
    const n = w.state.npcs, b = r.workplace >= 0 ? w.byId.get(r.workplace) : undefined;
    const rows: [string, string][] = [
      ['Професія', PROF_TXT[r.profession] ?? r.profession],
      ['Робота', b ? `${BUILD_NAMES[b.kind]} #${b.id}` : 'немає'],
      ['Зараз', stateText(r)],
      ['Несе', r.carry ? `${r.carry} × ${RES_NAMES[r.carryKind ?? ''] ?? r.carryKind}${r.processed ? ' (оброблене)' : ''}` : 'нічого'],
      ['Здоровʼя', `${n.hp[sel.id]}`],
      ['Рівень', `${n.level[sel.id]}`],
      ...statRows(w, sel.id),
    ];
    const assign = w.state.buildings
      .filter((x) => x.owner === player && x.sector === sector && x.id !== r.workplace && hasVacancy(x))
      .map((x) => ({ building: x.id, label: `${BUILD_NAMES[x.kind]} #${x.id} (${x.workers.length}/${slotsOf(x)})` }));
    return { title: nameOf(w, sel.id), kind: 'Житель', rows, pos, warn: r.state === 'no_path', npc: sel.id, assign, canUnassign: r.workplace >= 0 };
  }
  if (sel.t === 'building') {
    const b = w.byId.get(sel.id)!, max = MAX_WORKERS[b.kind] ?? 0, cap = slotsOf(b), out = OUT[b.kind];
    const rows: [string, string][] = [];
    const starved = w.state.flows.last.byBuilding[b.id]?.starved ?? 0;
    let status = 'Працює';
    if (b.progress < 1) status = `Будується ${Math.round(b.progress * 100)}%`;
    else if (b.paused) status = 'На паузі';
    else if (cap && !b.workers.length) status = 'Простій: немає працівників';
    else if (starved > 20) status = `Простій: ${WHY[w.why.get(b.id) ?? ''] ?? 'нестача'}`;
    else if (!max) status = 'Стоїть';
    else if (!cap) status = 'Місць для працівників не відкрито';
    rows.push(['Стан', status]);
    if (max) {
      rows.push(['Працівники', `${b.workers.length}/${cap} (макс. ${max})`]);
      if (cap) rows.push(['Ефективність', `${Math.round((b.workers.length / cap) * 100)}%`]);
    }
    if (out) rows.push(['Виробіток', `${RES_NAMES[out]} ${ratePerSec(w, b.id, 'produced', out).toFixed(2)}/с`]);
    if (b.kind === 'sawmill') rows.push(['Споживає', `Дерево ${ratePerSec(w, b.id, 'consumed', 'wood').toFixed(2)}/с`]);
    const scap = STORAGE_CAP[b.kind];
    if (scap) {
      const st = Object.entries(b.stock).filter(([, v]) => v).map(([k, v]) => `${RES_NAMES[k] ?? k} ${v}`).join(', ');
      rows.push(['Склад', `${st || 'порожній'}${scap >= 1e8 ? ' (безкінечний)' : ` (місткість ${scap})`}`]);
    } else if (Object.values(b.stock).some((v) => v)) {
      rows.push(['Запас', Object.entries(b.stock).filter(([, v]) => v).map(([k, v]) => `${RES_NAMES[k] ?? k} ${v}`).join(', ')]);
    }
    rows.push(['Дорога', b.roadAttached ? 'прикріплена (+швидкість)' : 'немає']);
    rows.push(['Розмір', `${b.size.w}×${b.size.h} тайлів`]);
    const names = new Map(residents(w, player).map((r) => [r.id, r]));
    const workers = b.workers.map((id) => ({ id, name: nameOf(w, id), state: names.get(id) ? stateText(names.get(id)!) : '' }));
    return {
      title: `${BUILD_NAMES[b.kind] ?? b.kind} #${b.id}`, kind: 'Споруда', rows, workers, pos, building: b.id,
      slots: max && b.progress >= 1 ? { cur: b.workers.length, cap, max } : undefined,
      canPause: b.kind === 'sawmill', paused: !!b.paused, canDemolish: b.kind !== 'townhall', warn: status.startsWith('Простій'),
    };
  }
  if (sel.t === 'node') {
    const rt = getSectorRt(w, sector), i = sel.cy * SECTOR_CELLS + sel.cx, tree = rt.kind[i] === NODE_TREE;
    if (rt.kind[i] !== NODE_TREE && rt.kind[i] !== NODE_STONE) return null;
    const grown = rt.amount[i] > 0;
    return {
      title: tree ? 'Дерево' : 'Камінь', kind: 'Ресурс', pos,
      rows: [
        ['Стан', grown ? (tree ? 'росте' : 'ціла брила') : (tree ? 'зрубане, відростає' : 'розбите, відновлюється')],
        ['Запас', 'безкінечний'],
        ['Добуває', rt.claimBy[i] ? nameOf(w, rt.claimBy[i] - 1) : 'ніхто'],
      ],
    };
  }
  if (sel.t !== 'road') return null;
  const rt = getSectorRt(w, sector), st = rt.stage[sel.y * SECTOR_SIZE + sel.x];
  return { title: STAGE_TXT[st] ? STAGE_TXT[st][0].toUpperCase() + STAGE_TXT[st].slice(1) : 'Земля', kind: st ? 'Дорога' : 'Земля', rows: [['Тайл', `${sel.x}, ${sel.y}`]], pos };
}

const tally = (xs: string[]): string => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ');
};

/** Зведення по виділеній рамкою групі: скільки їх, види/стани, список для вибору одного. */
function describeGroup(w: SimWorld, player: string, sector: number, items: Sel[], pos: { x: number; y: number }): Info | null {
  const live = items.filter((i) => selPos(w, sector, i));
  if (!live.length) return null;
  const first = live[0].t, rows: [string, string][] = [], list: { sel: Sel; text: string }[] = [];
  if (first === 'npc') {
    const res = new Map(residents(w, player).map((r) => [r.id, r]));
    const rs = live.map((i) => res.get((i as { id: number }).id)).filter((r): r is Resident => !!r);
    rows.push(['Жителів', String(rs.length)], ['Професії', tally(rs.map((r) => PROF_TXT[r.profession] ?? r.profession))], ['Стани', tally(rs.map((r) => STATE_TXT[r.state] ?? r.state))]);
    for (const r of rs) list.push({ sel: { t: 'npc', id: r.id }, text: `${nameOf(w, r.id)} · ${PROF_TXT[r.profession] ?? r.profession}: ${stateText(r)}` });
  } else if (first === 'building') {
    const bs = live.map((i) => w.byId.get((i as { id: number }).id)).filter((b): b is NonNullable<typeof b> => !!b);
    rows.push(['Споруд', String(bs.length)], ['Види', tally(bs.map((b) => BUILD_NAMES[b.kind] ?? b.kind))]);
    const cap = bs.reduce((a, b) => a + slotsOf(b), 0);
    if (cap) rows.push(['Працівники', `${bs.reduce((a, b) => a + b.workers.length, 0)}/${cap}`]);
    for (const b of bs) list.push({ sel: { t: 'building', id: b.id }, text: `${BUILD_NAMES[b.kind] ?? b.kind} #${b.id}: ${b.progress < 1 ? `будується ${Math.round(b.progress * 100)}%` : `працівників ${b.workers.length}/${slotsOf(b)}`}` });
  } else {
    const rt = getSectorRt(w, sector);
    const kinds = live.map((i) => (i.t === 'node' ? (rt.kind[i.cy * SECTOR_CELLS + i.cx] === NODE_TREE ? 'Дерево' : 'Камінь') : '?'));
    rows.push(['Ресурсів', String(live.length)], ['Види', tally(kinds)]);
    live.forEach((i, k) => list.push({ sel: i, text: `${kinds[k]} (${i.t === 'node' ? `${i.cx}, ${i.cy}` : ''})` }));
  }
  const title = first === 'npc' ? 'Виділено жителів' : first === 'building' ? 'Виділено споруд' : 'Виділено ресурсів';
  return { title: `${title}: ${live.length}`, kind: 'Група (клікни рядок, щоб вибрати одного)', rows, pos, items: list.slice(0, 120), itemsTitle: 'Склад групи' };
}
