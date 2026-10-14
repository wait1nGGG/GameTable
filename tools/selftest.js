#!/usr/bin/env node
'use strict';
// 无头自测 / 自对弈框架
//   node tools/selftest.js rules            规则与不变式单测
//   node tools/selftest.js bench [局数]      难度分档自对弈 + 对阵基线 AI
//
// doudizhu.js 是单个 IIFE、不导出任何东西。这里把 RENDERER 标记之前的纯逻辑
// 切出来求值，拿到牌型判定 / 拆牌 / AI 等函数，再自己写一个最小的对局循环。
// 不依赖 jsdom：只跑逻辑，不碰 DOM。

const fs = require('fs');
const path = require('path');

const MARKER = '// ==================== RENDERER ====================';
const EXPORTS = [
  'detectCombination', 'canBeat', 'generateCombos', 'comboTypeName',
  'createCard', 'createDeck', 'shuffle', 'mkJoker',
  'generateGoodHand', 'generateBadHand', 'deckWithout',
  'splitHand', 'splitOnce', 'scoreGroups', 'evalHand', 'structPenalty',
  'unseenCounts', 'unseenBeats', 'leadWinPath', 'opponentCounts', 'teammateCount', 'isTeammate',
  'handStrength', 'aiShouldBid', 'softChoose', 'leadScore', 'followScore',
  'aiLead', 'aiFollow', 'localAI',
  'AI', 'DIFFICULTY', 'DIFF_NAMES', 'setDifficulty',
  'TOTAL_BY_RANK', 'ALL_RANKS', 'PHASE', 'NAMES', 'SUITS', 'RANK_NAME',
  'Game',
];

// 渲染层函数在 RENDERER 标记之后，Game 里调用它们时会成为未声明变量。
// 打桩时在 return 之前补上这些名字（都是 marker 之后的函数，不会重复声明）。
const RENDER_STUBS = `
function renderAll(){} function updateUI(){} function updateStatus(){} function hideOverlay(){}
function showPalmBackUI(){} function showRPSUI(){} function showWinScreen(){}
`;

// 象棋那边要导出的一组符号（同样是 RENDERER 标记之前的纯逻辑）
const XQ_EXPORTS = [
  'RED', 'BLACK', 'K', 'A', 'B', 'N', 'R', 'C', 'P', 'CH', 'TYPE_NAME', 'PIECE_LIMIT',
  'sideOf', 'typeOf', 'mk', 'sameSide', 'isRed', 'isBlack', 'isEmpty',
  'idx', 'rowOf', 'colOf', 'onBoard', 'inPalace', 'ownHalf', 'crossedRiver',
  'parseFen', 'toFen', 'initialBoard', 'pieceChar', 'START_FEN',
  'pseudoMoves', 'legalMoves', 'hasLegalMove', 'isAttacked', 'inCheck', 'findGeneral',
  'doMove', 'undoMove', 'gameResult', 'perft', 'fromOf', 'toOf',
  'evaluate', 'searchBestMove', 'searchIterator', 'XQ_LEVELS', 'setXqLevel', 'xqConfig', 'MATE', 'VAL', 'hashBoard',
];

function loadModule(file, opts) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf(MARKER);
  if (i < 0) throw new Error('找不到 RENDERER 标记：' + file);
  // 新旧版本导出的符号不同（比如新版本删了 mkJoker），用 typeof 安全取值：
  // typeof 未声明的标识符不会抛错，未取到的分支也不会被求值。
  const list = (opts && opts.exports) || EXPORTS;
  const obj = list.map(n => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(',');
  const stubs = (opts && opts.stubs) ? RENDER_STUBS : '';
  // 整体套一层括号再 return：文件开头若有块注释，`return /*…*/\n(...)()` 会因 ASI
  // 被拆成空 return（分号插入只看换行，注释不算表达式）。
  const body = src.slice(0, i) + stubs + '\nreturn {' + obj + '};\n})()';
  return new Function('return (' + body + ');')();
}

// ---------- 最小对局引擎 ----------
// 只负责发牌、轮转、出牌合法性校验；AI 决策全部走被测模块。
function newState(hands, landlord) {
  const playedByRank = {};
  for (const r of ALL_RANKS) playedByRank[r] = 0;
  return { hands, landlord, playedByRank, lastPlayedBy: null, aiTemp: 3.5 };
}

let ALL_RANKS;

// seatOf: [mod, mod, mod]；md: [diff, diff, diff]
function playOne(mods, diffs, rand) {
  const deck = mods[0].shuffle(mods[0].createDeck());
  const hands = [[], [], []];
  for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
  const bottom = [deck[51], deck[52], deck[53]];

  const landlord = Math.floor(rand() * 3);
  hands[landlord] = hands[landlord].concat(bottom);
  for (let i = 0; i < 3; i++) hands[i].sort((a, b) => b.value - a.value);

  const g = newState(hands, landlord);
  let cur = landlord, lastPlay = null, lastPlayedBy = null, passCount = 0;

  for (let guard = 0; guard < 400; guard++) {
    const mod = mods[cur];
    mod.setDifficulty(diffs[cur]);
    g.aiTemp = mod.AI.temp;
    g.lastPlayedBy = lastPlayedBy;

    const hand = g.hands[cur];
    const leading = (lastPlay === null || lastPlayedBy === cur);
    const combo = mod.localAI(hand, leading, lastPlay, cur, g);

    let played = null;
    if (combo) {
      const valid = mod.detectCombination(combo.cards);
      if (valid && (leading || mod.canBeat(valid, lastPlay))) { valid.cards = combo.cards; played = valid; }
    }

    if (played) {
      const ids = new Set(played.cards.map(c => c.id));
      g.hands[cur] = g.hands[cur].filter(c => !ids.has(c.id));
      for (const c of played.cards) g.playedByRank[c.value]++;
      lastPlay = played; lastPlayedBy = cur; passCount = 0;
      if (g.hands[cur].length === 0) return cur;
    } else {
      passCount++;
      if (passCount >= 2) { lastPlay = null; lastPlayedBy = null; passCount = 0; }
    }
    cur = (cur + 1) % 3;
  }
  throw new Error('对局未收敛（疑似 AI 死循环不出牌）');
}

// 用指定的地主手牌打一局，返回地主是否获胜（用来实测一手牌到底有多烂）
function playFromHands(mods, diffs, hands, landlord, rand) {
  const g = { hands: [hands[0].slice(), hands[1].slice(), hands[2].slice()], landlord, playedByRank: {}, lastPlayedBy: null, aiTemp: 3.5 };
  for (const r of ALL_RANKS) g.playedByRank[r] = 0;
  let cur = landlord, lastPlay = null, lastPlayedBy = null, passCount = 0;
  for (let guard = 0; guard < 400; guard++) {
    const mod = mods[cur];
    mod.setDifficulty(diffs[cur]);
    g.aiTemp = mod.AI.temp;
    g.lastPlayedBy = lastPlayedBy;
    const hand = g.hands[cur];
    const leading = (lastPlay === null || lastPlayedBy === cur);
    const combo = mod.localAI(hand, leading, lastPlay, cur, g);
    let played = null;
    if (combo) {
      const valid = mod.detectCombination(combo.cards);
      if (valid && (leading || mod.canBeat(valid, lastPlay))) { valid.cards = combo.cards; played = valid; }
    }
    if (played) {
      const ids = new Set(played.cards.map(c => c.id));
      g.hands[cur] = g.hands[cur].filter(c => !ids.has(c.id));
      for (const c of played.cards) g.playedByRank[c.value]++;
      lastPlay = played; lastPlayedBy = cur; passCount = 0;
      if (g.hands[cur].length === 0) return cur === landlord;
    } else {
      passCount++;
      if (passCount >= 2) { lastPlay = null; lastPlayedBy = null; passCount = 0; }
    }
    cur = (cur + 1) % 3;
  }
  return false;
}

// 指定地主手牌后，把剩下的牌洗开发给两个农民
function handsWithLandlord(mod, landlordHand, rand) {
  const used = new Set(landlordHand.map(c => c.id));
  const rest = mod.createDeck().filter(c => !used.has(c.id));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
  return [landlordHand.slice().sort((a, b) => b.value - a.value), rest.slice(0, 17), rest.slice(17, 34)];
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 斗地主的队伍按角色划分：地主(1 人) vs 农民(2 人)，不能按固定座位定义队伍。
// 所以 A 方一半局当地主（另两人全是 B），一半局当农民（地主是 B、另一个农民也是 B）。
// 地主座位同时轮转 0/1/2，避免座位偏差。A 方获胜 = 地主赢时 A 是地主，或地主输时 A 是农民。
function series(games, A, B, seed) {
  const rand = mulberry32(seed);
  let aWin = 0;
  for (let g = 0; g < games; g++) {
    const seatLandlord = g % 3;
    const aIsLandlord = (g % 2 === 0);
    const mods = [], diffs = [];
    for (let s = 0; s < 3; s++) {
      const isA = (s === seatLandlord) === aIsLandlord;
      mods[s] = isA ? A.mod : B.mod;
      diffs[s] = isA ? A.diff : B.diff;
    }
    const winner = playOne(mods, diffs, rand);
    const landlordWon = (winner === seatLandlord);
    if (landlordWon === aIsLandlord) aWin++;
  }
  return aWin / games;
}

// ---------- 规则单测 ----------
function C(mod, spec) {
  // spec: '3' | 'S' etc 由 value 数组构造，suit 用下标区分保证 id 唯一
  const SUITS = mod.SUITS;
  const out = [];
  const used = {};
  for (const v of spec) {
    used[v] = (used[v] || 0) + 1;
    out.push(mod.createCard(v >= 16 ? null : SUITS[(used[v] - 1) % 4], v));
  }
  return out;
}

function runRules(mod) {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  const t = (vals) => { const c = mod.detectCombination(C(mod, vals)); return c && c.type; };

  // 基本牌型
  ok(t([5]) === 'single', '单张');
  ok(t([5, 5]) === 'pair', '对子');
  ok(t([5, 5, 5]) === 'three', '三张');
  ok(t([5, 5, 5, 7]) === 'three_plus_one', '三带一');
  ok(t([5, 5, 5, 7, 7]) === 'three_plus_two', '三带二');
  ok(t([5, 5, 5, 5]) === 'bomb', '炸弹');
  ok(t([16, 17]) === 'rocket', '王炸');
  ok(t([3, 4, 5, 6, 7]) === 'straight', '顺子');
  ok(t([3, 4, 5, 6]) === null, '顺子不足 5 张不成立');
  ok(t([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) === 'straight', '长顺子');
  ok(t([14, 15, 3, 4, 5]) === null, '顺子不能含 2');
  ok(t([3, 3, 4, 4, 5, 5]) === 'straight_pairs', '连对');
  ok(t([3, 3, 4, 4]) === null, '连对不足 3 对不成立');
  ok(t([3, 3, 3, 4, 4, 4]) === 'plane', '飞机不带');
  ok(t([3, 3, 3, 4, 4, 4, 5, 6]) === 'plane_plus_singles', '飞机带单');
  ok(t([3, 3, 3, 4, 4, 4, 5, 5, 6, 6]) === 'plane_plus_pairs', '飞机带对');
  ok(t([5, 5, 5, 5, 3, 3]) === 'four_plus_two_singles', '四带二单');
  ok(t([5, 5, 5, 5, 3, 3, 7, 7]) === 'four_plus_two_pairs', '四带两对');
  ok(t([15, 15, 15, 15]) === 'bomb', '2 的炸弹（2 可成炸）');

  // canBeat
  const cc = (a, b) => mod.canBeat(mod.detectCombination(C(mod, a)), mod.detectCombination(C(mod, b)));
  ok(cc([6], [5]) === true, '单张 6 压 5');
  ok(cc([5], [6]) === false, '小单张压不动');
  ok(cc([5, 5, 5, 5], [14]) === true, '炸弹压单张');
  ok(cc([16, 17], [15, 15, 15, 15]) === true, '王炸压炸弹');
  ok(cc([15, 15, 15, 15], [16, 17]) === false, '炸弹压不动王炸');
  ok(cc([4, 5, 6, 7, 8], [3, 4, 5, 6, 7]) === true, '顺子比大小');
  ok(cc([3, 4, 5, 6, 7, 8], [4, 5, 6, 7, 8]) === false, '顺子长度不同不可比');

  // generateCombos：每一项都必须是合法牌型，且确实是手里的牌
  const hands = [
    [3, 3, 4, 5, 5, 6, 7, 7, 8, 8, 9, 10, 10, 10, 11, 13, 14],
    [3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17],
    [5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 11, 12],
  ];
  for (const spec of hands) {
    const hand = C(mod, spec);
    const ids = new Set(hand.map(c => c.id));
    for (const combo of mod.generateCombos(hand)) {
      const det = mod.detectCombination(combo.cards);
      ok(det !== null, 'generateCombos 产出非法牌型 ' + combo.type + ' / ' + combo.cards.map(c => c.value));
      ok(combo.cards.every(c => ids.has(c.id)), 'generateCombos 产出了手里没有的牌');
      ok(new Set(combo.cards.map(c => c.id)).size === combo.cards.length, 'generateCombos 产出重复牌');
    }
  }

  // splitHand 不变式：牌不多不少、每个牌组都是合法牌型
  let splitChecked = 0;
  for (let iter = 0; iter < 3000; iter++) {
    const deck = mod.shuffle(mod.createDeck());
    const hand = deck.slice(0, 17 + (iter % 4));
    const groups = mod.splitHand(hand);
    const flat = groups.flatMap(g => g.cards);
    ok(flat.length === hand.length, 'splitHand 牌数对不上：' + flat.length + ' vs ' + hand.length);
    ok(new Set(flat.map(c => c.id)).size === flat.length, 'splitHand 出现重复牌');
    const idSet = new Set(hand.map(c => c.id));
    ok(flat.every(c => idSet.has(c.id)), 'splitHand 用到了手外的牌');
    for (const g of groups) {
      const det = mod.detectCombination(g.cards);
      ok(det !== null, 'splitHand 产出非法牌组 ' + g.type + ' ' + g.cards.map(c => c.value).join(','));
    }
    splitChecked++;
  }

  return { fails, splitChecked };
}

// ---------- 主程序 ----------
function main() {
  const here = __dirname;
  const cur = loadModule(path.join(here, '..', 'doudizhu.js'));
  const base = fs.existsSync(path.join(here, 'baseline.js'))
    ? loadModule(path.join(here, 'baseline.js')) : null;
  ALL_RANKS = cur.ALL_RANKS;

  const cmd = process.argv[2] || 'rules';

  if (cmd === 'rules') {
    console.log('== 规则与不变式单测 ==');
    for (const [name, mod] of [['当前', cur], ['基线', base].filter(Boolean)]) {
      const { fails, splitChecked } = runRules(mod);
      console.log(`[${name}] splitHand 不变式 ${splitChecked} 例，失败 ${fails.length}`);
      for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
      if (!fails.length) console.log('   ✓ 全部通过');
    }
    process.exit(0);
  }

  if (cmd === 'bench') {
    const games = parseInt(process.argv[3] || '6000', 10);
    console.log(`== 自对弈（每项 ${games} 局，A 方胜率）==\n`);
    const rows = [];
    const curSelf = (d) => ({ mod: cur, diff: d });

    for (const d of ['easy', 'normal', 'hard']) {
      const w = series(games, curSelf(d), curSelf('normal'), 1234 + games);
      rows.push([`当前 ${d}`, 'vs 当前 normal', (w * 100).toFixed(1) + '%']);
    }
    if (base) {
      for (const d of ['easy', 'normal', 'hard']) {
        for (const bd of ['easy', 'normal', 'hard']) {
          const w = series(games, { mod: cur, diff: d }, { mod: base, diff: bd }, 77 + games);
          rows.push([`当前 ${d}`, `vs 基线 ${bd}`, (w * 100).toFixed(1) + '%']);
        }
      }
    }
    const w = series(games, { mod: cur, diff: 'normal' }, { mod: base, diff: 'normal' }, 99 + games);
    rows.push(['当前 normal', 'vs 基线 normal', (w * 100).toFixed(1) + '%']);

    const w1 = width(rows.map(r => r[0])), w2 = width(rows.map(r => r[1]));
    for (const [a, b, c] of rows) console.log(a.padEnd(w1) + '  ' + b.padEnd(w2) + '  ' + c);
    process.exit(0);
  }

  if (cmd === 'op') {
    const N = parseInt(process.argv[3] || '3000', 10);
    const fmt = (hand) => [...hand].sort((a, b) => b.value - a.value).map(c => cur.RANK_NAME[c.value]).join(' ');

    console.log(`== 好牌开局校验（${N} 手）==`);
    let gf = 0, oneShot = 0;
    let gSample = null;
    for (let i = 0; i < N; i++) {
      const h = cur.generateGoodHand();
      if (!gSample) gSample = h;
      if (h.length !== 20) { gf++; continue; }
      if (new Set(h.map(c => c.id)).size !== 20) { gf++; continue; }
      if (h.some(c => c.value >= 15)) { gf++; continue; }              // 无王、无 2
      const det = cur.detectCombination(h);
      if (!det || det.length !== 5) { gf++; continue; }
      if (det.type !== 'plane_plus_singles') { gf++; continue; }
      oneShot++;
    }
    console.log(`  20 张且恰为「5 连飞机带 5 单、可一把走完」：${oneShot}/${N}，异常 ${gf}`);
    console.log(`  示例：${fmt(gSample)}`);

    console.log(`\n== 烂牌开局校验（${N} 手）==`);
    let bf = 0, groups = [], bSample = null;
    let sumRank = 0, chainHands = 0, highCards = 0, triples = 0;
    const CHAINS = new Set(['straight', 'straight_pairs', 'plane', 'plane_plus_singles', 'plane_plus_pairs']);
    for (let i = 0; i < N; i++) {
      const h = cur.generateBadHand();
      if (!bSample) bSample = h;
      if (h.length !== 20) { bf++; continue; }
      if (new Set(h.map(c => c.id)).size !== 20) { bf++; continue; }
      if (h.some(c => c.value >= 14)) { bf++; continue; }              // 无王、无 2、无 A
      const cnt = {}; for (const c of h) cnt[c.value] = (cnt[c.value] || 0) + 1;
      if (Object.values(cnt).some(v => v >= 4)) { bf++; continue; }    // 不成炸弹
      groups.push(cur.splitHand(h).length);
      for (const c of h) { sumRank += c.value; if (c.value >= 12) highCards++; }
      triples += Object.values(cnt).filter(v => v >= 3).length;
      if (cur.generateCombos(h).some(c => CHAINS.has(c.type))) chainHands++;
    }
    const good = N - bf;
    groups.sort((a, b) => a - b);
    const p = (q) => groups[Math.min(groups.length - 1, Math.floor(groups.length * q))];
    console.log(`  20 张 / 无王无2无A / 无炸弹：${good}/${N}，异常 ${bf}`);
    console.log(`  需要手数（越多越烂）：最小 ${groups[0]}，中位 ${p(0.5)}，最大 ${groups[groups.length - 1]}`);
    console.log(`  平均牌点 ${(sumRank / good).toFixed(2)}（3~17，越小越烂）　Q/K/A 张数占比 ${(highCards / good / 20 * 100).toFixed(1)}%`);
    console.log(`  仍能凑出顺子/连对/飞机的比例 ${(chainHands / good * 100).toFixed(1)}%（越低越烂）　手上三张的组数 ${(triples / good).toFixed(2)}（越少越烂）`);
    console.log(`  示例：${fmt(bSample)}`);

    // 真实对局实测：把生成的手牌直接当地主手牌打完一局，看地主胜率。
    // 越低说明这手牌越烂。作为参照同时测「完全随机 20 张」。
    const hands = parseInt(process.env.HANDS || '300', 10);
    const perHand = parseInt(process.env.PERHAND || '6', 10);
    const measure = (label, genFn) => {
      const rand = mulberry32(4242);
      const mods = [cur, cur, cur], diffs = ['normal', 'normal', 'normal'];
      let win = 0, total = 0;
      for (let i = 0; i < hands; i++) {
        const h = genFn(rand);
        for (let k = 0; k < perHand; k++) {
          total++;
          if (playFromHands(mods, diffs, handsWithLandlord(cur, h, rand), 0, rand)) win++;
        }
      }
      console.log(`  ${label}：地主胜率 ${(win / total * 100).toFixed(1)}%   （${hands} 手 × ${perHand} 局）`);
      return win / total;
    };
    const randomTwenty = (rand) => {
      const d = cur.createDeck();
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
      return d.slice(0, 20);
    };
    console.log('\n  对局实测（越低越烂）：');
    measure('参照·完全随机 20 张', randomTwenty);
    measure('烂牌开局', () => cur.generateBadHand());

    for (let i = 0; i < (parseInt(process.env.SAMPLES || '0', 10)); i++) console.log(`       ${fmt(cur.generateBadHand())}`);
    process.exit(0);
  }

  if (cmd === 'game') {
    // 渲染层打桩，直接跑 Game 的开局路径，验证接线（不只是生成器本身）
    global.document = { getElementById: () => null };
    const m = loadModule(path.join(here, '..', 'doudizhu.js'), { stubs: true });
    const fails = [];
    const ok = (c, msg) => { if (!c) fails.push(msg); };
    const ids = (hands) => hands.flatMap(h => h.map(c => c.id));
    const dupCheck = (hands, tag) => {
      const all = ids(hands);
      ok(new Set(all).size === all.length, tag + '：手牌出现重复牌');
    };

    for (const mode of ['bomb', 'plane', 'rocket', 'bad', 'good']) {
      const g = new m.Game();
      g.startOPGame(mode);
      g.destroy();
      ok(g.landlord === 0, `OP ${mode}：玩家应当地主`);
      ok(g.phase === m.PHASE.PLAYING, `OP ${mode}：应当进入出牌阶段`);
      ok(g.currentPlayer === 0, `OP ${mode}：应当玩家先手`);
      ok(g.hands[0].length === 20, `OP ${mode}：地主手牌应为 20 张，实为 ${g.hands[0].length}`);
      ok(g.hands[1].length === 17 && g.hands[2].length === 17, `OP ${mode}：电脑手牌应为 17 张`);
      dupCheck(g.hands, `OP ${mode}`);
      if (mode === 'good') {
        const det = m.detectCombination(g.hands[0]);
        ok(det && det.type === 'plane_plus_singles' && det.length === 5, 'OP good：整手应为 5 连飞机带 5 单');
        ok(g.hands[0].every(c => c.value <= 14), 'OP good：不应含 2 和王');
      }
      if (mode === 'bad') {
        ok(g.hands[0].every(c => c.value <= 14), 'OP bad：不应含 2 和王');
        const cnt = {}; for (const c of g.hands[0]) cnt[c.value] = (cnt[c.value] || 0) + 1;
        ok(Object.values(cnt).every(v => v <= 3), 'OP bad：不应出现炸弹');
        ok(m.splitHand(g.hands[0]).length >= 9, 'OP bad：应当是烂牌（需要很多手）');
      }
    }

    // 普通开局：17/17/17 + 3 张底牌，54 张不重不漏
    const g = new m.Game();
    g.startNewGame();
    g.destroy();
    ok(g.hands[0].length === 17 && g.hands[1].length === 17 && g.hands[2].length === 17, '普通开局：三家各 17 张');
    ok(g.bottomCards.length === 3, '普通开局：底牌 3 张');
    dupCheck(g.hands, '普通开局');
    const all = ids(g.hands).concat(g.bottomCards.map(c => c.id));
    ok(new Set(all).size === 54, '普通开局：54 张牌不重复');

    console.log('== 开局接线冒烟测试 ==');
    for (const f of fails) console.log('   ✗ ' + f);
    if (!fails.length) console.log('   ✓ 全部通过（5 个 OP 模式 + 普通开局）');
    process.exit(fails.length ? 1 : 0);
  }

  if (cmd === 'duel') {
    // duel <A难度> <B难度> [局数] [seed] [A=当前|基线] [B=当前|基线]
    const a = process.argv[3] || 'hard', b = process.argv[4] || 'hard';
    const games = parseInt(process.argv[5] || '4000', 10);
    const seed = parseInt(process.argv[6] || '2024', 10);
    const sideA = process.argv[7] === '基线' ? base : cur;
    const sideB = process.argv[8] === '基线' ? base : cur;
    if (!sideA || !sideB) { console.error('缺少 tools/baseline.js（基线 AI 快照）'); process.exit(1); }
    // OVERRIDE='{"followBase":40}' 可在不改源码的情况下试参数
    if (process.env.OVERRIDE && sideA === cur) Object.assign(cur.DIFFICULTY[a], JSON.parse(process.env.OVERRIDE));
    const w = series(games, { mod: sideA, diff: a }, { mod: sideB, diff: b }, seed);
    const se = Math.sqrt(w * (1 - w) / games) * 100;
    console.log(`${process.argv[7] || '当前'}-${a}  vs  ${process.argv[8] || '当前'}-${b}   ${(w * 100).toFixed(1)}%  ±${(se * 1.96).toFixed(1)}  (${games} 局)`);
    process.exit(0);
  }

  if (cmd === 'xq') {
    const maxDepth = parseInt(process.argv[3] || '4', 10);
    const m = loadModule(path.join(here, '..', 'xiangqi.js'), { exports: XQ_EXPORTS });
    const fails = [];
    const ok = (c, msg) => { if (!c) fails.push(msg); };

    // ---- perft：初始局面的标准值，走法生成写错（蹩马腿/塞象眼/飞将）会立刻现形 ----
    const EXPECT = { 1: 44, 2: 1920, 3: 79666, 4: 3290240 };
    console.log('== 象棋 perft（初始局面）==');
    for (let d = 1; d <= maxDepth; d++) {
      const t0 = process.hrtime.bigint();
      const n = m.perft(m.initialBoard(), m.RED, d);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const good = EXPECT[d] === undefined || n === EXPECT[d];
      ok(good, `perft(${d}) = ${n}，应为 ${EXPECT[d]}`);
      console.log(`   depth ${d}: ${String(n).padStart(9)}  ${good ? '✓' : '✗ 应为 ' + EXPECT[d]}   ${ms.toFixed(0)}ms`);
    }

    // ---- 走法规则单测 ----
    const B = (spec) => m.parseFen(spec).board;
    const N = (r, c) => m.idx(r, c);
    const movesFrom = (spec, side, from) => m.pseudoMoves(B(spec), side).filter(mv => m.fromOf(mv) === from).map(mv => m.toOf(mv));

    // 蹩马腿：红兵占住 (4,4) 这个马腿，(5,4) 的马就走不到 (3,3)/(3,5)
    {
      const spec = '4k4/9/9/9/4P4/4N4/9/9/9/4K4 w';
      const to = movesFrom(spec, m.RED, N(5, 4));
      ok(!to.includes(N(3, 3)) && !to.includes(N(3, 5)), '蹩马腿：马腿被占时不该能走那两个点');
      ok(to.includes(N(7, 3)) && to.includes(N(7, 5)), '蹩马腿：另一侧马腿空的仍应能走');
    }
    // 塞象眼 + 象不过河
    {
      const spec = '4k4/9/9/9/9/9/4B4/3P5/9/4K4 w';
      const to = movesFrom(spec, m.RED, N(6, 4));
      ok(!to.includes(N(8, 2)), '塞象眼：象眼 (7,3) 被占时不该能走到 (8,2)');
      ok(to.includes(N(8, 6)), '塞象眼：另一侧象眼空的仍应能走');
      ok(!to.includes(N(4, 2)) && !to.includes(N(4, 6)), '象不过河：相不该过河');
    }
    // 兵卒：过河才能横走，到底线只能横走
    {
      const crossed = movesFrom('4k4/9/9/9/4P4/9/9/9/9/4K4 w', m.RED, N(4, 4));
      ok(crossed.length === 3, '兵过河后应能直走 + 左右横走（3 种），实为 ' + crossed.length);
      const own = movesFrom('4k4/9/9/9/9/4P4/9/9/9/4K4 w', m.RED, N(5, 4));
      ok(own.length === 1, '兵未过河只能直走（1 种），实为 ' + own.length);
      const bottom = movesFrom('4P4/9/9/9/9/9/9/9/9/4K4 w', m.RED, N(0, 4));
      ok(bottom.length === 2 && bottom.every(t => m.rowOf(t) === 0), '兵到底线后只能横走');
    }
    // 车：直线走子，撞子即停（(5,0) 的车共 17 步）
    {
      const to = movesFrom('4k4/9/9/9/4P4/R8/9/9/9/4K4 w', m.RED, N(5, 0));
      ok(to.length === 17, '车在 (5,0) 应 17 步（横 8 + 纵 9），实为 ' + to.length);
    }
    // 炮：隔一个子才能吃；(9,0) 的炮 0 列上有红兵 (5,0) 当炮架、黑车 (2,0) 当目标
    {
      const spec = '4k4/9/r8/9/4P4/P8/9/9/9/C3K4 w';
      const to = movesFrom(spec, m.RED, N(9, 0));
      ok(to.includes(N(2, 0)), '炮：隔一个炮架应能吃到后面的子');
      ok(to.includes(N(6, 0)), '炮：不吃子时应能像车一样走空位');
      ok(!to.includes(N(5, 0)), '炮：不能把炮架本身当落点');
      ok(!to.includes(N(4, 0)), '炮：跳过炮架后不能再落到空位');
    }
    // 飞将
    ok(m.isAttacked(B('4k4/9/9/9/9/9/9/9/9/4K4 w'), 9, 4, m.BLACK), '飞将：同列无阻挡时，黑将攻击红帅所在格');
    ok(!m.isAttacked(B('4k4/9/9/9/4P4/9/9/9/9/4K4 w'), 9, 4, m.BLACK), '飞将：中间有子则不算攻击');
    // 将死：黑将贴顶线，双车封住全部出口
    {
      const mate = 'R3k4/5R3/9/9/9/4P4/9/9/9/4K4 b';
      const res = m.gameResult(B(mate), m.BLACK);
      ok(res.over && res.winner === m.RED && res.reason === '将死', '将死应判黑方负，实为 ' + JSON.stringify(res));
    }
    // 困毙：黑将未被将但无处可走 —— 象棋里同样是判负（不是和棋）
    {
      const stale = '4k4/3R1R3/9/9/9/4P4/9/9/9/4K4 b';
      ok(!m.inCheck(B(stale), m.BLACK), '困毙局面下黑方不该处于被将军状态');
      const res = m.gameResult(B(stale), m.BLACK);
      ok(res.over && res.winner === m.RED && res.reason === '困毙', '困毙应判负，实为 ' + JSON.stringify(res));
    }
    // 合法性过滤：不能走出让自己被将军的着法（这里红车被牵制）
    {
      const pinned = '4k4/9/9/9/9/9/9/9/4R4/4K4 w';
      const legal = m.legalMoves(B(pinned), m.RED).filter(mv => m.fromOf(mv) === N(8, 4));
      ok(legal.every(mv => m.colOf(m.toOf(mv)) === 4), '被牵制的车不该离开中间那一列');
    }
    // FEN 往返
    ok(m.toFen(m.initialBoard(), m.RED) === m.START_FEN, 'toFen(parseFen(START)) 应还原 START_FEN');
    // 初始局面双方各 16 子
    {
      let red = 0, black = 0;
      for (const code of m.initialBoard()) { if (!code) continue; if (m.sideOf(code) === m.RED) red++; else black++; }
      ok(red === 16 && black === 16, `初始局面应各 16 子，实为红 ${red} 黑 ${black}`);
    }

    console.log('\n== 象棋规则单测 ==');
    for (const f of fails) console.log('   ✗ ' + f);
    if (!fails.length) console.log('   ✓ 全部通过');
    process.exit(fails.length ? 1 : 0);
  }

  if (cmd === 'xqai') {
    const level = process.argv[3] || 'normal';
    const games = parseInt(process.argv[4] || '4', 10);
    const m = loadModule(path.join(here, '..', 'xiangqi.js'), { exports: XQ_EXPORTS });
    m.setXqLevel(level);
    const cfg = m.xqConfig();
    const fails = [];
    const ok = (c, msg) => { if (!c) fails.push(msg); };
    const name = (sq) => String.fromCharCode(97 + m.colOf(sq)) + (10 - m.rowOf(sq));

    console.log(`== 象棋 AI（${level}：${cfg.timeMs}ms / 深度 ${cfg.maxDepth} / 随机 ${cfg.random}）==`);

    // 一步杀：红方有杀着，AI 必须选中（局面：0 行红车 + 1 行红车封住出口）
    {
      const board = m.parseFen('4k4/8R/R8/9/9/4P4/9/9/9/4K4 w').board;
      const t0 = process.hrtime.bigint();
      const mv = m.searchBestMove(board, m.RED, cfg);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const cap = m.doMove(board, mv);
      const res = m.gameResult(board, m.BLACK);
      m.undoMove(board, mv, cap);
      ok(res.over && res.winner === m.RED, '一步杀没找到，走的是 ' + name(m.fromOf(mv)) + '-' + name(m.toOf(mv)));
      console.log(`   一步杀：${name(m.fromOf(mv))}-${name(m.toOf(mv))}  ${res.over ? '✓ 成杀' : '✗ 未成杀'}   ${ms.toFixed(0)}ms`);
    }

    // 白吃子要吃：红车与黑车同排且中间无子，AI 应当吃掉
    {
      const board = m.parseFen('4k4/9/9/9/4P4/R3r4/9/9/9/4K4 w').board;
      const mv = m.searchBestMove(board, m.RED, cfg);
      ok(m.toOf(mv) === m.idx(5, 4), 'AI 应当白吃那只黑车，实际走到 ' + name(m.toOf(mv)));
    }

    // 自对弈：验证出的都是合法着法、能正常终局（用低预算配置，否则一局要跑几分钟）
    {
      const fast = Object.assign({}, cfg, { timeMs: 40, maxDepth: 3, random: 0 });
      const CAP = 250;
      let plies = 0, finished = 0, illegal = 0, totalMs = 0;
      for (let g = 0; g < games; g++) {
        const board = m.initialBoard();
        let side = m.RED, n = 0;
        for (; n < CAP; n++) {
          if (m.gameResult(board, side).over) { finished++; break; }
          const t0 = process.hrtime.bigint();
          const mv = m.searchBestMove(board, side, fast);
          totalMs += Number(process.hrtime.bigint() - t0) / 1e6;
          if (!m.legalMoves(board, side).includes(mv)) { illegal++; break; }
          m.doMove(board, mv);
          side = 1 - side;
        }
        plies += n;
      }
      // 只硬性要求「着法合法」；弱引擎的棋局本来就常常超过 250 手，不算失败
      ok(illegal === 0, `自对弈出现非法着法 ${illegal} 次`);
      console.log(`   自对弈 ${games} 局（低预算）：平均 ${(plies / games).toFixed(0)} 手，终局 ${finished}/${games}，非法 ${illegal}，平均每步 ${(totalMs / plies).toFixed(0)}ms`);
    }

    for (const f of fails) console.log('   ✗ ' + f);
    if (!fails.length) console.log('   ✓ 全部通过');
    process.exit(fails.length ? 1 : 0);
  }

  if (cmd === 'xqduel') {
    // xqduel <档A> <档B> [局数] [手数上限] [时间缩放]
    const a = process.argv[3] || 'easy', b = process.argv[4] || 'normal';
    const games = parseInt(process.argv[5] || '6', 10);
    const cap = parseInt(process.argv[6] || '150', 10);
    const scale = parseFloat(process.argv[7] || '1');
    const m = loadModule(path.join(here, '..', 'xiangqi.js'), { exports: XQ_EXPORTS });
    const mk = (lvl) => Object.assign({}, m.XQ_LEVELS[lvl], { timeMs: Math.round(m.XQ_LEVELS[lvl].timeMs * scale) });
    const cfgA = mk(a), cfgB = mk(b);
    let aWin = 0, bWin = 0, un = 0;
    for (let g = 0; g < games; g++) {
      const board = m.initialBoard();
      const aSide = (g % 2 === 0) ? m.RED : m.BLACK;   // 交替先后手
      let side = m.RED, n = 0, res = null;
      for (; n < cap; n++) {
        res = m.gameResult(board, side);
        if (res.over) break;
        m.doMove(board, m.searchBestMove(board, side, side === aSide ? cfgA : cfgB));
        side = 1 - side;
      }
      if (!res || !res.over) un++;
      else if (res.winner === aSide) aWin++;
      else bWin++;
    }
    const decided = aWin + bWin;
    console.log(`象棋 ${a} vs ${b}（${games} 局，每局上限 ${cap} 手${scale !== 1 ? '，时间×' + scale : ''}）`);
    console.log(`   ${a} 胜 ${aWin}　${b} 胜 ${bWin}　未终局 ${un}` +
      (decided ? `　→ ${a} 胜率 ${(aWin / decided * 100).toFixed(1)}%（仅统计分出胜负的局）` : ''));
    process.exit(0);
  }

  console.log('用法：node tools/selftest.js rules | op [次数] | game | duel | xq [perft深度] | xqai [难度] [局数] | xqduel <档A> <档B> | bench [局数]');
}

function width(arr) { return Math.max.apply(null, arr.map(s => [...s].length)); }

main();
