(function() {
'use strict';

// ==================== CONSTANTS ====================
const RANK_NAME = {3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大'};
const SUIT_SYM = {spade:'♠',heart:'♥',club:'♣',diamond:'♦'};
const SUIT_COLOR = {spade:'black',heart:'red',club:'black',diamond:'red'};
const SUITS = ['spade','heart','club','diamond'];
const PHASE = { DEALING:'dealing', BIDDING:'bidding', PALM_BACK:'palm_back', RPS:'rps', PLAYING:'playing', FINISHED:'finished' };
const NAMES = ['你', '电脑A', '电脑B'];

// 牌面牌总数（用于记牌器）
const TOTAL_BY_RANK = {};
for (let v = 3; v <= 15; v++) TOTAL_BY_RANK[v] = 4;
TOTAL_BY_RANK[16] = 1;   // 小王
TOTAL_BY_RANK[17] = 1;   // 大王
const ALL_RANKS = Object.keys(TOTAL_BY_RANK).map(Number).sort((a, b) => a - b);

// ==================== CARD UTILS ====================
function createCard(suit, value) {
  const id = suit ? `${suit}_${value}` : `joker_${value}`;
  const displayRank = RANK_NAME[value];
  const displaySuit = suit ? SUIT_SYM[suit] : '';
  const color = suit ? SUIT_COLOR[suit] : (value === 17 ? 'red' : 'black');
  const isJoker = value >= 16;
  return { id, suit: suit || null, value, displayRank, displaySuit, color, isJoker };
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let v = 3; v <= 15; v++) deck.push(createCard(suit, v));
  }
  deck.push(createCard(null, 16));
  deck.push(createCard(null, 17));
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ==================== COMBINATION DETECTION ====================
function detectCombination(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const sorted = [...cards].sort((a, b) => a.value - b.value);
  const values = sorted.map(c => c.value);
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const uniqueRanks = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const rankCountEntries = uniqueRanks.map(r => [r, counts[r]]);

  // 王炸
  if (n === 2 && values[0] === 16 && values[1] === 17) return { type: 'rocket', mainRank: 17, length: 1 };
  // 炸弹
  if (n === 4 && uniqueRanks.length === 1 && counts[uniqueRanks[0]] === 4) return { type: 'bomb', mainRank: uniqueRanks[0], length: 1 };
  // 四带二单
  if (n === 6) {
    if (uniqueRanks.filter(r => counts[r] >= 4).length === 1) return { type: 'four_plus_two_singles', mainRank: uniqueRanks.find(r => counts[r] >= 4), length: 1 };
  }
  // 四带两对
  if (n === 8) {
    const qr = uniqueRanks.filter(r => counts[r] >= 4);
    if (qr.length === 1) {
      const taken = { [qr[0]]: 4 };
      const remCounts = {};
      for (const v of values) { if (v === qr[0] && taken[qr[0]] > 0) { taken[qr[0]]--; continue; } remCounts[v] = (remCounts[v] || 0) + 1; }
      const ru = Object.keys(remCounts).map(Number);
      if (ru.length === 2 && remCounts[ru[0]] === 2 && remCounts[ru[1]] === 2) return { type: 'four_plus_two_pairs', mainRank: qr[0], length: 1 };
    }
  }
  // 三带一
  if (n === 4 && uniqueRanks.length === 2) {
    const tr = uniqueRanks.find(r => counts[r] === 3);
    if (tr) return { type: 'three_plus_one', mainRank: tr, length: 1 };
  }
  // 三带二
  if (n === 5 && uniqueRanks.length === 2) {
    const tr = uniqueRanks.find(r => counts[r] === 3);
    const pr = uniqueRanks.find(r => counts[r] === 2);
    if (tr && pr) return { type: 'three_plus_two', mainRank: tr, length: 1 };
  }
  // 三张
  if (n === 3 && uniqueRanks.length === 1 && counts[uniqueRanks[0]] === 3) return { type: 'three', mainRank: uniqueRanks[0], length: 1 };
  // 对子
  if (n === 2 && uniqueRanks.length === 1 && counts[uniqueRanks[0]] === 2) return { type: 'pair', mainRank: uniqueRanks[0], length: 1 };
  // 单张
  if (n === 1) return { type: 'single', mainRank: values[0], length: 1 };
  // 顺子
  if (n >= 5 && uniqueRanks.length === n && uniqueRanks.every(r => r <= 14) && uniqueRanks[n-1] - uniqueRanks[0] === n - 1) {
    return { type: 'straight', mainRank: uniqueRanks[n-1], length: n };
  }
  // 连对
  if (n >= 6 && n % 2 === 0) {
    const pc = n / 2;
    if (uniqueRanks.length === pc && uniqueRanks.every(r => r <= 14 && counts[r] === 2) && uniqueRanks[pc-1] - uniqueRanks[0] === pc - 1) {
      return { type: 'straight_pairs', mainRank: uniqueRanks[pc-1], length: pc };
    }
  }
  // 飞机相关
  const tripleRanks = uniqueRanks.filter(r => counts[r] >= 3 && r <= 14);
  const groups = [];
  let grp = [];
  for (const r of tripleRanks) { if (grp.length === 0 || r === grp[grp.length-1] + 1) grp.push(r); else { if (grp.length >= 2) groups.push([...grp]); grp = [r]; } }
  if (grp.length >= 2) groups.push([...grp]);
  for (const g of groups) {
    for (let len = g.length; len >= 2; len--) {
      for (let s = 0; s <= g.length - len; s++) {
        const planeRanks = g.slice(s, s + len);
        const planeMin = len * 3;
        let planeCards = 0; const nonPlane = [];
        for (const v of values) { if (planeRanks.includes(v) && planeCards < planeMin) planeCards++; else nonPlane.push(v); }
        if (planeCards < planeMin) continue;
        if (nonPlane.length === 0) return { type: 'plane', mainRank: planeRanks[planeRanks.length-1], length: len };
        if (nonPlane.length === len) return { type: 'plane_plus_singles', mainRank: planeRanks[planeRanks.length-1], length: len };
        if (nonPlane.length === 2 * len) {
          const rc = {}; for (const v of nonPlane) rc[v] = (rc[v] || 0) + 1;
          if (Object.values(rc).every(c => c === 2)) return { type: 'plane_plus_pairs', mainRank: planeRanks[planeRanks.length-1], length: len };
        }
      }
    }
  }
  return null;
}

function canBeat(newPlay, lastPlay) {
  if (!lastPlay) return true;
  if (newPlay.type === 'rocket') return true;
  if (lastPlay.type === 'rocket') return false;
  if (newPlay.type === 'bomb') { if (lastPlay.type !== 'bomb') return true; return newPlay.mainRank > lastPlay.mainRank; }
  if (lastPlay.type === 'bomb') return false;
  if (newPlay.type === lastPlay.type && newPlay.length === lastPlay.length) return newPlay.mainRank > lastPlay.mainRank;
  return false;
}

// ==================== COMBO ENUMERATION ====================
function generateCombos(hand) {
  const combos = [];
  const counts = {};
  for (const c of hand) counts[c.value] = (counts[c.value] || 0) + 1;
  const ranks = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const byRank = {};
  for (const c of hand) { if (!byRank[c.value]) byRank[c.value] = []; byRank[c.value].push(c); }

  function push(type, mainRank, length, cards) { if (cards && cards.length) combos.push({ type, mainRank, length, cards }); }

  // 单/对/三/炸
  for (const r of ranks) {
    if (counts[r] >= 1) push('single', r, 1, byRank[r].slice(0, 1));
    if (counts[r] >= 2) push('pair', r, 1, byRank[r].slice(0, 2));
    if (counts[r] >= 3) push('three', r, 1, byRank[r].slice(0, 3));
    if (counts[r] === 4) push('bomb', r, 1, byRank[r].slice(0, 4));
  }
  // 王炸
  if (counts[16] >= 1 && counts[17] >= 1) push('rocket', 17, 1, [byRank[16][0], byRank[17][0]]);

  // 三带一 / 三带二
  for (const r of ranks) {
    if (counts[r] >= 3) {
      const tri = byRank[r].slice(0, 3);
      for (const r2 of ranks) {
        if (r2 === r && counts[r] < 4) continue;
        const skip = (r2 === r) ? 3 : 0;
        if (byRank[r2].length > skip) push('three_plus_one', r, 1, [...tri, byRank[r2][skip]]);
        if (r2 !== r && counts[r2] >= 2) push('three_plus_two', r, 1, [...tri, ...byRank[r2].slice(0, 2)]);
      }
    }
  }
  // 四带二单 / 四带两对
  for (const r of ranks) {
    if (counts[r] === 4) {
      const quad = byRank[r].slice(0, 4);
      const others = [];
      for (const r2 of ranks) { const st = (r2 === r) ? 4 : 0; for (let i = st; i < byRank[r2].length && others.length < 2; i++) others.push(byRank[r2][i]); }
      if (others.length >= 2) push('four_plus_two_singles', r, 1, [...quad, others[0], others[1]]);
      const pairRanks = ranks.filter(r2 => r2 !== r && counts[r2] >= 2);
      if (pairRanks.length >= 2) push('four_plus_two_pairs', r, 1, [...quad, ...byRank[pairRanks[0]].slice(0, 2), ...byRank[pairRanks[1]].slice(0, 2)]);
    }
  }
  // 顺子
  for (let st = 3; st <= 10; st++) {
    for (let len = 5; len <= 14 - st + 1; len++) {
      let ok = true;
      for (let i = st; i < st + len; i++) if (!counts[i] || counts[i] < 1) { ok = false; break; }
      if (ok) { const cards = []; for (let i = st; i < st + len; i++) cards.push(byRank[i][0]); push('straight', st + len - 1, len, cards); }
    }
  }
  // 连对
  for (let st = 3; st <= 12; st++) {
    for (let len = 3; len <= 14 - st + 1; len++) {
      let ok = true;
      for (let i = st; i < st + len; i++) if (!counts[i] || counts[i] < 2) { ok = false; break; }
      if (ok) { const cards = []; for (let i = st; i < st + len; i++) cards.push(...byRank[i].slice(0, 2)); push('straight_pairs', st + len - 1, len, cards); }
    }
  }
  // 飞机（纯 / 带单 / 带对）
  const tripleRanks = ranks.filter(r => counts[r] >= 3 && r <= 14);
  const groups = []; let g2 = [];
  for (const r of tripleRanks) { if (g2.length === 0 || r === g2[g2.length-1] + 1) g2.push(r); else { if (g2.length >= 2) groups.push([...g2]); g2 = [r]; } }
  if (g2.length >= 2) groups.push([...g2]);
  for (const grp2 of groups) {
    for (let len = grp2.length; len >= 2; len--) {
      for (let s = 0; s <= grp2.length - len; s++) {
        const planeRanks = grp2.slice(s, s + len);
        const triCards = []; for (const r of planeRanks) triCards.push(...byRank[r].slice(0, 3));
        push('plane', planeRanks[planeRanks.length-1], len, [...triCards]);
        const usedRanks = new Set(planeRanks);
        const singles = [];
        for (const r of ranks) { const skip = usedRanks.has(r) ? 3 : 0; for (let i = skip; i < byRank[r].length && singles.length < len; i++) singles.push(byRank[r][i]); }
        if (singles.length === len) push('plane_plus_singles', planeRanks[planeRanks.length-1], len, [...triCards, ...singles]);
        const pairCands = ranks.filter(r => usedRanks.has(r) ? counts[r] >= 5 : counts[r] >= 2);
        if (pairCands.length >= len) {
          const pairs = []; for (let i = 0; i < len; i++) { const pr = pairCands[i]; const sti = usedRanks.has(pr) ? 3 : 0; pairs.push(...byRank[pr].slice(sti, sti + 2)); }
          push('plane_plus_pairs', planeRanks[planeRanks.length-1], len, [...triCards, ...pairs]);
        }
      }
    }
  }
  return combos;
}

function comboTypeName(combo) {
  const names = { single:'单张', pair:'对子', three:'三张', three_plus_one:'三带一', three_plus_two:'三带二',
    straight:'顺子', straight_pairs:'连对', plane:'飞机', plane_plus_singles:'飞机带单', plane_plus_pairs:'飞机带对',
    four_plus_two_singles:'四带二', four_plus_two_pairs:'四带两对', bomb:'炸弹', rocket:'王炸' };
  return names[combo.type] || combo.type;
}

// ==================== AI ENGINE ====================
// 思路：静态规则 + 有限搜索 —— 拆牌 → 牌组评分 → 策略栈 → 赢牌路径判定。
// 刻意保留少量随机性，目标是"像中等水平玩家"，而不是不可战胜。
function rankCounts(hand) { const c = {}; for (const k of hand) c[k.value] = (c[k.value] || 0) + 1; return c; }
function cardsByRank(hand) { const m = {}; for (const k of hand) { if (!m[k.value]) m[k.value] = []; m[k.value].push(k); } return m; }
function mkGroup(type, mainRank, length, cards) { return { type, mainRank, length, cards }; }
function liveRanks(cnt) { return Object.keys(cnt).map(Number).filter(r => cnt[r] > 0).sort((a, b) => a - b); }

const TYPE_WEIGHT = { single:1, pair:1.4, three:1.9, three_plus_one:2.1, three_plus_two:2.2, straight:0.7, straight_pairs:1.1,
  plane:1.6, plane_plus_singles:1.8, plane_plus_pairs:1.9, four_plus_two_singles:2.4, four_plus_two_pairs:2.6, bomb:1000, rocket:3000 };
function baseCost(combo) { return (combo.mainRank || 1) * (TYPE_WEIGHT[combo.type] || 1); }

// ---- 牌组评分：越能管牌 / 越难被管，分值越高 ----
const BIG_RANK = 15;   // 2 与王视为大牌
function isBigGroup(g) {
  if (g.type === 'bomb' || g.type === 'rocket') return true;
  return (g.type === 'single' || g.type === 'pair' || g.type === 'three') && g.mainRank >= BIG_RANK;
}
function groupScore(g) {
  if (g.type === 'rocket') return 12;
  if (g.type === 'bomb') return 9;
  const base = g.mainRank - 10;
  switch (g.type) {
    case 'pair': return base > 0 ? base * 1.5 : base;
    case 'three': return base > 0 ? base * 2 : base;
    case 'three_plus_one':
    case 'three_plus_two': return base > 0 ? base * 1.5 : base;
    case 'straight':
    case 'straight_pairs':
    case 'plane':
    case 'plane_plus_singles':
    case 'plane_plus_pairs': return Math.max(0, base / 2);   // 难管牌，但本身也难被管
    default: return base;                                     // 单张
  }
}
// 轮次惩罚：牌组越多越难走完；王/2/炸弹那一轮总能出去，不计入
function roundPenalty(rounds) { return rounds <= 3 ? 6 : rounds <= 6 ? 5 : rounds <= 9 ? 4 : 3; }
function scoreGroups(groups) {
  let sum = 0, rounds = 0;
  for (const g of groups) { sum += groupScore(g); if (!isBigGroup(g)) rounds++; }
  return sum - roundPenalty(rounds) * rounds;
}

// ---- 拆牌：把一手牌拆成"一次能出掉"的牌组 ----
// 固定优先级（王炸→炸弹→飞机→顺子/连对→三张→对子→单张），顺子与连对两种先后顺序各算一遍取高分。
function splitOnce(hand, chainFirst, killSingles) {
  const cnt = rankCounts(hand);
  const by = cardsByRank(hand);
  const groups = [];
  const take = (r, n) => { const cs = by[r].splice(0, n); cnt[r] -= n; if (cnt[r] <= 0) delete cnt[r]; return cs; };

  // 1) 王炸、炸弹不拆
  if (cnt[16] && cnt[17]) groups.push(mkGroup('rocket', 17, 1, [...take(16, 1), ...take(17, 1)]));
  for (const r of liveRanks(cnt)) if (cnt[r] === 4) groups.push(mkGroup('bomb', r, 1, take(r, 4)));

  // 2) 飞机（连续三张 ≥2 连）不拆
  let planeRun = [];
  const flushPlane = () => {
    if (planeRun.length >= 2) {
      const cards = [];
      for (const r of planeRun) cards.push(...take(r, 3));
      groups.push(mkGroup('plane', planeRun[planeRun.length - 1], planeRun.length, cards));
    }
    planeRun = [];
  };
  for (let r = 3; r <= 14; r++) { if (cnt[r] >= 3) planeRun.push(r); else flushPlane(); }
  flushPlane();

  // 3) 2 与王不参与顺子，单独成组
  for (let r = 15; r <= 17; r++) {
    while (cnt[r] >= 3) groups.push(mkGroup('three', r, 1, take(r, 3)));
    if (cnt[r] >= 2) groups.push(mkGroup('pair', r, 1, take(r, 2)));
    if (cnt[r] >= 1) groups.push(mkGroup('single', r, 1, take(r, 1)));
  }

  // 4) 3..14 的每个连续段里抽顺子 / 连对
  const segs = [];
  let seg = [];
  for (let r = 3; r <= 14; r++) { if (cnt[r]) seg.push(r); else { if (seg.length) segs.push(seg); seg = []; } }
  if (seg.length) segs.push(seg);
  const order = chainFirst === 'pairs' ? [['straight_pairs', 2, 3], ['straight', 1, 5]] : [['straight', 1, 5], ['straight_pairs', 2, 3]];
  for (const ranks of segs) {
    for (const [type, per, minLen] of order) {
      for (;;) {
        let best = null;
        for (let i = 0; i < ranks.length; i++) {
          for (let j = ranks.length; j - i >= minLen; j--) {
            let ok = true;
            for (let k = i; k < j; k++) if ((cnt[ranks[k]] || 0) < per) { ok = false; break; }
            if (!ok) continue;
            if (!best || j - i > best[1] - best[0]) best = [i, j];
            break;                                  // j 由大到小，首个可行即该起点下最长
          }
        }
        if (!best) break;
        const picked = ranks.slice(best[0], best[1]);
        const cards = [];
        for (const r of picked) cards.push(...take(r, per));
        groups.push(mkGroup(type, picked[picked.length - 1], picked.length, cards));
      }
    }
  }

  // 5) 剩下的三张 / 对子 / 单张
  for (const r of liveRanks(cnt)) {
    while (cnt[r] >= 3) groups.push(mkGroup('three', r, 1, take(r, 3)));
    if (cnt[r] >= 2) groups.push(mkGroup('pair', r, 1, take(r, 2)));
    if (cnt[r] >= 1) groups.push(mkGroup('single', r, 1, take(r, 1)));
  }

  // 6) 配带牌：三张带一/带二、飞机带单/带对，优先消耗最小的单张或对子
  const singles = groups.filter(g => g.type === 'single').sort((a, b) => a.mainRank - b.mainRank);
  const pairs = groups.filter(g => g.type === 'pair').sort((a, b) => a.mainRank - b.mainRank);
  const eaten = new Set();
  const grab = (pool, n, maxRank) => {
    const got = pool.filter(g => !eaten.has(g) && g.mainRank <= maxRank).slice(0, n);
    if (got.length < n) return null;
    for (const g of got) eaten.add(g);
    return got;
  };
  for (const g of groups) {
    const need = g.type === 'three' ? 1 : g.type === 'plane' ? g.length : 0;
    if (!need) continue;
    const s = grab(singles, need, g.mainRank);
    const p = grab(pairs, need, g.mainRank);
    // killSingles（对手只剩 1 张）时优先用单张当带牌，把手里的单张清干净
    let ks = killSingles ? (s || p) : (!s ? p : !p ? s : (s[0].mainRank <= p[0].mainRank ? s : p));
    if (s && p) { for (const x of (ks === s ? p : s)) eaten.delete(x); }   // 没被选中的那组放回去
    if (!ks) continue;
    g.cards = [...g.cards, ...ks.flatMap(x => x.cards)];
    g.type = ks[0].cards.length === 2
      ? (g.type === 'plane' ? 'plane_plus_pairs' : 'three_plus_two')
      : (g.type === 'plane' ? 'plane_plus_singles' : 'three_plus_one');
  }
  return groups.filter(g => !eaten.has(g));
}

function splitHand(hand, opts) {
  if (!hand.length) return [];
  const killSingles = !!(opts && opts.killSingles);
  let best = null, bestScore = -Infinity;
  for (const chainFirst of ['pairs', 'straight']) {
    const gs = splitOnce(hand, chainFirst, killSingles);
    const s = scoreGroups(gs);
    if (s > bestScore) { bestScore = s; best = gs; }
  }
  return best;
}

// 手牌评分：越高越好（空手=已走完）
function evalHand(cards) { return cards.length ? scoreGroups(splitHand(cards)) : 1e6; }

// 拆散结构代价：抽走某些牌会把手里的对/三/炸弄碎
function structPenalty(selCards, hand) {
  const hc = rankCounts(hand); const used = {};
  for (const c of selCards) used[c.value] = (used[c.value] || 0) + 1;
  let pen = 0;
  for (const v in used) {
    const have = hc[v] || 0, u = used[v], remain = have - u;
    if (have >= 2 && remain === 1) pen += 2;
    if (have === 4 && remain >= 1 && remain <= 3) pen += 3;
    if (have === 3 && remain === 1) pen += 3;
    if (have === 3 && remain === 2) pen += 1;
  }
  return pen;
}

// ---- 记牌与推断 ----
// 外面还剩哪些牌（不在我手上、也还没出过）
function unseenCounts(game, myHand) {
  const c = {};
  for (const r of ALL_RANKS) c[r] = Math.max(0, TOTAL_BY_RANK[r] - (game.playedByRank[r] || 0));
  for (const card of myHand) if (c[card.value] != null) c[card.value] = Math.max(0, c[card.value] - 1);
  return c;
}
// 对手（不含队友）的手牌张数
function opponentCounts(game, idx) {
  const out = [];
  for (let p = 0; p < 3; p++) if (p !== idx && !isTeammate(game, idx, p)) out.push(game.hands[p].length);
  return out.length ? out : [0];
}
// 队友的手牌张数（没有队友时为 Infinity）
function teammateCount(game, idx) {
  for (let p = 0; p < 3; p++) if (p !== idx && isTeammate(game, idx, p)) return game.hands[p].length;
  return Infinity;
}

// 外面是否还存在能管上这个牌组的牌。保守估计：只看"存在性"，不考虑对手愿不愿意出。
function unseenBeats(group, unseen, oppMax) {
  if (oppMax <= 0 || group.type === 'rocket') return false;
  const u = unseen, L = group.length, R = group.mainRank;
  if (u[16] > 0 && u[17] > 0 && oppMax >= 2) return true;                     // 王炸
  if (group.type === 'bomb') {                                                // 只有更大的炸弹能管
    for (let r = R + 1; r <= 15; r++) if (u[r] >= 4 && oppMax >= 4) return true;
    return false;
  }
  for (let r = 3; r <= 15; r++) if (u[r] >= 4 && oppMax >= 4) return true;     // 炸弹
  if (oppMax < group.cards.length) return false;
  const anyRank = (from, to, need) => { for (let r = from; r <= to; r++) if (u[r] >= need) return true; return false; };
  const chain = (top, len, per) => {
    if (top > 14 || top - len + 1 < 3) return false;
    for (let r = top; r > top - len; r--) if (u[r] < per) return false;
    return true;
  };
  const total = ALL_RANKS.reduce((a, r) => a + u[r], 0);
  switch (group.type) {
    case 'single': return anyRank(R + 1, 17, 1);
    case 'pair': return anyRank(R + 1, 15, 2);
    case 'three': return anyRank(R + 1, 15, 3);
    case 'three_plus_one': return total >= 4 && anyRank(R + 1, 15, 3);
    case 'three_plus_two':
      for (let r = R + 1; r <= 15; r++) if (u[r] >= 3) {
        for (let r2 = 3; r2 <= 15; r2++) if (r2 !== r && u[r2] >= 2) return true;
      }
      return false;
    case 'straight': for (let top = R + 1; top <= 14; top++) if (chain(top, L, 1)) return true; return false;
    case 'straight_pairs': for (let top = R + 1; top <= 14; top++) if (chain(top, L, 2)) return true; return false;
    case 'plane': for (let top = R + 1; top <= 14; top++) if (chain(top, L, 3)) return true; return false;
    case 'plane_plus_singles':
      if (total < 4 * L) return false;
      for (let top = R + 1; top <= 14; top++) if (chain(top, L, 3)) return true;
      return false;
    case 'plane_plus_pairs':
      for (let top = R + 1; top <= 14; top++) if (chain(top, L, 3)) {
        let avail = 0;
        for (let r = 3; r <= 15; r++) if ((r < top - L + 1 || r > top) && u[r] >= 2) avail++;
        if (avail >= L) return true;
      }
      return false;
    case 'four_plus_two_singles': return total >= 6 && anyRank(R + 1, 15, 4);
    case 'four_plus_two_pairs':
      for (let r = R + 1; r <= 15; r++) if (u[r] >= 4) {
        let avail = 0;
        for (let r2 = 3; r2 <= 15; r2++) if (r2 !== r && u[r2] >= 2) avail++;
        if (avail >= 2) return true;
      }
      return false;
    default: return false;
  }
}

// 赢牌路径：会被对手管住的牌组数 s<=1 时，先把不会被管的出完，把唯一会被管的那组留到最后，必赢。
function leadWinPath(groups, unseen, oppMax) {
  if (!groups.length) return null;
  const beatable = [], safe = [];
  for (const g of groups) (unseenBeats(g, unseen, oppMax) ? beatable : safe).push(g);
  if (beatable.length === 0) return safe.slice().sort((a, b) => a.cards.length - b.cards.length);
  if (beatable.length === 1) return [...safe, beatable[0]];
  return null;
}

// ---- 手牌强度（用于叫地主） ----
function handStrength(hand) {
  let pts = 0;
  for (const c of hand) {
    if (c.value === 17) pts += 8; else if (c.value === 16) pts += 5.5;
    else if (c.value === 15) pts += 3.5; else if (c.value === 14) pts += 1.3; else if (c.value === 13) pts += 0.4;
  }
  const cnt = rankCounts(hand);
  for (const v in cnt) { if (cnt[v] === 4) pts += 6; if (cnt[v] === 3 && v >= 14) pts += 1; }
  pts += Math.max(0, 8 - splitHand(hand).length) * 1.6;   // 手数越少越强
  if (cnt[16] && cnt[17]) pts += 2;
  return pts;
}

function aiShouldBid(hand) {
  const s = handStrength(hand);
  if (s >= 15) return true;
  if (s >= 10) return Math.random() < 0.5;
  return false;
}

// 玩家是否队友
function isTeammate(game, a, b) {
  if (game.landlord === null) return false;
  if (a === game.landlord || b === game.landlord) return a === b;
  return true;
}

// 软概率采样：不总选最优（温度越高越容易"失误"）
function softChoose(scored, temp) {
  if (!scored.length) return null;
  const K = 5;
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, K);
  const max = Math.max(...top.map(x => x.score));
  const ws = top.map(x => Math.exp((x.score - max) / Math.max(temp || 0, 0.4)));
  const tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < top.length; i++) { r -= ws[i]; if (r <= 0) return top[i].combo; }
  return top[top.length - 1].combo;
}

const CHAIN_TYPES = new Set(['straight', 'straight_pairs', 'plane', 'plane_plus_singles', 'plane_plus_pairs']);
function restAfter(hand, combo) { return hand.filter(c => !combo.cards.some(x => x.id === c.id)); }

// 调参集中在这里：想调难度/风格改这一处即可（数值由自对弈对抗调优得到）
const AI = {
  temp: 3.5,          // 软采样温度：越低越强、越高越容易失误
  leadBase: 0,        // 领出没有基准分，全靠手牌改善量
  leadGain: 1.5,      // 领出：出完后手牌改善量的权重
  leadCost: 1.1,      // 领出：牌点越大越不急着出
  leadChain: 6,       // 领出：顺子/连对/飞机的额外奖励
  leadSafe: 8,        // 领出：出对手管不了的牌、把牌权攥在手里的奖励
  leadBomb: -40,      // 领出：动炸弹/王炸的代价（炸得有价值时不计）
  leadBig: -6,        // 领出：手牌还多时动大牌的代价
  leadSingleVsOne: -30, // 领出：对手只剩一张时出单张的代价
  followBase: 34,     // 接牌的基础分（不出的基准分见 passBase）；调高会让 AI 更积极抢牌权
  followGain: 1.4,    // 接牌：出完后手牌改善量的权重
  followCost: 1.0,    // 接牌：牌点越大越不急着接
  followBomb: -70,    // 接牌：动炸弹/王炸的代价（炸得有价值时不计）
  followUrgent: 45,   // 接牌：进入收尾警戒后的抢牌权加成
  followBig: -14,     // 接牌：对手还早时动大牌的代价
  followSmall: 3,     // 接牌：顺手带走小牌的奖励
  passBase: 10,       // 不出
  passOppLow: -18,    // 不出：对手牌少时的惩罚
  passSelfLow: -22,   // 不出：自己牌少时的惩罚
  passEndgame: -16,   // 不出：对手进入收尾警戒时，抢牌权的额外加成
  structBreak: 3,     // 拆炸弹/拆三张的代价系数
  bigLord: 0.6,       // 地主一打二：大牌更舍得用（乘在 leadBig/followBig 上）
  bigFarmer: 1.4,     // 农民二打一：大牌留着拦地主，更舍不得用
  // ---- 能力开关：三档难度靠它拉开真实差距，而不只是调数值 ----
  useMemory: true,    // 记牌：判断每个牌组是否还可能被管住
  useWinPath: true,   // 算必胜路线：会被管的牌组 ≤1 时按必胜顺序出
  cooperate: true,    // 农民配合：判断何时该接管队友的牌权
  endgame: 5,         // 对手剩这么多张时进入收尾警戒
};

// 难度档位：不只是数值差，能力也不同。
// 简单档不记牌、不算必胜线、不懂配合；困难档三样全开，且更敢用炸弹抢牌权。
// 注意：setDifficulty 用 Object.assign 覆盖，三档必须写全同一组键，否则会串档。
const DIFFICULTY = {
  easy:   { followBase: 18, followCost: 1.2, temp: 6.5, structBreak: 1.2, followBig: -26, followUrgent: 22,
            passOppLow: -10, followBomb: -90, leadBomb: -60, passEndgame: -6, endgame: 2,
            useMemory: false, useWinPath: false, cooperate: false },
  normal: { followBase: 34, followCost: 0.8, temp: 3.5, structBreak: 2.2, followBig: -16, followUrgent: 38,
            passOppLow: -15, followBomb: -70, leadBomb: -40, passEndgame: -12, endgame: 4,
            useMemory: true, useWinPath: true, cooperate: false },
  hard:   { followBase: 50, followCost: 0.6, temp: 2.0, structBreak: 3.0, followBig: -14, followUrgent: 45,
            passOppLow: -18, followBomb: -30, leadBomb: -20, passEndgame: -20, endgame: 6,
            useMemory: true, useWinPath: true, cooperate: true },
};
const DIFF_NAMES = { easy: '简单', normal: '普通', hard: '困难' };
let difficulty = 'normal';

function setDifficulty(level) {
  if (!DIFFICULTY[level]) return;
  difficulty = level;
  Object.assign(AI, DIFFICULTY[level]);
}
setDifficulty(difficulty);

// 炸弹值不值这个价：能一把走完、或炸完进入必胜路线，就不算亏（返回 0）；
// 否则返回 penalty。这样"炸得有代价"，但关键回合不会因为怕扣分而不敢炸。
function bombCost(combo, hand, ctx, penalty) {
  const rest = restAfter(hand, combo);
  if (!rest.length) return 0;
  if (AI.useWinPath && ctx && ctx.unseen && leadWinPath(splitHand(rest), ctx.unseen, ctx.oppMax)) return 0;
  return penalty;
}

// 角色倾向：地主一打二，要靠抢牌权把自己走完；农民二打一，大牌要留到最后拦地主。
// 乘在"大牌代价"上 —— 地主的代价打折（更敢用），农民的代价放大（更舍不得用）。
function bigScale(game, idx) {
  return game.landlord === idx ? AI.bigLord : AI.bigFarmer;
}

// ---- 领出（我主动出牌） ----
function leadScore(combo, hand, game, idx, ctx) {
  let s = (evalHand(restAfter(hand, combo)) - evalHand(hand)) * AI.leadGain;  // 出完这手后手牌是否更接近走完
  s -= baseCost(combo) * AI.leadCost;                                        // 同等条件下先出小牌
  s -= structPenalty(combo.cards, hand) * AI.structBreak;                    // 别乱拆对子/三张/炸弹
  if (CHAIN_TYPES.has(combo.type)) s += AI.leadChain;                        // 顺子/连对/飞机尽早甩掉
  if (combo.type === 'bomb' || combo.type === 'rocket') s += bombCost(combo, hand, ctx, AI.leadBomb);
  if (combo.mainRank >= BIG_RANK && hand.length > 6) s += AI.leadBig * bigScale(game, idx);
  if (ctx && ctx.oppMin === 1 && combo.type === 'single') s += AI.leadSingleVsOne;  // 对手只剩一张，别送单张
  // 出对手管不了的牌 → 牌权能继续握在自己手里
  if (ctx && ctx.unseen && !unseenBeats(combo, ctx.unseen, ctx.oppMax)) s += AI.leadSafe;
  return s;
}

function aiLead(hand, idx, game) {
  const combos = generateCombos(hand);
  const finisher = combos.find(c => c.cards.length === hand.length);
  if (finisher) return finisher;                                       // 一把走完

  const opps = opponentCounts(game, idx);
  const oppMax = Math.max(...opps), oppMin = Math.min(...opps);
  const unseen = AI.useMemory ? unseenCounts(game, hand) : null;       // 简单档不记牌

  // 1) 必胜路线：会被管的牌组 ≤1 时，先把不会被管的出完，把会被管的留到最后一手
  if (AI.useWinPath && unseen) {
    const path = leadWinPath(splitHand(hand, { killSingles: oppMin === 1 }), unseen, oppMax);
    if (path && path.length) return path[0];
  }

  // 2) 队友只剩一张：喂一张小单张
  if (teammateCount(game, idx) === 1) {
    const feed = splitHand(hand).filter(g => g.type === 'single' && g.mainRank <= 13)
      .sort((a, b) => a.mainRank - b.mainRank)[0];
    if (feed) return feed;
  }

  // 3) 常规：评分 + 软采样
  let pool = combos.filter(c => c.type !== 'bomb' && c.type !== 'rocket');
  if (!pool.length) pool = combos;
  if (oppMin === 1) {
    const noSingle = pool.filter(c => c.type !== 'single');
    if (noSingle.length) pool = noSingle;                              // 对手只剩一张，出对子/顺子他管不了
    else return pool.slice().sort((a, b) => b.mainRank - a.mainRank)[0]; // 只剩单张就出最大的
  }
  const ctx = { oppMin, oppMax, unseen };
  return softChoose(pool.map(c => ({ combo: c, score: leadScore(c, hand, game, idx, ctx) })), game.aiTemp);
}

// ---- 接牌（跟上家的牌） ----
function followScore(combo, hand, lastPlay, game, idx, ctx) {
  let s = AI.followBase + (evalHand(restAfter(hand, combo)) - evalHand(hand)) * AI.followGain;
  s -= baseCost(combo) * AI.followCost;
  s -= structPenalty(combo.cards, hand) * AI.structBreak;
  if (combo.type === 'bomb' || combo.type === 'rocket') s += bombCost(combo, hand, ctx, AI.followBomb);  // 炸弹留给关键回合
  if (ctx.oppMin <= AI.endgame) s += AI.followUrgent;                         // 对手进入收尾，必须拦
  else if (combo.mainRank >= BIG_RANK) s += AI.followBig * bigScale(game, idx);  // 对手还早，别浪费大牌（按角色缩放）
  if (combo.mainRank <= 10) s += AI.followSmall;                              // 顺手把小牌带走
  return s;
}

function aiFollow(hand, lastPlay, idx, game) {
  const lastBy = game.lastPlayedBy;
  const cands = generateCombos(hand).filter(c => canBeat(c, lastPlay));
  if (!cands.length) return null;

  const finisher = cands.find(c => c.cards.length === hand.length);
  if (finisher) return finisher;                                       // 一把走完

  const opps = opponentCounts(game, idx);
  const oppMax = Math.max(...opps), oppMin = Math.min(...opps);
  const unseen = AI.useMemory ? unseenCounts(game, hand) : null;
  const ctx = { oppMin, oppMax, unseen };
  const cheapest = [...cands].sort((a, b) => baseCost(a) - baseCost(b));
  const nonBomb = cheapest.filter(c => c.type !== 'bomb' && c.type !== 'rocket');

  // ---- 上家是队友：不再一律让过 ----
  // 原则：队友就要走完 → 让他走；地主快走完 → 必须接管；
  //       其余情况看"这一手能不能直接收掉、或让我方进入必胜路线"，能才接管。
  if (lastBy !== idx && isTeammate(game, idx, lastBy)) {
    if (game.hands[lastBy].length <= 2) return null;                    // 队友就要走了，别压
    if (oppMin <= 2) return nonBomb.length ? nonBomb[0] : cheapest[0];  // 地主快走完，接管
    if (!AI.cooperate) return null;                                     // 简单档：不会配合
    if (lastPlay.mainRank >= 14 && oppMin > AI.endgame) return null;    // 队友出的够大且局面还早，别抢
    if (oppMin > 4) return null;                                        // 队友牌权更稳，别打断
    for (const c of nonBomb) {
      const rest = restAfter(hand, c);
      if (!rest.length) return c;                                       // 接过来正好走完
      if (AI.useWinPath && unseen && leadWinPath(splitHand(rest), unseen, oppMax)) return c;  // 接过来进必胜线
    }
    return null;
  }

  // ---- 上家是对手 ----
  // 对手快走完了：必须拦，优先不用炸弹
  if (oppMin <= 2) return nonBomb.length ? nonBomb[0] : cheapest[0];

  // 这手管不住 + 出完就进入必胜路线 → 直接接管
  if (AI.useWinPath && unseen) {
    for (const c of cheapest) {
      if (unseenBeats(c, unseen, oppMax)) continue;
      const rest = restAfter(hand, c);
      if (rest.length && leadWinPath(splitHand(rest), unseen, oppMax)) return c;
    }
  }

  const scored = cands.map(c => ({ combo: c, score: followScore(c, hand, lastPlay, game, idx, ctx) }));
  let passScore = AI.passBase;                                         // 不出：让上家继续领出
  if (oppMin <= 4) passScore += AI.passOppLow;
  if (oppMin <= AI.endgame) passScore += AI.passEndgame;               // 进入收尾警戒，别轻易把牌权交出去
  if (hand.length <= 4) passScore += AI.passSelfLow;
  scored.push({ combo: null, score: passScore });
  return softChoose(scored, game.aiTemp);
}

// 本地 AI 决策入口
function localAI(hand, leading, lastPlay, idx, game) {
  if (leading) return aiLead(hand, idx, game);
  return aiFollow(hand, lastPlay, idx, game);
}

// ==================== OP 开局牌型生成 ====================
// 从一副完整牌里剔除指定牌，返回剩下的牌堆（余牌发给两台电脑）
function deckWithout(deck, cards) {
  const ids = new Set(cards.map(c => c.id));
  return deck.filter(c => !ids.has(c.id));
}

// 好牌：5 连飞机（5 个连续三张 = 15 张）+ 5 张单牌 = 20 张，全程无王。
// 整手恰好是一个合法的「飞机带单」，地主拿到就能一把走完。
function generateGoodHand() {
  const start = 3 + Math.floor(Math.random() * 8);        // 3..10，保证 start+4 <= 14
  const planeRanks = [0, 1, 2, 3, 4].map(i => start + i);
  const inPlane = new Set(planeRanks);

  const byRank = {};
  for (const c of createDeck()) { if (c.value <= 14) (byRank[c.value] = byRank[c.value] || []).push(c); }

  const hand = [];
  for (const r of planeRanks) hand.push(...byRank[r].slice(0, 3));   // 每排 3 张

  // 带牌：从飞机之外的点数里各取 1 张（同点只取一张，保证是"带单"）
  const kickers = [];
  for (let r = 3; r <= 14; r++) if (!inPlane.has(r)) kickers.push(r);
  for (const r of shuffle(kickers).slice(0, 5)) hand.push(byRank[r][0]);
  return hand;                                                       // 20 张
}

// 烂牌：无王、无 2、**无 A**，单点最多 3 张（不成炸弹）。
//
// 牌池取 3~13（连 A 都不给）是这里最关键的一条，实测出来的：
//   牌池 3~14（给 A）：地主胜率约 9.3%
//   牌池 3~13（不给 A）：约 2.7%      ← 差三倍多
//   牌池 3~12（连 K 也不给）：约 2.8%  ← 没有进一步收益
// 原因很直白：手里留着 A，地主还能靠它赢一手、抢到牌权；一张 A 都没有就全程被动。
//
// 坏度用「手数越多越烂 + 牌点越小越烂」：手数 × 10 − 牌点总和 × 0.07，
// 低点偏置随机采样若干手取最烂的一手。试过一堆更聪明的写法都不如它——
// 按可成链长度重罚、最小化 AI 自己的 handStrength、随机起步 + 爬山换牌，
// 实测地主胜率都在同一档（8~9%）甚至更差，所以这里保持简单。
function generateBadHand() {
  const byRank = {};
  for (const c of createDeck()) { if (c.value >= 3 && c.value <= 13) (byRank[c.value] = byRank[c.value] || []).push(c); }
  const ranks = Object.keys(byRank).map(Number);
  const weight = ranks.map(r => 15 - r);                              // 低点更容易被抽到（3 最易、K 最难）
  const wsum = weight.reduce((a, b) => a + b, 0);
  const pickRank = () => {
    let x = Math.random() * wsum;
    for (let i = 0; i < ranks.length; i++) { x -= weight[i]; if (x <= 0) return ranks[i]; }
    return ranks[0];
  };

  let best = null, bestScore = -Infinity;
  for (let iter = 0; iter < 6000; iter++) {
    const cnt = {};
    let total = 0;
    while (total < 20) {
      const r = pickRank();
      if ((cnt[r] || 0) >= 3) continue;
      cnt[r] = (cnt[r] || 0) + 1; total++;
    }
    const cards = [];
    let sum = 0;
    for (const r of ranks) {
      const n = cnt[r] || 0;
      if (!n) continue;
      cards.push(...byRank[r].slice(0, n));
      sum += r * n;
    }
    const score = splitHand(cards).length * 10 - sum * 0.07;         // 手数优先，其次牌点越小越好
    if (score > bestScore) { bestScore = score; best = cards; }
  }
  return best;                                                        // 20 张
}

// ==================== GAME CLASS ====================
class Game {
  constructor() {
    this.phase = PHASE.DEALING;
    this.hands = [[], [], []];
    this.bottomCards = [];
    this.landlord = null;
    this.currentPlayer = null;
    this.lastPlayedBy = null;
    this.lastPlay = null;
    this.lastPlayCards = [];
    this.passCount = 0;
    this.bids = [];
    this.bidResponses = [];
    this.winner = null;
    this.showAICards = false;
    this.rpsPlayers = [];
    this.rpsChoices = {};
    this.palmBackPlayers = [];
    this.palmBackChoices = {};
    this.rpsRound = 0;
    this.selectedCards = [];
    this.firstPlayDone = false;
    this.lastPlayByPlayer = [null, null, null];
    this._timeouts = [];
    this._alive = true;      // 被 resetGame 作废后置 false，见 _schedule / destroy
    this.playHistory = [];
    // 记牌器：已出的各牌数量
    this.playedByRank = {};
    for (const r of ALL_RANKS) this.playedByRank[r] = 0;
    // 软采样温度：越低越"聪明"，越高越容易失误（AI 决策在 top5 候选中按分数加权抽签）
    this.aiTemp = AI.temp;
  }

  // 所有异步动作都走这里（发牌、AI 出牌、猜拳、结算…），是唯一的调度入口。
  // fn 执行前要再确认这一局还有效：重开/换难度会丢掉旧的 Game 实例，
  // 但它已经排进 setTimeout 的回调不会自己消失，跑起来就会把旧牌局重新画到屏幕上。
  _schedule(fn, ms) {
    if (!this._alive) return null;
    const id = setTimeout(() => {
      this._timeouts = this._timeouts.filter(t => t !== id);
      if (!this._alive) return;
      fn();
    }, ms);
    this._timeouts.push(id);
    return id;
  }
  _clearTimeouts() { for (const id of this._timeouts) clearTimeout(id); this._timeouts = []; }
  // 打断：作废本局并清掉所有待执行回调。之后 _schedule 不再受理，已在队列里的也会被丢弃。
  destroy() {
    this._alive = false;
    this._clearTimeouts();
  }

  startNewGame() {
    this._clearTimeouts();
    this.phase = PHASE.DEALING;
    this.hands = [[], [], []];
    this.bottomCards = [];
    this.landlord = null;
    this.currentPlayer = null;
    this.lastPlayedBy = null;
    this.lastPlay = null;
    this.lastPlayCards = [];
    this.passCount = 0;
    this.bids = [];
    this.bidResponses = [];
    this.winner = null;
    this.rpsPlayers = [];
    this.rpsChoices = {};
    this.palmBackPlayers = [];
    this.palmBackChoices = {};
    this.rpsRound = 0;
    this.selectedCards = [];
    this.firstPlayDone = false;
    this.lastPlayByPlayer = [null, null, null];
    this.playHistory = [];
    this.playedByRank = {};
    for (const r of ALL_RANKS) this.playedByRank[r] = 0;

    const deck = shuffle(createDeck());
    for (let i = 0; i < 51; i++) this.hands[i % 3].push(deck[i]);
    this.bottomCards = [deck[51], deck[52], deck[53]];
    for (let i = 0; i < 3; i++) this.hands[i].sort((a, b) => b.value - a.value);

    this.phase = PHASE.BIDDING;
    renderAll(this);
    updateUI(this);
    updateStatus(this, '请选择是否抢地主');
    this._processBidding();
  }

  // OP：固定刷出特殊牌型的一局，玩家当地主先手
  startOPGame(mode) {
    this._clearTimeouts();
    this.phase = PHASE.DEALING;
    this.hands = [[], [], []];
    this.bottomCards = [];
    this.landlord = null;
    this.currentPlayer = null;
    this.lastPlayedBy = null;
    this.lastPlay = null;
    this.lastPlayCards = [];
    this.passCount = 0;
    this.bids = [];
    this.bidResponses = [];
    this.winner = null;
    this.rpsPlayers = [];
    this.rpsChoices = {};
    this.palmBackPlayers = [];
    this.palmBackChoices = {};
    this.rpsRound = 0;
    this.selectedCards = [];
    this.firstPlayDone = false;
    this.lastPlayByPlayer = [null, null, null];
    this.playHistory = [];
    this.playedByRank = {};
    for (const r of ALL_RANKS) this.playedByRank[r] = 0;

    // ---- 一手成型的开局：烂牌 / 好牌（整手 20 张即地主手牌）----
    // 底牌取手里最小的三张，好牌/烂牌都保持"无王"
    if (mode === 'bad' || mode === 'good') {
      const hand = (mode === 'good' ? generateGoodHand() : generateBadHand());
      this.hands[0] = hand.slice().sort((a, b) => b.value - a.value);
      this.bottomCards = hand.slice().sort((a, b) => a.value - b.value).slice(0, 3);
      // 电脑：从剩下的真牌里取
      const d = shuffle(deckWithout(createDeck(), this.hands[0]));
      this.hands[1] = d.slice(0, 17);
      this.hands[2] = d.slice(17, 34);

      this.landlord = 0;
      this.phase = PHASE.PLAYING;
      this.currentPlayer = 0;
      this.lastPlay = null;
      this.lastPlayedBy = null;
      this.passCount = 0;
      this.selectedCards = [];
      const flabel = mode === 'good' ? '好牌' : '烂牌';
      updateStatus(this, `OP：固定「${flabel}」！你是地主，请出牌`);
      renderAll(this);
      updateUI(this);
      return;
    }

    // 构造固定特殊牌型
    let deck = createDeck();
    const special = [];
    if (mode === 'bomb') {
      const rank = 8 + Math.floor(Math.random() * 7); // 8..14，够大的炸弹
      for (const s of SUITS) special.push(createCard(s, rank));
    } else if (mode === 'plane') {
      const r = 6 + Math.floor(Math.random() * 6); // 6..11，保证 r+1<=12<=14
      for (const rk of [r, r + 1]) {
        for (const s of SUITS) {
          special.push(createCard(s, rk));
          if (special.filter(c => c.value === rk).length >= 3) break; // 每排正好3张
        }
      }
      // 飞机 = 2 个连续三张
    } else if (mode === 'rocket') {
      special.push(createCard(null, 16), createCard(null, 17));
    }
    const spIds = new Set(special.map(c => c.id));
    deck = deck.filter(c => !spIds.has(c.id));
    deck = shuffle(deck);

    // 玩家：特殊牌 + 补齐到17张
    const take = 17 - special.length;
    const humanHand = special.concat(deck.slice(0, take));
    deck = deck.slice(take);
    const bottom = deck.slice(0, 3); // 玩家当地主拿底牌
    deck = deck.slice(3);
    this.hands[1] = deck.slice(0, 17);
    deck = deck.slice(17);
    this.hands[2] = deck.slice(0, 17);
    this.hands[0] = humanHand.concat(bottom);
    this.bottomCards = bottom;
    for (let i = 0; i < 3; i++) this.hands[i].sort((a, b) => b.value - a.value);

    this.landlord = 0;
    this.phase = PHASE.PLAYING;
    this.currentPlayer = 0;
    this.lastPlay = null;
    this.lastPlayedBy = null;
    this.passCount = 0;
    this.selectedCards = [];

    const label = mode === 'bomb' ? '炸弹' : mode === 'plane' ? '飞机' : '王炸';
    updateStatus(this, `OP：固定「${label}」！你是地主，请出牌`);
    renderAll(this);
    updateUI(this);
  }

  _processBidding() {
    for (let i = 1; i <= 2; i++) {
      if (this.bidResponses.find(r => r.playerIdx === i)) continue;   // 切走再切回来时不要重复叫牌
      this._schedule(() => {
        const bid = aiShouldBid(this.hands[i]);
        this.bidResponses.push({ playerIdx: i, bid });
        updateStatus(this, `电脑${i === 1 ? 'A' : 'B'} ${bid ? '抢地主!' : '不抢'}`);
        renderAll(this);
        updateUI(this);
        this._checkBiddingDone();
      }, i * 1600);
    }
  }

  humanBid(bid) {
    if (this.phase !== PHASE.BIDDING) return;
    if (this.bidResponses.find(r => r.playerIdx === 0)) return;
    this.bidResponses.push({ playerIdx: 0, bid });
    this._checkBiddingDone();
  }

  _checkBiddingDone() {
    if (this.bidResponses.length < 3) return;
    this.bids = this.bidResponses.filter(r => r.bid).map(r => r.playerIdx);
    if (this.bids.length === 1) this._setLandlord(this.bids[0]);
    else if (this.bids.length === 2) this._startRPS(this.bids);
    else if (this.bids.length === 3) this._startPalmBack();
    else { updateStatus(this, '无人抢地主，重新发牌...'); this._schedule(() => this.startNewGame(), 2200); }
  }

  _setLandlord(playerIdx) {
    this.landlord = playerIdx;
    this.hands[playerIdx].push(...this.bottomCards);
    this.hands[playerIdx].sort((a, b) => b.value - a.value);
    this.phase = PHASE.PLAYING;
    this.currentPlayer = playerIdx;
    this.lastPlay = null;
    this.lastPlayedBy = null;
    this.passCount = 0;
    this.selectedCards = [];
    updateStatus(this, `${NAMES[playerIdx]} 是地主！`);
    renderAll(this);
    updateUI(this);
    if (playerIdx !== 0) this._schedule(() => this._aiTurn(), 1300);
  }

  _startPalmBack() {
    this.phase = PHASE.PALM_BACK;
    this.palmBackPlayers = [...this.bids];
    this.palmBackChoices = {};
    for (const p of this.palmBackPlayers) if (p !== 0) this.palmBackChoices[p] = Math.random() < 0.5 ? 'palm' : 'back';
    showPalmBackUI(this);
  }

  resolvePalmBack(humanChoice) {
    if (this.phase !== PHASE.PALM_BACK) return;
    this.palmBackChoices[0] = humanChoice;
    const emoji = { palm: '✋', back: '✊' };
    for (const p of this.palmBackPlayers) {
      const el = document.getElementById(`palm-choice-${p}`);
      if (el) { el.textContent = emoji[this.palmBackChoices[p]]; el.classList.add('pop-in'); }
    }
    document.getElementById('overlay-buttons').innerHTML = '';
    const players = this.palmBackPlayers;
    const choices = players.map(p => this.palmBackChoices[p]);
    if (choices[0] === choices[1] && choices[1] === choices[2]) {
      this.palmBackChoices = {};
      for (const p of players) if (p !== 0) this.palmBackChoices[p] = Math.random() < 0.5 ? 'palm' : 'back';
      updateStatus(this, '都一样！再来一次手心手背...');
      this._schedule(() => showPalmBackUI(this), 1500);
      return;
    }
    const countPalm = choices.filter(c => c === 'palm').length;
    const oddChoice = countPalm === 1 ? 'palm' : 'back';
    const eliminated = players[choices.indexOf(oddChoice)];
    const remaining = players.filter(p => p !== eliminated);
    for (const p of players) {
      const el = document.getElementById(`palm-choice-${p}`);
      if (el) { if (p === eliminated) el.classList.add('eliminated'); else el.classList.add('winner'); }
    }
    document.getElementById('overlay-info').textContent = `${NAMES[eliminated]} 被淘汰！`;
    this._schedule(() => { hideOverlay(); this._startRPS(remaining); }, 2500);
  }

  _startRPS(players) {
    this.phase = PHASE.RPS;
    this.rpsPlayers = players;
    this.rpsChoices = {};
    this.rpsRound = 0;
    for (const p of players) if (p !== 0) this.rpsChoices[p] = ['rock', 'scissors', 'paper'][Math.floor(Math.random() * 3)];
    showRPSUI(this);
  }

  humanPlayCards(cards) {
    if (this.phase !== PHASE.PLAYING || this.currentPlayer !== 0) return;
    const combo = detectCombination(cards);
    if (!combo) { updateStatus(this, '无效的牌型，请重新选择'); return; }
    combo.cards = cards;
    const leading = (this.lastPlay === null || this.lastPlayedBy === 0);
    if (!leading && !canBeat(combo, this.lastPlay)) { updateStatus(this, '打不过，请重新选择或不出'); return; }
    this._executePlay(0, combo);
  }

  humanPass() {
    if (this.phase !== PHASE.PLAYING || this.currentPlayer !== 0) return;
    if (this.lastPlay === null || this.lastPlayedBy === 0) { updateStatus(this, '你是主动出牌方，必须出牌'); return; }
    this._executePass(0);
  }

  // 提示：给玩家推荐一手可出的
  applyHint() {
    if (this.phase !== PHASE.PLAYING || this.currentPlayer !== 0) return;
    const hand = this.hands[0];
    const leading = (this.lastPlay === null || this.lastPlayedBy === 0);
    let combo = null;
    if (leading) {
      const combos = generateCombos(hand);
      for (const c of combos) if (c.cards.length === hand.length) { combo = c; break; }
      if (!combo) {
        const pool = combos.filter(c => c.type !== 'bomb' && c.type !== 'rocket').length ? combos.filter(c => c.type !== 'bomb' && c.type !== 'rocket') : combos;
        let bs = -Infinity;
        for (const c of pool) { const s = leadScore(c, hand, this, 0); if (s > bs) { bs = s; combo = c; } }
      }
    } else {
      const cands = generateCombos(hand).filter(c => canBeat(c, this.lastPlay));
      if (cands.length) cands.sort((a, b) => baseCost(a) - baseCost(b));
      combo = cands[0] || null;
    }
    if (!combo) { updateStatus(this, '无有效出牌，只能不出'); return; }
    this.selectedCards = combo.cards.map(c => hand.find(x => x.id === c.id)).sort((a, b) => a.value - b.value);
    renderPlayerCards(this, 0);
    updateUI(this);
    updateStatus(this, `提示：${comboTypeName(combo)}`);
  }

  _executePlay(playerIdx, combo) {
    this.firstPlayDone = true;
    const cardIds = new Set(combo.cards.map(c => c.id));
    this.hands[playerIdx] = this.hands[playerIdx].filter(c => !cardIds.has(c.id));
    // 记牌器：记录已出
    for (const c of combo.cards) if (this.playedByRank[c.value] != null) this.playedByRank[c.value]++;
    // 特殊牌型动效
    const t = combo.type;
    if (t === 'bomb' || t === 'rocket' || t === 'plane' || t === 'plane_plus_singles' || t === 'plane_plus_pairs') {
      triggerFX(t === 'plane' || t === 'plane_plus_singles' || t === 'plane_plus_pairs' ? 'plane' : t);
    }

    this.lastPlay = combo;
    this.lastPlayCards = combo.cards;
    this.lastPlayedBy = playerIdx;
    this.passCount = 0;
    this.selectedCards = [];
    this.lastPlayByPlayer[playerIdx] = combo.cards;
    this.playHistory.push({ playerIdx, playerName: NAMES[playerIdx], action: 'play', cards: combo.cards, comboType: comboTypeName(combo) });

    renderAll(this);
    renderPlayAreas(this, playerIdx);

    if (this.hands[playerIdx].length === 0) { this._endGame(playerIdx); return; }

    this.currentPlayer = (this.currentPlayer + 1) % 3;
    updateUI(this);
    updateStatus(this, `${NAMES[playerIdx]} 出了 ${comboTypeName(combo)}`);
    if (this.currentPlayer !== 0) this._schedule(() => this._aiTurn(), 1100);
  }

  _executePass(playerIdx) {
    this.passCount++;
    // 出牌和不出都是"这一轮结束"，都要清掉待出的选牌。
    // 否则「提示」选中的牌会一直立着，直到后面有人出牌才被顺手清掉。
    this.selectedCards = [];
    this.lastPlayByPlayer[playerIdx] = 'pass';
    this.playHistory.push({ playerIdx, playerName: NAMES[playerIdx], action: 'pass' });
    updateStatus(this, `${NAMES[playerIdx]} 不出`);
    if (this.passCount >= 2) {
      this.lastPlay = null;
      this.lastPlayCards = [];
      this.lastPlayedBy = null;
      this.passCount = 0;
      this.currentPlayer = (this.currentPlayer + 1) % 3;
      this.lastPlayByPlayer = [null, null, null];
      this.playHistory = [];
      updateStatus(this, `${NAMES[this.currentPlayer]} 重新出牌`);
    } else {
      this.currentPlayer = (this.currentPlayer + 1) % 3;
    }
    renderAll(this);
    updateUI(this);
    if (this.currentPlayer !== 0) this._schedule(() => this._aiTurn(), 1100);
  }

  _aiTurn() {
    if (this.phase !== PHASE.PLAYING) return;
    const aiIdx = this.currentPlayer;
    if (aiIdx === 0) return;
    updateStatus(this, `${NAMES[aiIdx]} 思考中...`);
    this._schedule(() => {
      const leading = (this.lastPlay === null || this.lastPlayedBy === aiIdx);
      const combo = localAI(this.hands[aiIdx], leading, this.lastPlay, aiIdx, this);
      // 以 detectCombination 的判定为准，避免 AI 自报的牌型与规则判定不一致
      const valid = combo && detectCombination(combo.cards);
      if (valid && (leading || canBeat(valid, this.lastPlay))) {
        valid.cards = combo.cards;
        this._executePlay(aiIdx, valid);
      } else {
        this._executePass(aiIdx);
      }
    }, 700);
  }

  _endGame(winnerIdx) {
    this.phase = PHASE.FINISHED;
    this.winner = winnerIdx;
    const isLandlordWin = winnerIdx === this.landlord;
    const humanWins = (winnerIdx === 0) || (!isLandlordWin && this.landlord !== 0);
    showWinScreen(humanWins, isLandlordWin, winnerIdx);
  }
}

function rpsName(c) { return { rock: '石头', scissors: '剪刀', paper: '布' }[c]; }

// 特殊牌型动效：屏幕轻震 + 闪光
function triggerFX(type) {
  const c = document.getElementById('game-container');
  const f = document.getElementById('fx-flash');
  if (!c || !f) return;
  const cls = type === 'rocket' ? 'fx-rocket' : type === 'plane' ? 'fx-plane' : 'fx-bomb';
  c.classList.remove('fx-bomb', 'fx-rocket', 'fx-plane');
  f.classList.remove('fx-bomb', 'fx-rocket', 'fx-plane', 'fx-on');
  void f.offsetWidth; // 强制回流，重新触发动画
  c.classList.add(cls);
  f.classList.add(cls, 'fx-on');
  setTimeout(() => { c.classList.remove('fx-bomb', 'fx-rocket', 'fx-plane'); f.classList.remove('fx-on'); }, 650);
}

// ==================== RENDERER ====================
let game = new Game();

function createCardElement(card, opts = {}) {
  const div = document.createElement('div');
  div.className = `card ${card.color}${card.isJoker ? ' joker' : ''}${opts.faceDown ? ' face-down' : ''}`;
  div.dataset.cardId = card.id;
  if (!opts.faceDown) {
    if (card.isJoker) {
      const label = card.displayRank === '小' ? '小' : '大';
      const icon = card.value === 17 ? '🌟🌟' : '⭐'; // 大王/小王
      div.innerHTML = `<span class="corner"><span class="cr">${label}</span><span class="cs">${icon}</span></span><span class="corner-bot"><span class="cr">${label}</span><span class="cs">${icon}</span></span>`;
    } else {
      div.innerHTML = `<span class="corner"><span class="cr">${card.displayRank}</span><span class="cs">${card.displaySuit}</span></span><span class="corner-bot"><span class="cr">${card.displayRank}</span><span class="cs">${card.displaySuit}</span></span>`;
    }
  }
  return div;
}

function renderPlayerCards(game, playerIdx) {
  const container = document.getElementById(`cards-${playerIdx}`);
  if (!container) return;
  container.innerHTML = '';
  const hand = game.hands[playerIdx];
  const faceDown = (playerIdx !== 0) && !game.showAICards;
  for (const card of hand) {
    const el = createCardElement(card, { faceDown });
    if (playerIdx === 0 && game.selectedCards.find(c => c.id === card.id)) el.classList.add('selected');
    container.appendChild(el);
  }
  if (playerIdx !== 0) {   // 玩家 0 不显示张数，页面上没有 count-0 这个元素
    const countEl = document.getElementById(`count-${playerIdx}`);
    if (countEl) countEl.textContent = `${hand.length}张`;
  }
  const labelEl = document.getElementById(`label-${playerIdx}`);
  if (labelEl) {
    labelEl.classList.remove('landlord', 'farmer', 'active');
    // 身份只靠底色区分即可，不再叠加 emoji（图标统一走 SVG）
    if (game.landlord === playerIdx) { labelEl.classList.add('landlord'); labelEl.textContent = (playerIdx === 0) ? '你（地主）' : '地主'; }
    else if (game.landlord !== null) { labelEl.classList.add('farmer'); labelEl.textContent = (playerIdx === 0) ? '你（农民）' : '农民'; }
    if (game.currentPlayer === playerIdx && game.phase === PHASE.PLAYING) labelEl.classList.add('active');
  }
}

function renderBottomCards(game) {
  const container = document.getElementById('bottom-cards-area');
  if (!container) return;
  container.innerHTML = '';
  if (game.firstPlayDone) container.classList.add('moved-up');
  else container.classList.remove('moved-up');
  if (game.landlord !== null) {
    for (const card of game.bottomCards) container.appendChild(createCardElement(card));
  } else {
    for (const card of game.bottomCards) container.appendChild(createCardElement(card, { faceDown: true }));
  }
}

function renderPlayAreas(game, animPlayerIdx) {
  for (let i = 0; i < 3; i++) {
    const container = document.getElementById(`play-area-${i}`);
    if (!container) continue;
    container.innerHTML = '';
    const last = game.lastPlayByPlayer[i];
    if (!last) continue;
    if (last === 'pass') {
      const span = document.createElement('span');
      span.className = 'pass-tag';
      span.textContent = '不出';
      container.appendChild(span);
    } else if (Array.isArray(last) && last.length > 0) {
      for (const card of last) { const el = createCardElement(card); if (i === animPlayerIdx) el.classList.add('slapped'); container.appendChild(el); }
    }
  }
}

function renderCounter(game) {
  const panel = document.getElementById('counter-panel');
  if (!panel) return;
  panel.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'counter-head';
  head.innerHTML = '<svg aria-hidden="true"><use href="#i-layers"/></svg>记牌器';
  panel.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'counter-grid';
  for (const r of ALL_RANKS) {
    const played = game.playedByRank[r] || 0;
    const total = TOTAL_BY_RANK[r];
    const mine = (game.hands[0] || []).filter(c => c.value === r).length;
    const outside = Math.max(0, total - played - mine); // 外面（对手手里）还有多少
    const cell = document.createElement('div');
    cell.className = 'counter-cell';
    const dim = outside <= 0;
    const bombRisk = outside === 4;
    if (dim) cell.classList.add('dim');
    if (bombRisk) cell.classList.add('bomb');
    const rLabel = RANK_NAME[r];
    const sym = r >= 16 ? (r === 16 ? '小王' : '大王') : rLabel;
    cell.innerHTML = `<span class="c-rank">${sym}</span><span class="c-out">${outside}</span>`;
    cell.title = `${sym}：外面剩 ${outside} 张 / 共 ${total} 张`;
    grid.appendChild(cell);
  }
  panel.appendChild(grid);
}

function renderAll(game) {
  for (let i = 0; i < 3; i++) renderPlayerCards(game, i);
  renderBottomCards(game);
  renderPlayAreas(game, -1);
  renderCounter(game);
}

function updateUI(game) {
  const btnBid = document.getElementById('btn-bid');
  const btnNoBid = document.getElementById('btn-no-bid');
  const btnPlay = document.getElementById('btn-play');
  const btnPass = document.getElementById('btn-pass');
  const btnHint = document.getElementById('btn-hint');
  const showBidBtns = (game.phase === PHASE.BIDDING) && !game.bidResponses.find(r => r.playerIdx === 0);
  const showPlayBtns = (game.phase === PHASE.PLAYING) && game.currentPlayer === 0;
  btnBid.style.display = showBidBtns ? '' : 'none';
  btnNoBid.style.display = showBidBtns ? '' : 'none';
  btnPlay.style.display = showPlayBtns ? '' : 'none';
  btnPass.style.display = showPlayBtns ? '' : 'none';
  btnHint.style.display = showPlayBtns ? '' : 'none';
  if (showPlayBtns) {
    const leading = (game.lastPlay === null || game.lastPlayedBy === 0);
    btnPass.disabled = leading;
    const selected = game.selectedCards;
    if (selected.length === 0) btnPlay.disabled = true;
    else {
      const combo = detectCombination(selected);
      if (!combo) btnPlay.disabled = true;
      else if (!leading && !canBeat(combo, game.lastPlay)) btnPlay.disabled = true;
      else btnPlay.disabled = false;
    }
  }
}

function updateStatus(game, msg) { const el = document.getElementById('status-text'); if (el) el.textContent = msg; }

function toggleCardSelection(game, card) {
  if (game.phase !== PHASE.PLAYING || game.currentPlayer !== 0) return;
  const idx = game.selectedCards.findIndex(c => c.id === card.id);
  if (idx >= 0) game.selectedCards.splice(idx, 1);
  else game.selectedCards.push(card);
  game.selectedCards.sort((a, b) => a.value - b.value);
  renderPlayerCards(game, 0);
  updateUI(game);
}

// ==================== OVERLAY / ANIMATIONS ====================
function hideOverlay() { document.getElementById('overlay').classList.add('hidden'); document.getElementById('overlay-buttons').innerHTML = ''; }

function showPalmBackUI(game) {
  if (window.gameMode === 'xq') return;          // 象棋模式下不弹斗地主的流程浮层
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const content = document.getElementById('overlay-content');
  const info = document.getElementById('overlay-info');
  const buttons = document.getElementById('overlay-buttons');
  overlay.classList.remove('hidden');
  title.textContent = '手心手背！';
  info.textContent = '选手心或手背，淘汰的人退出争夺地主权';
  buttons.innerHTML = '';
  const players = game.palmBackPlayers;
  content.innerHTML = players.map(p => `<div class="overlay-player"><div class="name">${NAMES[p]}</div><div class="choice" id="palm-choice-${p}">❓</div></div>`).join('');
  buttons.innerHTML = `<button class="btn-palm" id="btn-palm-palm">✋ 手心</button><button class="btn-palm" id="btn-palm-back">✊ 手背</button>`;
  document.getElementById('btn-palm-palm').addEventListener('click', () => game.resolvePalmBack('palm'));
  document.getElementById('btn-palm-back').addEventListener('click', () => game.resolvePalmBack('back'));
}

function showRPSUI(game) {
  if (window.gameMode === 'xq') return;
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const content = document.getElementById('overlay-content');
  const info = document.getElementById('overlay-info');
  const buttons = document.getElementById('overlay-buttons');
  overlay.classList.remove('hidden');
  title.textContent = '石头剪刀布！';
  info.textContent = '选石头、剪刀或布，胜者当地的开始叫地主';
  buttons.innerHTML = '';
  const players = game.rpsPlayers;
  content.innerHTML = players.map(p => `<div class="overlay-player"><div class="name">${NAMES[p]}</div><div class="choice shaking" id="rps-choice-${p}">✊</div></div>`).join('');
  if (players.includes(0)) {
    buttons.innerHTML = `<button class="btn-rps" id="btn-rps-rock">✊ 石头</button><button class="btn-rps" id="btn-rps-scissors">✌️ 剪刀</button><button class="btn-rps" id="btn-rps-paper">✋ 布</button>`;
    document.getElementById('btn-rps-rock').addEventListener('click', () => revealRPS(game, 'rock'));
    document.getElementById('btn-rps-scissors').addEventListener('click', () => revealRPS(game, 'scissors'));
    document.getElementById('btn-rps-paper').addEventListener('click', () => revealRPS(game, 'paper'));
  } else {
    game._schedule(() => revealRPS(game, null), 2000);
  }
}

function revealRPS(game, humanChoice) {
  if (humanChoice) game.rpsChoices[0] = humanChoice;
  const players = game.rpsPlayers;
  const emoji = { rock: '✊', scissors: '✌️', paper: '✋' };
  for (const p of players) { const el = document.getElementById(`rps-choice-${p}`); if (el) { el.classList.remove('shaking'); el.textContent = emoji[game.rpsChoices[p]]; el.classList.add('pop-in'); } }
  document.getElementById('overlay-buttons').innerHTML = '';
  const [p1, p2] = players;
  const c1 = game.rpsChoices[p1], c2 = game.rpsChoices[p2];
  const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  if (c1 === c2) {
    document.getElementById('overlay-info').textContent = '平局！再来一次...';
    game.rpsRound++;
    if (game.rpsRound >= 5) {
      const winner = players[Math.random() < 0.5 ? 0 : 1];
      document.getElementById('overlay-info').textContent = '已达最大回合数，随机选择...';
      const wel = document.getElementById(`rps-choice-${winner}`); if (wel) wel.classList.add('winner');
      game._schedule(() => { hideOverlay(); game._setLandlord(winner); }, 2000);
    } else {
      game.rpsChoices = {};
      for (const p of players) if (p !== 0) game.rpsChoices[p] = ['rock', 'scissors', 'paper'][Math.floor(Math.random() * 3)];
      game._schedule(() => showRPSUI(game), 1500);
    }
    return;
  }
  const winner = beats[c1] === c2 ? p1 : p2;
  const el = document.getElementById(`rps-choice-${winner}`); if (el) el.classList.add('winner');
  document.getElementById('overlay-info').textContent = `${NAMES[p1]}：${rpsName(c1)}，${NAMES[p2]}：${rpsName(c2)} — ${NAMES[winner]} 胜！`;
  game._schedule(() => { hideOverlay(); game._setLandlord(winner); }, 2000);
}

function showWinScreen(humanWins, isLandlordWin, winnerIdx) {
  updateStatus(game, isLandlordWin ? '地主获胜！' : '农民获胜！');
  if (window.gameMode === 'xq') return;
  const undoBtn = document.getElementById('btn-win-undo');
  if (undoBtn) undoBtn.style.display = 'none';   // 「撤回」只有象棋有，斗地主不显示
  const overlay = document.getElementById('win-overlay');
  const text = document.getElementById('win-text');
  overlay.classList.remove('hidden');
  text.className = humanWins ? 'win' : 'lose';
  if (humanWins) text.textContent = '你赢了！';
  else text.textContent = NAMES[winnerIdx] + ' 赢了，你输了！';
  updateStatus(game, isLandlordWin ? '地主获胜！' : '农民获胜！');
}

// ==================== EVENT HANDLERS ====================
// 选中态同时写进 aria-pressed（语义）与样式，不让颜色成为唯一指示
function syncDifficultyUI() {
  for (const level of ['easy', 'normal', 'hard']) {
    const el = document.getElementById(`btn-diff-${level}`);
    if (el) el.setAttribute('aria-pressed', String(difficulty === level));
  }
}

function setToggleState(panelId, btnId, labelId, collapsedClass, openText, closedText) {
  const panel = document.getElementById(panelId);
  const btn = document.getElementById(btnId);
  if (!panel || !btn) return;
  const open = !panel.classList.contains(collapsedClass);
  btn.setAttribute('aria-expanded', String(open));
  const label = document.getElementById(labelId);
  if (label) label.textContent = open ? openText : closedText;
}

function syncOpButton() {
  setToggleState('op-panel', 'op-toggle', 'op-toggle-label', 'op-closed', 'OP (收起)', 'OP');
}
function syncCounterButton() {
  setToggleState('counter-panel', 'counter-toggle', 'counter-toggle-label', 'counter-closed', '记牌器 (收起)', '记牌器');
}
// 两个浮层都比各自的按钮宽，同时展开会互相遮挡，所以开一个就收起另一个
function collapsePanel(panelId, collapsedClass) {
  const p = document.getElementById(panelId);
  if (p) p.classList.add(collapsedClass);
}

function bindButtons() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-bid', () => { game.humanBid(true); updateStatus(game, '你：抢地主！'); });
  bind('btn-no-bid', () => { game.humanBid(false); updateStatus(game, '你：不抢'); });
  bind('btn-play', () => game.humanPlayCards([...game.selectedCards]));
  bind('btn-pass', () => game.humanPass());
  bind('btn-hint', () => game.applyHint());
  bind('btn-toggle-ai', function () {
    game.showAICards = !game.showAICards;
    // 按钮里还有图标，只能改文字节点，不能整个 textContent
    this.querySelector('span').textContent = game.showAICards ? '隐藏电脑手牌' : '查看电脑手牌';
    renderAll(game);
  });
  bind('btn-restart', () => { restartCurrent(); });
  bind('btn-win-restart', () => { restartCurrent(); });
  for (const level of ['easy', 'normal', 'hard']) {
    bind(`btn-diff-${level}`, () => {
      if (difficulty === level) return;
      setDifficulty(level);
      if (window.xiangqi) window.xiangqi.setLevel(level);   // 两个玩法共用这一组难度按钮
      syncDifficultyUI();
      restartCurrent();     // 换难度直接重开一局，新难度立即生效
    });
  }
  syncDifficultyUI();
  bind('btn-game-ddz', () => setGameMode('ddz'));
  bind('btn-game-xq',  () => setGameMode('xq'));
  bind('counter-toggle', function () {
    const panel = document.getElementById('counter-panel');
    const willOpen = panel.classList.contains('counter-closed');
    panel.classList.toggle('counter-closed');
    if (willOpen) collapsePanel('op-panel', 'op-closed');
    syncCounterButton(); syncOpButton();
  });
  const runOP = (mode) => {
    document.getElementById('op-panel').classList.add('op-closed');
    syncOpButton();
    const wo = document.getElementById('win-overlay'); if (wo) wo.classList.add('hidden');
    hideOverlay();
    game.startOPGame(mode);
  };
  bind('op-toggle', function () {
    const panel = document.getElementById('op-panel');
    const willOpen = panel.classList.contains('op-closed');
    panel.classList.toggle('op-closed');
    if (willOpen) collapsePanel('counter-panel', 'counter-closed');
    syncOpButton(); syncCounterButton();
  });
  bind('op-bomb', () => runOP('bomb'));
  bind('op-plane', () => runOP('plane'));
  bind('op-rocket', () => runOP('rocket'));
  bind('op-bad', () => runOP('bad'));
  bind('op-good', () => runOP('good'));
}

function resetGame() {
  game.destroy();          // 先打断上一局，否则它排队的回调会把旧画面画回来
  document.getElementById('win-overlay').classList.add('hidden');
  hideOverlay();
  game = new Game();
  window.game = game;
  game.startNewGame();
  syncOpButton();
}

// ==================== 玩法切换（斗地主 / 中国象棋） ====================
window.gameMode = 'ddz';

// 切到象棋时把斗地主「冻结」（destroy 停掉定时器，局面留在 game 里）；
// 切回来再解冻并把待办的一步重新排上，这样两个玩法都能保留各自的棋局。
function setGameMode(mode) {
  if (window.gameMode === mode) return;
  window.gameMode = mode;
  document.getElementById('game-container').classList.toggle('mode-xq', mode === 'xq');
  document.getElementById('btn-game-ddz').setAttribute('aria-pressed', String(mode === 'ddz'));
  document.getElementById('btn-game-xq').setAttribute('aria-pressed', String(mode === 'xq'));
  document.getElementById('btn-toggle-ai').style.display = mode === 'xq' ? 'none' : '';
  if (mode === 'xq') {
    hideOverlay();
    document.getElementById('win-overlay').classList.add('hidden');
    game.destroy();
    if (window.xiangqi) window.xiangqi.activate();
  } else {
    if (window.xiangqi) window.xiangqi.deactivate();
    resumeDdz();
  }
}

function resumeDdz() {
  if (!game || game._alive) return;
  game._alive = true;
  renderAll(game);
  updateUI(game);
  switch (game.phase) {
    case PHASE.BIDDING: game._processBidding(); break;
    case PHASE.PALM_BACK: showPalmBackUI(game); break;
    case PHASE.RPS: showRPSUI(game); break;
    case PHASE.PLAYING: if (game.currentPlayer !== 0) game._aiTurn(); break;
    case PHASE.FINISHED: {
      const isLandlordWin = game.winner === game.landlord;
      showWinScreen(game.winner === 0 || (!isLandlordWin && game.landlord !== 0), isLandlordWin, game.winner);
      break;
    }
  }
}

// 难度按钮 / 重新开始：作用于当前正在玩的玩法
function restartCurrent() {
  if (window.gameMode === 'xq' && window.xiangqi) window.xiangqi.restart();
  else resetGame();
}

// ==================== DRAG SELECTION ====================
let dragState = { active: false, toggled: new Set() };
function getCardFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cardEl = el.closest('#cards-0 .card');
  return cardEl ? cardEl.dataset.cardId : null;
}
function onDragStart(cardId) {
  if (game.phase !== PHASE.PLAYING || game.currentPlayer !== 0) return;
  const card = game.hands[0].find(c => c.id === cardId); if (!card) return;
  dragState.active = true; dragState.toggled = new Set([cardId]);
  toggleCardSelection(game, card);
}
function onDragMove(x, y) {
  if (!dragState.active) return;
  const cardId = getCardFromPoint(x, y);
  if (!cardId || dragState.toggled.has(cardId)) return;
  const card = game.hands[0].find(c => c.id === cardId); if (!card) return;
  dragState.toggled.add(cardId);
  toggleCardSelection(game, card);
}
function onDragEnd() { dragState.active = false; dragState.toggled.clear(); }

function setupDrag() {
  const cards0 = document.getElementById('cards-0');
  if (!cards0) return;
  cards0.addEventListener('mousedown', (e) => { const cardEl = e.target.closest('.card'); if (cardEl) { onDragStart(cardEl.dataset.cardId); e.preventDefault(); } });
  document.addEventListener('mousemove', (e) => { if (dragState.active) onDragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => { if (dragState.active) onDragEnd(); });
  cards0.addEventListener('touchstart', (e) => { const t = e.touches[0]; const el = document.elementFromPoint(t.clientX, t.clientY); if (el) { const c = el.closest('.card'); if (c) { onDragStart(c.dataset.cardId); e.preventDefault(); } } }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (dragState.active) { const t = e.touches[0]; onDragMove(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('touchend', () => { if (dragState.active) onDragEnd(); });
}

// ==================== INIT ====================
window.game = game;
bindButtons();
setupDrag();
game.startNewGame();

})();
