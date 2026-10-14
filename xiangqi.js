// 中国象棋：规则引擎 + 电脑 AI + 界面
// 和 doudizhu.js 一样是单个 IIFE；RENDERER 标记之前是纯逻辑，可无头测试
// （tools/selftest.js 把标记前的内容切出来 new Function 求值）。
(function() {
'use strict';

// ==================== 常量与坐标 ====================
// 棋盘 9 列 × 10 行。行 0 在顶部（黑方底线），行 9 在底部（红方底线）—— 渲染时红方在下。
// 棋子编码：1..7 红，9..15 黑。type = code & 7，side = code >> 3。
const RED = 0, BLACK = 1;
const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
const CH = { 1: ['帥', '將'], 2: ['仕', '士'], 3: ['相', '象'], 4: ['傌', '馬'], 5: ['俥', '車'], 6: ['炮', '砲'], 7: ['兵', '卒'] };
const FEN_CODE = { k: 1, a: 2, b: 3, n: 4, r: 5, c: 6, p: 7 };
const FEN_CH = { 1: 'k', 2: 'a', 3: 'b', 4: 'n', 5: 'r', 6: 'c', 7: 'p' };
const TYPE_NAME = { 1: '将帅', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '兵' };
const PIECE_LIMIT = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 5 };

const sideOf = c => c >> 3;
const typeOf = c => c & 7;
const mk = (side, type) => type | (side << 3);
const isEmpty = c => c === 0;
const sameSide = (a, b) => a > 0 && b > 0 && sideOf(a) === sideOf(b);
const isRed = c => c > 0 && c < 8;
const isBlack = c => c > 8;

const idx = (r, c) => r * 9 + c;
const rowOf = i => (i / 9) | 0;
const colOf = i => i % 9;
const onBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (side, r, c) => c >= 3 && c <= 5 && (side === RED ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
const ownHalf = (side, r) => (side === RED ? r >= 5 : r <= 4);
const crossedRiver = (side, r) => (side === RED ? r <= 4 : r >= 5);

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const board = new Int8Array(90);
  const rows = parts[0].split('/');
  for (let r = 0; r < 10 && r < rows.length; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') { c += +ch; continue; }
      const lower = ch.toLowerCase();
      const type = FEN_CODE[lower];
      if (!type || c > 8) continue;
      board[idx(r, c++)] = mk(ch === lower ? BLACK : RED, type);
    }
  }
  return { board, side: parts[1] === 'b' ? BLACK : RED };
}

function toFen(board, side) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let s = '', run = 0;
    for (let c = 0; c < 9; c++) {
      const code = board[idx(r, c)];
      if (code === 0) { run++; continue; }
      if (run) { s += run; run = 0; }
      const ch = FEN_CH[typeOf(code)];
      s += sideOf(code) === RED ? ch.toUpperCase() : ch;
    }
    if (run) s += run;
    rows.push(s);
  }
  return rows.join('/') + ' ' + (side === BLACK ? 'b' : 'w');
}

function initialBoard() { return parseFen(START_FEN).board; }
function pieceChar(code) { return code ? CH[typeOf(code)][sideOf(code)] : ''; }

// ==================== 走法生成 ====================
const KING_STEP = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ADV_STEP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const BISHOP_STEP = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
// 马：[dr, dc, 马腿dr, 马腿dc]（马腿相对马自身）
const HORSE_STEP = [
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
];

const enc = (from, to) => (from << 8) | to;
const fromOf = mv => mv >> 8;
const toOf = mv => mv & 255;

function pseudoMoves(board, side) {
  const out = [];
  for (let from = 0; from < 90; from++) {
    const code = board[from];
    if (!code || sideOf(code) !== side) continue;
    const r = rowOf(from), c = colOf(from), t = typeOf(code);

    if (t === K || t === A) {
      const steps = t === K ? KING_STEP : ADV_STEP;
      for (const [dr, dc] of steps) {
        const nr = r + dr, nc = c + dc;
        if (!inPalace(side, nr, nc) || sameSide(board[idx(nr, nc)], code)) continue;
        out.push(enc(from, idx(nr, nc)));
      }
    } else if (t === B) {
      for (const [dr, dc] of BISHOP_STEP) {
        const nr = r + dr, nc = c + dc;
        if (!onBoard(nr, nc) || !ownHalf(side, nr)) continue;      // 象不过河
        if (board[idx(r + dr / 2, c + dc / 2)] !== 0) continue;    // 塞象眼
        if (sameSide(board[idx(nr, nc)], code)) continue;
        out.push(enc(from, idx(nr, nc)));
      }
    } else if (t === N) {
      for (const [dr, dc, lr, lc] of HORSE_STEP) {
        const nr = r + dr, nc = c + dc;
        if (!onBoard(nr, nc) || board[idx(r + lr, c + lc)] !== 0) continue;  // 蹩马腿
        if (sameSide(board[idx(nr, nc)], code)) continue;
        out.push(enc(from, idx(nr, nc)));
      }
    } else if (t === R || t === C) {
      for (const [dr, dc] of KING_STEP) {
        let nr = r + dr, nc = c + dc, jumped = false;
        while (onBoard(nr, nc)) {
          const target = board[idx(nr, nc)];
          if (t === R) {
            if (target === 0) out.push(enc(from, idx(nr, nc)));
            else { if (!sameSide(target, code)) out.push(enc(from, idx(nr, nc))); break; }
          } else if (!jumped) {
            if (target === 0) out.push(enc(from, idx(nr, nc)));
            else jumped = true;                                     // 找到炮架
          } else if (target !== 0) {                                // 炮架之后的第一个子
            if (!sameSide(target, code)) out.push(enc(from, idx(nr, nc)));
            break;
          }
          nr += dr; nc += dc;
        }
      }
    } else if (t === P) {
      const fr = r + (side === RED ? -1 : 1);
      if (onBoard(fr, c) && !sameSide(board[idx(fr, c)], code)) out.push(enc(from, idx(fr, c)));
      if (crossedRiver(side, r)) {                                   // 过河后才能横走
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (onBoard(r, nc) && !sameSide(board[idx(r, nc)], code)) out.push(enc(from, idx(r, nc)));
        }
      }
    }
  }
  return out;
}

// 某个格子是否被 bySide 攻击（含"飞将"：同列中间无子时，对方将帅也算攻击这条线）
function isAttacked(board, tr, tc, bySide) {
  // 马
  for (const [dr, dc, lr, lc] of HORSE_STEP) {
    const hr = tr - dr, hc = tc - dc;
    if (!onBoard(hr, hc)) continue;
    if (board[idx(hr, hc)] === mk(bySide, N) && board[idx(hr + lr, hc + lc)] === 0) return true;
  }
  // 将帅（相邻一格）+ 飞将（同列直线上第一个子若是对方将帅）
  for (const [dr, dc] of KING_STEP) {
    const r = tr + dr, c = tc + dc;
    if (onBoard(r, c) && board[idx(r, c)] === mk(bySide, K)) return true;
  }
  for (const dir of [-1, 1]) {
    let r = tr + dir;
    while (onBoard(r, tc)) {
      const code = board[idx(r, tc)];
      if (code) { if (code === mk(bySide, K)) return true; break; }
      r += dir;
    }
  }
  // 士
  for (const [dr, dc] of ADV_STEP) {
    const r = tr + dr, c = tc + dc;
    if (onBoard(r, c) && board[idx(r, c)] === mk(bySide, A)) return true;
  }
  // 象
  for (const [dr, dc] of BISHOP_STEP) {
    const er = tr - dr, ec = tc - dc;
    if (!onBoard(er, ec)) continue;
    if (board[idx(er, ec)] === mk(bySide, B) && board[idx(tr - dr / 2, tc - dc / 2)] === 0) return true;
  }
  // 兵卒：对方兵在正前方一格（对方视角的前进方向），或左右一格且已过河
  const back = bySide === RED ? 1 : -1;                              // 对方兵在目标的"身后一格"
  if (onBoard(tr + back, tc) && board[idx(tr + back, tc)] === mk(bySide, P)) return true;
  for (const dc of [-1, 1]) {
    const c = tc + dc;
    if (!onBoard(tr, c)) continue;
    if (board[idx(tr, c)] === mk(bySide, P) && crossedRiver(bySide, tr)) return true;
  }
  // 车 / 炮
  for (const [dr, dc] of KING_STEP) {
    let r = tr + dr, c = tc + dc, screens = 0;
    while (onBoard(r, c)) {
      const code = board[idx(r, c)];
      if (code !== 0) {
        if (screens === 0) {
          if (code === mk(bySide, R)) return true;
          screens = 1;                                               // 车被挡住，之后只可能是炮
        } else {
          if (code === mk(bySide, C)) return true;
          break;
        }
      }
      r += dr; c += dc;
    }
  }
  return false;
}

function findGeneral(board, side) {
  const r0 = side === RED ? 7 : 0, r1 = side === RED ? 9 : 2;
  const target = mk(side, K);
  for (let r = r0; r <= r1; r++) for (let c = 3; c <= 5; c++) if (board[idx(r, c)] === target) return idx(r, c);
  return -1;
}

function inCheck(board, side) {
  const g = findGeneral(board, side);
  if (g < 0) return true;
  return isAttacked(board, rowOf(g), colOf(g), 1 - side);
}

function doMove(board, mv) {
  const from = fromOf(mv), to = toOf(mv);
  const captured = board[to];
  board[to] = board[from];
  board[from] = 0;
  return captured;
}
function undoMove(board, mv, captured) {
  const from = fromOf(mv), to = toOf(mv);
  board[from] = board[to];
  board[to] = captured;
}

// 合法走法 = 伪合法走法 - 走完自己被将军（含将帅照面）的
function legalMoves(board, side) {
  const out = [];
  for (const mv of pseudoMoves(board, side)) {
    const cap = doMove(board, mv);
    if (!inCheck(board, side)) out.push(mv);
    undoMove(board, mv, cap);
  }
  return out;
}

function hasLegalMove(board, side) { return legalMoves(board, side).length > 0; }

// 结果：{over, winner, reason} —— 象棋里将死与困毙都是走子方输
function gameResult(board, side) {
  if (hasLegalMove(board, side)) return { over: false, winner: -1, reason: '' };
  const check = inCheck(board, side);
  return { over: true, winner: 1 - side, reason: check ? '将死' : '困毙' };
}

function perft(board, side, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(board, side);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const mv of moves) {
    const cap = doMove(board, mv);
    total += perft(board, 1 - side, depth - 1);
    undoMove(board, mv, cap);
  }
  return total;
}

// ==================== 电脑 AI ====================
// 路线：negamax + alpha-beta + 迭代加深 + 时间预算；评估 = 子力 + 位置表。
// 棋子位置表按「红方视角、行 0 在顶部」写死（行 9 是红方底线），黑方取上下镜像。
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const MATE = 30000;

const VAL = { 1: 10000, 2: 200, 3: 200, 4: 450, 5: 900, 6: 480, 7: 100 };
const PST = {
  // 兵：过河后价值随推进上升，到底线回落
  7: [
    12, 14, 18, 24, 26, 24, 18, 14, 12,
    18, 20, 26, 32, 34, 32, 26, 20, 18,
    14, 16, 20, 26, 28, 26, 20, 16, 14,
    8, 10, 14, 18, 20, 18, 14, 10, 8,
    4, 4, 6, 8, 8, 8, 6, 4, 4,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  // 马：中路好、边角差
  4: [
    -2, 0, 2, 4, 4, 4, 2, 0, -2,
    0, 4, 6, 8, 8, 8, 6, 4, 0,
    2, 6, 10, 12, 12, 12, 10, 6, 2,
    2, 8, 12, 14, 16, 14, 12, 8, 2,
    4, 10, 14, 16, 18, 16, 14, 10, 4,
    4, 10, 14, 16, 18, 16, 14, 10, 4,
    2, 8, 12, 14, 16, 14, 12, 8, 2,
    4, 6, 10, 12, 10, 12, 10, 6, 4,
    0, 2, 4, 4, 2, 4, 4, 2, 0,
    0, -4, 0, 0, 0, 0, 0, -4, 0,
  ],
  // 炮：中炮位（(7,4)/(2,4)）最高
  6: [
    0, 0, 2, 4, 6, 4, 2, 0, 0,
    0, 2, 2, 4, 6, 4, 2, 2, 0,
    0, 2, 4, 4, 6, 4, 4, 2, 0,
    0, 2, 4, 4, 6, 4, 4, 2, 0,
    2, 4, 6, 6, 8, 6, 6, 4, 2,
    2, 4, 6, 6, 8, 6, 6, 4, 2,
    2, 4, 6, 4, 8, 4, 6, 4, 2,
    4, 6, 8, 6, 10, 6, 8, 6, 4,
    4, 6, 6, 4, 8, 4, 6, 6, 4,
    6, 6, 4, 6, 6, 6, 4, 6, 6,
  ],
  // 车：巡河/巡线略有加成
  5: [
    12, 14, 12, 18, 20, 18, 12, 14, 12,
    14, 18, 16, 22, 24, 22, 16, 18, 14,
    12, 16, 14, 20, 22, 20, 14, 16, 12,
    12, 14, 12, 18, 20, 18, 12, 14, 12,
    12, 16, 14, 20, 22, 20, 14, 16, 12,
    12, 16, 14, 20, 22, 20, 14, 16, 12,
    12, 16, 14, 20, 22, 20, 14, 16, 12,
    12, 14, 12, 18, 20, 18, 12, 14, 12,
    14, 18, 16, 22, 24, 22, 16, 18, 14,
    12, 14, 12, 18, 20, 18, 12, 14, 12,
  ],
  // 士
  2: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 2, 0, 2, 0, 0, 0,
    0, 0, 0, 0, 4, 0, 0, 0, 0,
    0, 0, 0, 3, 0, 3, 0, 0, 0,
  ],
  // 象
  3: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 4, 0, 0, 0, 4, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    4, 0, 0, 0, 6, 0, 0, 0, 4,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 3, 0, 0, 0, 3, 0, 0,
  ],
  // 将帅：守在家门口最安全
  1: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, -6, -10, -6, 0, 0, 0,
    0, 0, 0, 0, -2, 0, 0, 0, 0,
    0, 0, 0, 2, 4, 2, 0, 0, 0,
  ],
};

function pstAt(type, side, sq) {
  const table = PST[type];
  if (!table) return 0;
  return side === RED ? table[sq] : table[(9 - rowOf(sq)) * 9 + colOf(sq)];
}

// 从 side 视角打分
function evaluate(board, side) {
  let score = 0, ownAdvisors = 0, ownElephants = 0, foeAdvisors = 0, foeElephants = 0;
  for (let sq = 0; sq < 90; sq++) {
    const code = board[sq];
    if (!code) continue;
    const t = typeOf(code), own = sideOf(code) === side;
    let v = VAL[t] + pstAt(t, sideOf(code), sq);
    if (t === A) { if (own) ownAdvisors++; else foeAdvisors++; }
    if (t === B) { if (own) ownElephants++; else foeElephants++; }
    score += own ? v : -v;
  }
  // 士象完整度：缺一个士/象都要扣分（守将的最后一道墙）
  score -= (2 - ownAdvisors) * 22 + (2 - ownElephants) * 18;
  score += (2 - foeAdvisors) * 22 + (2 - foeElephants) * 18;
  return score;
}

const TT_BITS = 16, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

const ZOB_PIECE = (function () {
  const arr = new Int32Array(16 * 90);
  let s = 0x2f6e2b1d >>> 0;
  for (let i = 0; i < arr.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    arr[i] = s | 0;
  }
  return arr;
})();
function hashBoard(board) {
  let h = 0;
  for (let sq = 0; sq < 90; sq++) { const c = board[sq]; if (c) h ^= ZOB_PIECE[c * 90 + sq]; }
  return h | 0;
}

// 时间预算压在「单次阻塞可接受」的范围内（界面是主线程同步搜，不做 Worker）
// 简单档：只搜 1 层（看完自己的着法 + 对手一步吃子），再叠一个很大的随机窗口，
// 所以它"不会明显白送子"，但看不出两步以上的东西、也不组织进攻。
const XQ_LEVELS = {
  easy:   { timeMs: 80, maxDepth: 1, random: 190, useQS: true, qsLimit: 1, useTT: false, useNull: false, useKillers: false },
  normal: { timeMs: 350, maxDepth: 6, random: 30, useQS: true, qsLimit: 4, useTT: true, useNull: false, useKillers: true },
  hard:   { timeMs: 700, maxDepth: 10, random: 0, useQS: true, qsLimit: 8, useTT: true, useNull: true, useKillers: true },
};

function mvScore(board, mv) { return board[toOf(mv)] ? 10 * VAL[typeOf(board[toOf(mv)])] - VAL[typeOf(board[fromOf(mv)])] : 0; }

// 着法排序：置换表着法 → 吃子(MVV-LVA) → 杀手着法 → 历史表
function orderMoves(ctx, board, moves, ply, ttMove) {
  const killers = ctx.killers[ply] || (ctx.killers[ply] = [0, 0]);
  const scored = moves.map(mv => {
    let s = 0;
    if (mv === ttMove) s = 1e7;
    else if (board[toOf(mv)]) s = 1e6 + mvScore(board, mv);
    else if (ctx.cfg.useKillers && (mv === killers[0] || mv === killers[1])) s = 9e5;
    if (ctx.cfg.useKillers) s += Math.min(ctx.history[mv], 8e5);
    return { mv, s };
  });
  scored.sort((a, b) => b.s - a.s);
  for (let i = 0; i < moves.length; i++) moves[i] = scored[i].mv;
}

function quiesce(ctx, board, side, alpha, beta, depth, ply) {
  if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) ctx.aborted = true;
  if (ctx.aborted) return 0;
  const stand = evaluate(board, side);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (depth <= 0) return alpha;

  const caps = [];
  for (const mv of legalMoves(board, side)) if (board[toOf(mv)] !== 0) caps.push(mv);
  orderMoves(ctx, board, caps, ply, 0);
  for (const mv of caps) {
    const captured = doMove(board, mv);
    const score = -quiesce(ctx, board, 1 - side, -beta, -alpha, depth - 1, ply + 1);
    undoMove(board, mv, captured);
    if (ctx.aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx, board, side, depth, alpha, beta, ply) {
  if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) ctx.aborted = true;
  if (ctx.aborted) return 0;

  if (findGeneral(board, side) < 0) return -MATE + ply;    // 本方将帅已不在（理论上不会发生）
  if (inCheck(board, side)) depth++;                        // 将军延展，避免漏杀
  if (depth <= 0) return ctx.cfg.useQS ? quiesce(ctx, board, side, alpha, beta, ctx.cfg.qsLimit, ply) : evaluate(board, side);

  const key = ctx.cfg.useTT ? hashBoard(board) : 0;
  let ttMove = 0;
  if (ctx.cfg.useTT) {
    const base = (key & TT_MASK) * 5;
    if (ctx.tt[base] === key && ctx.tt[base + 1] >= depth) {
      const flag = ctx.tt[base + 3], val = ctx.tt[base + 2];
      if (flag === TT_EXACT) return val;
      if (flag === TT_LOWER && val > alpha) alpha = val;
      else if (flag === TT_UPPER && val < beta) beta = val;
      if (alpha >= beta) return val;
    }
    ttMove = ctx.tt[base + 4];
  }

  const moves = legalMoves(board, side);
  if (moves.length === 0) return -MATE + ply;               // 将死 / 困毙都算走子方输
  orderMoves(ctx, board, moves, ply, ttMove);

  const alphaOrig = alpha;
  let best = -Infinity, bestMove = 0;
  for (const mv of moves) {
    const captured = doMove(board, mv);
    const score = -negamax(ctx, board, 1 - side, depth - 1, -beta, -alpha, ply + 1);
    undoMove(board, mv, captured);
    if (ctx.aborted) return 0;
    if (score > best) { best = score; bestMove = mv; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (!captured && ctx.cfg.useKillers) {
        const k = ctx.killers[ply];
        if (k && mv !== k[0]) { k[1] = k[0]; k[0] = mv; }
        ctx.history[mv] += depth * depth;
      }
      break;
    }
  }

  if (ctx.cfg.useTT) {
    const base = (key & TT_MASK) * 5;
    ctx.tt[base] = key; ctx.tt[base + 1] = depth; ctx.tt[base + 2] = best;
    ctx.tt[base + 3] = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    ctx.tt[base + 4] = bestMove;
  }
  return best;
}

// 迭代加深写成生成器：**每搜完一层** yield 一次，界面据此分片驱动。
// 每层只给「上一层耗时 ×3」的预算，并且事先估算「这层大概率搜不完就不开始」——
// 这样单次阻塞被压在很小的一段，界面不会因为长思考卡死。
function* searchIterator(board, side, cfg) {
  const start = now();
  const ctx = {
    cfg, nodes: 0, aborted: false, deadline: Infinity,
    killers: [], history: new Int32Array(90 * 90),
    tt: cfg.useTT ? new Int32Array(TT_SIZE * 5) : null,
  };
  const rootMoves = legalMoves(board, side);
  if (rootMoves.length === 0) return 0;
  if (rootMoves.length === 1) return rootMoves[0];

  // 低难度要按分数随机挑（random>0），必须每个根着法都用全窗口，否则拿到的只是边界值
  const wide = cfg.random > 0;
  let bestMove = rootMoves[0], lastScored = null, lastDepthMs = 0;

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    const estimate = Math.max(4, lastDepthMs * 3.5);
    if (now() - start + estimate > cfg.timeMs) break;      // 这层肯定搜不完，不开始（避免长时间卡顿）
    ctx.deadline = Math.min(now() + Math.max(30, lastDepthMs * 3), start + cfg.timeMs);
    ctx.aborted = false;

    const t0 = now();
    const scored = [];
    let alpha = -Infinity;
    for (const mv of rootMoves) {
      const captured = doMove(board, mv);
      const score = -negamax(ctx, board, 1 - side, depth - 1, -Infinity, wide ? Infinity : -alpha, 1);
      undoMove(board, mv, captured);
      if (ctx.aborted) break;
      scored.push({ mv, score });
      if (score > alpha) alpha = score;
    }
    if (ctx.aborted || scored.length !== rootMoves.length) break;   // 本层没搜完，沿用上一层的结论

    lastDepthMs = now() - t0;
    scored.sort((a, b) => b.score - a.score);
    lastScored = scored;
    bestMove = scored[0].mv;
    // 上一层的最优排到最前，下一层剪枝更狠
    rootMoves.sort((a, b) => scored.findIndex(x => x.mv === a) - scored.findIndex(x => x.mv === b));
    if (Math.abs(scored[0].score) > MATE - 200) break;     // 已经算到杀棋
    yield { depth };                                        // 让出主线程
  }

  // 随机化：从「与最优分差在 random 之内」的着法里抽一个（低难度才会明显失误）
  if (lastScored && cfg.random > 0) {
    const bestScore = lastScored[0].score;
    const pool = lastScored.filter(x => x.score >= bestScore - cfg.random);
    bestMove = pool[Math.floor(Math.random() * pool.length)].mv;
  }
  return bestMove;
}

// 同步版本（测试用）：直接把生成器跑干
function searchBestMove(board, side, cfg) {
  const it = searchIterator(board, side, cfg);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

let xqLevel = 'normal';
function setXqLevel(level) { if (XQ_LEVELS[level]) xqLevel = level; }
function xqConfig() { return XQ_LEVELS[xqLevel] || XQ_LEVELS.normal; }

// ==================== RENDERER ====================
// 界面与交互：棋盘渲染、点选/拖拽、撤回、自定义摆子。
// 这个标记同时被 tools/selftest.js 用来切出上面的纯逻辑，不要改名。
const XQ = {
  active: false, started: false,
  board: new Int8Array(90), side: RED,
  humanSide: RED, flipped: false,
  mode: 'standard',            // standard | custom
  editing: false,              // 自定义模式下是否在摆子
  trayPiece: 0,                // 托盘里选中的棋子编码
  selected: -1, targets: [],
  lastMove: null, checkSq: -1,
  over: false, thinking: false,
  gen: 0,                      // 世代号：重开/撤回自增，用来作废正在跑的搜索
  rep: {},
};
const playHistory = [];
const editHistory = [];
const pieceEls = new Map();    // 格号 -> 棋子元素（保留元素才能让走子有滑动动画）

const $ = id => document.getElementById(id);
const boardEl = () => $('xq-board');

function setXqStatus(msg) { const el = $('xq-status'); if (el) el.textContent = msg; }

// ---- 棋盘线（SVG 以「格」为单位，随元素缩放自动适配） ----
function buildGrid() {
  const svg = $('xq-grid');
  if (!svg) return;
  // 关键：viewBox 直接用「格」作单位（9.6 × 10.6 格），SVG 会随元素尺寸自动缩放，
  // 下面所有坐标才是格坐标。漏了这行就会画成左上角 9.6×10.6 像素，什么都看不见。
  svg.setAttribute('viewBox', '0 0 9.6 10.6');
  const m = 0.8, parts = [];
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  for (let r = 0; r < 10; r++) parts.push(line(m, m + r, m + 8, m + r));
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) parts.push(line(m + c, m, m + c, m + 9));
    else { parts.push(line(m + c, m, m + c, m + 4)); parts.push(line(m + c, m + 5, m + c, m + 9)); }
  }
  parts.push(line(m + 3, m, m + 5, m + 2), line(m + 5, m, m + 3, m + 2));        // 上方九宫
  parts.push(line(m + 3, m + 7, m + 5, m + 9), line(m + 5, m + 7, m + 3, m + 9)); // 下方九宫
  // 兵位 / 炮位的小角标
  const tick = (r, c) => {
    let s = '';
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const nr = r + dy, nc = c + dx;
      if (nc < 0 || nc > 8 || nr < 0 || nr > 9) continue;
      const x = m + c + dx * 0.12, y = m + r + dy * 0.12, d = 0.17;
      s += line(x, y, x + dx * d, y) + line(x, y, x, y + dy * d);
    }
    return s;
  };
  for (const c of [0, 2, 4, 6, 8]) { parts.push(tick(3, c)); parts.push(tick(6, c)); }
  for (const c of [1, 7]) { parts.push(tick(2, c)); parts.push(tick(7, c)); }

  svg.innerHTML =
    `<g fill="none" stroke="rgba(92,64,28,.72)" stroke-width="0.035" stroke-linecap="round">${parts.join('')}</g>` +
    `<rect x="${m - 0.2}" y="${m - 0.2}" width="8.4" height="9.4" rx="0.06" fill="none" stroke="rgba(92,64,28,.78)" stroke-width="0.07"/>` +
    `<text x="${m + 1.35}" y="${m + 4.63}" font-size="0.6" fill="rgba(110,76,32,.8)" font-family="serif" letter-spacing="0.15">楚 河</text>` +
    `<text x="${m + 5.35}" y="${m + 4.63}" font-size="0.6" fill="rgba(110,76,32,.8)" font-family="serif" letter-spacing="0.15">漢 界</text>`;
}

// ---- 尺寸：按可用空间算出每格边长，写进 --cs ----
function layoutXq() {
  const zone = $('xq-zone'), board = boardEl();
  if (!zone || !board || !XQ.active) return;
  // 注意：clientHeight 是「内容 + padding」，而这里要让开的是 padding，
  // 所以必须自己减掉 padding，否则改了 padding 尺寸也不会变。
  const cs2 = getComputedStyle(zone);
  const availW = zone.clientWidth - parseFloat(cs2.paddingLeft) - parseFloat(cs2.paddingRight);
  const availH = zone.clientHeight - parseFloat(cs2.paddingTop) - parseFloat(cs2.paddingBottom);
  const cell = Math.max(15, Math.min(availW / 9.6, availH / 10.6, 78));
  board.style.setProperty('--cs', cell.toFixed(2) + 'px');
}

// 格号 -> 棋盘坐标（单位：格）。flipped 时上下翻转，让玩家自己那方总在下方
function squareXY(sq) {
  const r = rowOf(sq), c = colOf(sq);
  return { x: 0.8 + c, y: 0.8 + (XQ.flipped ? 9 - r : r) };
}
function placeEl(el, sq) {
  const p = squareXY(sq);
  el.style.left = `calc(var(--cs) * ${p.x})`;
  el.style.top = `calc(var(--cs) * ${p.y})`;
}
function createPieceEl(code, cls) {
  const el = document.createElement('div');
  el.className = 'xq-disc ' + (cls || 'xq-piece') + ' ' + (sideOf(code) === RED ? 'red' : 'black');
  el.dataset.code = String(code);
  el.textContent = pieceChar(code);
  return el;
}

function fullRenderPieces() {
  const wrap = $('xq-pieces');
  if (!wrap) return;
  for (const el of pieceEls.values()) el.remove();
  pieceEls.clear();
  for (let sq = 0; sq < 90; sq++) {
    const code = XQ.board[sq];
    if (!code) continue;
    const el = createPieceEl(code);
    el.dataset.sq = String(sq);
    placeEl(el, sq);
    wrap.appendChild(el);
    pieceEls.set(sq, el);
  }
  applySelectedClass();
}

// 走子时复用同一个元素，让它「滑」过去
function animateMoveTo(from, to, captured) {
  const el = pieceEls.get(from);
  if (!el) { fullRenderPieces(); return; }
  pieceEls.delete(from);
  if (captured) {
    const dead = pieceEls.get(to);
    if (dead) { dead.classList.add('captured'); setTimeout(() => dead.remove(), 240); }
  }
  el.dataset.sq = String(to);
  el.dataset.code = String(XQ.board[to] || 0);
  placeEl(el, to);
  pieceEls.set(to, el);
}

function applySelectedClass() {
  for (const [sq, el] of pieceEls) el.classList.toggle('selected', sq === XQ.selected);
}

function renderMarks() {
  const wrap = $('xq-marks');
  if (!wrap) return;
  wrap.innerHTML = '';
  const add = (sq, cls) => {
    const el = document.createElement('div');
    el.className = 'xq-mark ' + cls;
    const p = squareXY(sq);
    el.style.left = `calc(var(--cs) * ${p.x})`;
    el.style.top = `calc(var(--cs) * ${p.y})`;
    wrap.appendChild(el);
  };
  if (XQ.lastMove) { add(XQ.lastMove.from, 'last'); add(XQ.lastMove.to, 'last'); }
  for (const t of XQ.targets) add(t.to, t.capture ? 'cap' : 'dot');
  if (XQ.checkSq >= 0) add(XQ.checkSq, 'check');
}

function updateXqStatus() {
  if (XQ.over) return;
  if (XQ.editing) { setXqStatus('摆子中：选托盘里的棋子再点棋盘；点棋盘上已有的棋子可移除'); return; }
  if (XQ.thinking) { setXqStatus('电脑思考中…'); return; }
  const sideName = XQ.side === RED ? '红方' : '黑方';
  const check = inCheck(XQ.board, XQ.side) ? '，被将军！' : '';
  setXqStatus((XQ.side === XQ.humanSide ? '轮到你走（' : '轮到电脑（') + sideName + '）' + check);
}

function refreshCheckMark() {
  XQ.checkSq = -1;
  for (const s of [RED, BLACK]) {
    if (inCheck(XQ.board, s)) { XQ.checkSq = findGeneral(XQ.board, s); break; }
  }
}
function refreshBoard() { refreshCheckMark(); fullRenderPieces(); renderMarks(); updateXqStatus(); }

// ---- 历史 / 撤回 ----
function snapshot() {
  return { board: Int8Array.from(XQ.board), side: XQ.side, lastMove: XQ.lastMove, rep: Object.assign({}, XQ.rep) };
}
function restore(snap) {
  XQ.board = Int8Array.from(snap.board);
  XQ.side = snap.side;
  XQ.lastMove = snap.lastMove;
  XQ.rep = Object.assign({}, snap.rep);
}
function pushPlayHistory() { playHistory.push(snapshot()); if (playHistory.length > 400) playHistory.shift(); }
function pushEditHistory() { editHistory.push(snapshot()); if (editHistory.length > 400) editHistory.shift(); }

function undoXq() {
  if (XQ.mode === 'custom' && XQ.editing) {
    if (!editHistory.length) { setXqStatus('没有可撤回的摆子操作'); return; }
    restore(editHistory.pop());
    refreshBoard();
    return;
  }
  if (XQ.thinking) { XQ.gen++; XQ.thinking = false; }     // 打断电脑思考
  if (!playHistory.length) { setXqStatus('已经回到开局，没有可撤回的着法'); return; }
  do { restore(playHistory.pop()); } while (playHistory.length && XQ.side !== XQ.humanSide);
  XQ.over = false;
  hideResult();
  XQ.selected = -1; XQ.targets = [];
  refreshBoard();
}

// ---- 局面记录（重复局面判和） ----
function recordPosition() {
  const key = toFen(XQ.board, XQ.side);
  XQ.rep[key] = (XQ.rep[key] || 0) + 1;
  return XQ.rep[key];
}

// ---- 走子 ----
function afterMove() {
  const repeats = recordPosition();
  XQ.checkSq = -1;
  refreshCheckMark();
  const res = gameResult(XQ.board, XQ.side);
  if (res.over) { endXqGame(res.winner, res.reason); return true; }
  if (repeats >= 3) { endXqGame(-1, '三次重复局面'); return true; }
  updateXqStatus();
  return false;
}

function applyMove(from, to) {
  pushPlayHistory();
  const captured = doMove(XQ.board, enc(from, to));
  XQ.side = 1 - XQ.side;
  XQ.lastMove = { from, to };
  XQ.selected = -1; XQ.targets = [];
  animateMoveTo(from, to, captured);
  renderMarks();
  return afterMove();
}

function endXqGame(winner, reason) {
  XQ.over = true; XQ.thinking = false;
  XQ.selected = -1; XQ.targets = [];
  refreshCheckMark();
  fullRenderPieces(); renderMarks();
  const humanWon = winner === XQ.humanSide;
  const text = winner === -1 ? '和棋' : (humanWon ? '你赢了！' : '你输了！');
  setXqStatus(winner === -1 ? reason : reason + ' · ' + (winner === RED ? '红方胜' : '黑方胜'));
  showResult(text, winner === -1 ? 'draw' : (humanWon ? 'win' : 'lose'));
}

function showResult(text, cls) {
  const overlay = $('win-overlay'), t = $('win-text');
  if (!overlay || !t) return;
  overlay.classList.remove('hidden');
  t.className = cls;
  t.textContent = text;
  const undoBtn = $('btn-win-undo');      // 输了也能撤回（结算浮层会盖住底栏的撤回按钮）
  if (undoBtn) undoBtn.style.display = '';
}
function hideResult() { const o = $('win-overlay'); if (o) o.classList.add('hidden'); }

// ---- 点选 / 拖拽 ----
function squareFromPoint(clientX, clientY) {
  const board = boardEl();
  if (!board) return -1;
  const rect = board.getBoundingClientRect();
  const cs = rect.width / 9.6;
  const x = (clientX - rect.left) / cs - 0.8;
  const y = (clientY - rect.top) / cs - 0.8;
  let c = Math.round(x), r = Math.round(y);
  if (c < -0.6 || c > 8.6 || r < -0.6 || r > 9.6) return -1;
  c = Math.max(0, Math.min(8, c)); r = Math.max(0, Math.min(9, r));
  if (XQ.flipped) r = 9 - r;
  return idx(r, c);
}

function selectSquare(sq) {
  XQ.selected = sq;
  const from = sq;
  XQ.targets = legalMoves(XQ.board, XQ.side)
    .filter(mv => fromOf(mv) === from)
    .map(mv => ({ to: toOf(mv), capture: XQ.board[toOf(mv)] !== 0 }));
  applySelectedClass();
  renderMarks();
}
function clearSelection() { XQ.selected = -1; XQ.targets = []; applySelectedClass(); renderMarks(); }

function onBoardTap(sq) {
  if (sq < 0 || XQ.thinking) return;
  if (XQ.editing) { editTap(sq); return; }
  if (XQ.over || XQ.side !== XQ.humanSide) return;
  const code = XQ.board[sq];
  if (XQ.selected >= 0) {
    const hit = XQ.targets.find(t => t.to === sq);
    if (hit) { const from = XQ.selected; clearSelection(); applyMove(from, sq); if (!XQ.over && XQ.side !== XQ.humanSide) scheduleAI(); return; }
    if (sq === XQ.selected) return;                                   // 再点一次自己：保持选中
    if (code && sideOf(code) === XQ.humanSide) { selectSquare(sq); return; }
    clearSelection();
    return;
  }
  if (code && sideOf(code) === XQ.humanSide) selectSquare(sq);
}

// ---- 电脑走子（分片搜索，不卡界面） ----
function scheduleAI() {
  if (XQ.over || XQ.editing || !XQ.active) return;
  XQ.thinking = true;
  updateXqStatus();
  const gen = XQ.gen;
  setTimeout(() => runAI(gen), 200);      // 先让「思考中」画出来
}

function runAI(gen) {
  if (gen !== XQ.gen || !XQ.thinking) return;
  // 在副本上搜：中途被打断也不会把真实棋盘留在半路状态
  const board = Int8Array.from(XQ.board);
  const side = XQ.side;
  const it = searchIterator(board, side, xqConfig());
  const step = () => {
    if (gen !== XQ.gen || !XQ.thinking) return;
    let r;
    try { r = it.next(); } catch (e) { XQ.thinking = false; console.error(e); updateXqStatus(); return; }
    if (!r.done) { setTimeout(step, 0); return; }          // 每搜完一层让出主线程
    XQ.thinking = false;
    if (gen !== XQ.gen) return;
    const mv = r.value;
    if (!mv) { updateXqStatus(); return; }
    if (!legalMoves(XQ.board, XQ.side).includes(mv)) { updateXqStatus(); return; }
    applyMove(fromOf(mv), toOf(mv));
    if (!XQ.over && XQ.side !== XQ.humanSide) scheduleAI();
  };
  step();
}

// ---- 自定义摆子 ----
function renderTray() {
  const tray = $('xq-tray');
  if (!tray) return;
  tray.innerHTML = '';
  const mkSide = (side) => {
    const box = document.createElement('div');
    box.className = 'tray-side';
    for (const t of [K, A, B, N, R, C, P]) {
      const code = mk(side, t);
      const b = document.createElement('button');
      b.className = 'tray-item ' + (side === RED ? 'red' : 'black');
      b.type = 'button';
      b.textContent = pieceChar(code);
      b.setAttribute('aria-pressed', String(XQ.trayPiece === code));
      b.setAttribute('aria-label', (side === RED ? '红' : '黑') + TYPE_NAME[t]);
      b.dataset.piece = String(code);
      box.appendChild(b);
    }
    return box;
  };
  tray.appendChild(mkSide(RED));
  const sep = document.createElement('div'); sep.className = 'tray-sep'; tray.appendChild(sep);
  tray.appendChild(mkSide(BLACK));
  const hint = document.createElement('div');
  hint.className = 'tray-hint';
  hint.textContent = '选中棋子 → 点棋盘落子；直接点棋盘上的棋子可移除';
  tray.appendChild(hint);
}

function editTap(sq) {
  if (XQ.trayPiece) {
    pushEditHistory();
    XQ.board[sq] = XQ.trayPiece;
    refreshBoard();
    const el = pieceEls.get(sq);
    if (el) el.classList.add('placed');
    return;
  }
  if (!XQ.board[sq]) { setXqStatus('先在下方托盘里选一枚棋子，再点棋盘放置'); return; }
  pushEditHistory();
  XQ.board[sq] = 0;
  refreshBoard();
}

function setTrayPiece(code) {
  XQ.trayPiece = (XQ.trayPiece === code) ? 0 : code;
  renderTray();
  if (XQ.trayPiece) setXqStatus('已选中 ' + pieceChar(code) + '：点棋盘放置（再点一次托盘可取消）');
  else updateXqStatus();
}

function setBoardTo(board, side) {
  pushEditHistory();
  XQ.board = board;
  XQ.side = side;
  XQ.lastMove = null;
  refreshBoard();
}

// 开局前校验：摆出来的局面必须是一盘合法棋
function validateSetup() {
  const errs = [];
  for (const side of [RED, BLACK]) {
    const label = side === RED ? '红方' : '黑方';
    if (findGeneral(XQ.board, side) < 0) errs.push(label + '没有将/帅');
    const cnt = {};
    for (let sq = 0; sq < 90; sq++) {
      const code = XQ.board[sq];
      if (!code || sideOf(code) !== side) continue;
      const t = typeOf(code), r = rowOf(sq), c = colOf(sq);
      cnt[t] = (cnt[t] || 0) + 1;
      if ((t === K || t === A) && !inPalace(side, r, c)) errs.push(label + '的' + TYPE_NAME[t] + '不在九宫内');
      if (t === B && !ownHalf(side, r)) errs.push(label + '的象过了河');
      if (t === P && (side === RED ? r > 6 : r < 3)) errs.push(label + '的' + TYPE_NAME[t] + '位置不合理');
    }
    for (const t of [K, A, B, N, R, C, P]) if ((cnt[t] || 0) > PIECE_LIMIT[t]) errs.push(label + TYPE_NAME[t] + '超过 ' + PIECE_LIMIT[t] + ' 个');
  }
  // 将帅照面
  const gRed = findGeneral(XQ.board, RED), gBlack = findGeneral(XQ.board, BLACK);
  if (gRed >= 0 && gBlack >= 0 && colOf(gRed) === colOf(gBlack)) {
    let blocked = false;
    for (let r = rowOf(gBlack) + 1; r < rowOf(gRed); r++) if (XQ.board[idx(r, colOf(gRed))] !== 0) { blocked = true; break; }
    if (!blocked) errs.push('将帅照面（同一列中间无子）');
  }
  // 不该出现「没轮到走的一方正被将军」
  if (!errs.length && inCheck(XQ.board, 1 - XQ.side)) errs.push('轮到' + (XQ.side === RED ? '红' : '黑') + '走，但对方正被将军（局面不合法）');
  return errs;
}

const SAMPLES = [
  { name: '一步杀', fen: '4k4/8R/R8/9/9/4P4/9/9/9/4K4 w' },
  { name: '单车例胜', fen: '3k5/9/9/9/9/9/9/9/9/R3K4 w' },
];
let sampleIdx = 0;

function startCustomGame() {
  const errs = validateSetup();
  if (errs.length) { setXqStatus('还不能开始：' + errs[0]); return; }
  XQ.trayPiece = 0;
  leaveEdit();
  XQ.over = false;
  playHistory.length = 0;
  editHistory.length = 0;
  XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
  XQ.rep = {};
  recordPosition();
  hideResult();
  refreshBoard();
  if (XQ.side !== XQ.humanSide) scheduleAI();
}

function enterEdit() {
  XQ.editing = true;
  XQ.thinking = false; XQ.gen++;
  XQ.over = false;
  XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
  $('xq-panel').classList.add('editing');
  $('xq-tray').classList.remove('hidden');
  hideResult();
  renderTray();
  layoutXq();          // 托盘占掉下方空间，棋盘必须重新算尺寸，否则会被托盘压住
  refreshBoard();
}
function leaveEdit() {
  XQ.editing = false;
  $('xq-panel').classList.remove('editing');
  $('xq-tray').classList.add('hidden');
  layoutXq();          // 棋盘恢复原来的大小
}

// ---- 新开一局 ----
function newXqGame() {
  XQ.gen++; XQ.thinking = false; XQ.over = false;
  XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
  playHistory.length = 0; editHistory.length = 0; XQ.rep = {};
  hideResult();
  if (XQ.mode === 'custom') { enterEdit(); return; }
  leaveEdit();
  XQ.board = initialBoard();
  XQ.side = RED;
  XQ.flipped = XQ.humanSide === BLACK;
  recordPosition();
  refreshBoard();
  if (XQ.side !== XQ.humanSide) scheduleAI();
}

// ---- 设置面板 ----
function syncXqSettings() {
  document.querySelectorAll('#xq-mode .seg-btn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.xqMode === XQ.mode)));
  document.querySelectorAll('#xq-side .seg-btn').forEach(b =>
    b.setAttribute('aria-pressed', String((b.dataset.xqSide === 'red' ? RED : BLACK) === XQ.humanSide)));
  document.querySelectorAll('#xq-turn .seg-btn').forEach(b =>
    b.setAttribute('aria-pressed', String((b.dataset.xqTurn === 'red' ? RED : BLACK) === XQ.side)));
  const custom = XQ.mode === 'custom';
  $('xq-turn-group').style.display = custom ? '' : 'none';
  $('xq-edit-tools').style.display = custom ? '' : 'none';
  $('xq-start').style.display = custom ? '' : 'none';
}

function setXqMode(mode) {
  const same = XQ.mode === mode;
  if (same && (mode === 'standard' || XQ.editing)) return;
  XQ.mode = mode;
  syncXqSettings();
  // 点「自定义」时即便模式没变也要回到摆子状态（比如刚「开始对局」完想接着改）
  if (mode === 'custom') enterEdit();
  else newXqGame();            // newXqGame 内部会 leaveEdit 并重排棋盘
}

function setXqHumanSide(side) {
  if (XQ.humanSide === side) return;
  XQ.humanSide = side;
  XQ.flipped = side === BLACK;
  syncXqSettings();
  if (XQ.mode === 'custom') { refreshBoard(); }
  else newXqGame();
}

function bindXiangqi() {
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };

  bind('xq-undo', () => undoXq());
  bind('btn-win-undo', () => undoXq());
  bind('xq-set-toggle', function () {
    const panel = $('xq-set-panel');
    const willOpen = panel.classList.contains('op-closed');
    panel.classList.toggle('op-closed');
    this.setAttribute('aria-expanded', String(willOpen));
  });
  document.querySelectorAll('#xq-mode .seg-btn').forEach(b =>
    b.addEventListener('click', () => setXqMode(b.dataset.xqMode)));
  document.querySelectorAll('#xq-side .seg-btn').forEach(b =>
    b.addEventListener('click', () => setXqHumanSide(b.dataset.xqSide === 'red' ? RED : BLACK)));
  document.querySelectorAll('#xq-turn .seg-btn').forEach(b =>
    b.addEventListener('click', () => { XQ.side = b.dataset.xqTurn === 'red' ? RED : BLACK; syncXqSettings(); refreshCheckMark(); renderMarks(); updateXqStatus(); }));

  bind('xq-clear', () => { pushEditHistory(); XQ.board = new Int8Array(90); XQ.lastMove = null; refreshBoard(); });
  bind('xq-standard', () => { setBoardTo(initialBoard(), RED); });
  bind('xq-sample', () => {
    const s = SAMPLES[sampleIdx % SAMPLES.length]; sampleIdx++;
    const parsed = parseFen(s.fen);
    setBoardTo(parsed.board, parsed.side);
    setXqStatus('已载入示例残局：' + s.name + '（' + (parsed.side === RED ? '红' : '黑') + '先）');
  });
  bind('xq-start', () => startCustomGame());

  $('xq-tray').addEventListener('click', (e) => {
    const item = e.target.closest('.tray-item');
    if (item) setTrayPiece(+item.dataset.piece);
  });

  // 棋盘：点击 + 拖拽（点选是主路径，拖拽只做补充）
  const board = boardEl();
  let dragFrom = -1, dragMoved = false, downX = 0, downY = 0;
  board.addEventListener('pointerdown', (e) => {
    if (XQ.editing || XQ.thinking || XQ.over || XQ.side !== XQ.humanSide) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (sq < 0) return;
    const code = XQ.board[sq];
    if (!code || sideOf(code) !== XQ.humanSide) return;
    dragFrom = sq; dragMoved = false; downX = e.clientX; downY = e.clientY;
    selectSquare(sq);
  });
  board.addEventListener('pointermove', (e) => {
    if (dragFrom < 0) return;
    // 用位移判断是否算拖拽（movementX 在触屏 pointer 事件里不可靠）
    if (!dragMoved && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) dragMoved = true;
    if (dragMoved) {
      const el = pieceEls.get(XQ.selected);
      if (el) { el.style.cursor = 'grabbing'; el.style.zIndex = '4'; }
    }
  });
  const endDrag = (e) => {
    if (dragFrom < 0) return;
    const from = dragFrom; dragFrom = -1;
    const el = pieceEls.get(XQ.selected);
    if (el) { el.style.cursor = ''; el.style.zIndex = ''; }
    if (!dragMoved) return;                      // 只是点了一下，交给 click 处理
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (sq >= 0 && sq !== from && XQ.targets.some(t => t.to === sq)) {
      clearSelection();
      applyMove(from, sq);
      if (!XQ.over && XQ.side !== XQ.humanSide) scheduleAI();
    }
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', () => { dragFrom = -1; });

  board.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }     // 拖拽结束的那一下不再当点击
    onBoardTap(squareFromPoint(e.clientX, e.clientY));
  });

  window.addEventListener('resize', () => { layoutXq(); });

  // 点面板外面收起设置面板
  document.addEventListener('click', (e) => {
    const wrap = $('xq-set-wrap');
    if (wrap && !wrap.contains(e.target)) collapseXqPanels();
  });
}

function collapseXqPanels() {
  const p = $('xq-set-panel');
  if (p) p.classList.add('op-closed');
  const t = $('xq-set-toggle');
  if (t) t.setAttribute('aria-expanded', 'false');
}

// ==================== INIT ====================
buildGrid();
bindXiangqi();
syncXqSettings();

window.xiangqi = {
  activate() {
    XQ.active = true;
    $('xq-panel').classList.remove('hidden');
    if (!XQ.started) { XQ.started = true; newXqGame(); }
    else { XQ.gen++; XQ.thinking = false; refreshBoard(); }
    layoutXq();
  },
  deactivate() {
    XQ.active = false;
    XQ.gen++; XQ.thinking = false;
    collapseXqPanels();
    $('xq-panel').classList.add('hidden');
  },
  restart() { newXqGame(); layoutXq(); },
  setLevel(level) { setXqLevel(level); },
  getLevel() { return xqLevel; },
  // 供测试/调试
  _state: XQ,
};

})();
