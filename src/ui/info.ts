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
  | { t: 'road'; x: number; y: number };

export const BUILD_NAMES: Partial<Record<BuildingKind, string>> = {
  townhall: 'Ратуша', warehouse: 'Склад', lumberjack: 'Лісоруб', quarry: 'Кар’єр', sawmill: 'Лісопильня', farm: 'Ферма', house: 'Будинок',
};
export const RES_NAMES: Record<string, string> = { wood: 'Дерево', stone: 'Камінь', planks: 'Дошки', food: 'Їжа' };
export const WHY: Record<string, string> = {
  no_node: 'немає дерев/каменю в секторі', no_storage: 'немає куди віднести (склад?)', storage_full: 'склад повний',
  no_wood: 'немає вільного дерева (резерв під будівництво)', no_path: 'немає шляху', no_food: 'немає їжі (голод)', paused: 'на паузі',
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
const OUT: Partial<Record<BuildingKind, 'wood' | 'stone' | 'planks' | 'food'>> = { lumberjack: 'wood', quarry: 'stone', sawmill: 'planks', farm: 'food' };

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
  }
}

/** Дані для вікна інформації про виділене. null — виділене зникло (знесено/помер). */
export function describeSel(w: SimWorld, player: string, sector: number, sel: Sel): Info | null {
  const pos = selPos(w, sector, sel);
  if (!pos) return null;
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
  const rt = getSectorRt(w, sector), st = rt.stage[sel.y * SECTOR_SIZE + sel.x];
  return { title: STAGE_TXT[st] ? STAGE_TXT[st][0].toUpperCase() + STAGE_TXT[st].slice(1) : 'Земля', kind: st ? 'Дорога' : 'Земля', rows: [['Тайл', `${sel.x}, ${sel.y}`]], pos };
}
