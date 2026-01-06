/**
 * 五目オセロ 棋譜生成（CPU vs CPU）
 * - 盤: 9x9 表示だが、実際に置けるのは内側7x7（1..7）
 * - 勝利: 5連
 * - 反転: オセロ方式（8方向で挟めば反転）
 * - 出力: case1.json .. case4.json
 *
 * 実行:
 *   node generate_kifu.js
 *
 * 重要:
 * - 1手あたり最大30秒なので、4ケース完走はかなり時間がかかることがあります。
 * - 途中で止めても、生成済みのcase*.jsonは残ります（上書き保存）。
 */

const fs = require("fs");

const THINK_TIME_MS = 30000;     // 1手最大思考時間（30秒）
const MAX_PLY = 49;             // 7x7 = 49手で満局
const TT_MAX = 2_000_000;       // 置換表の上限（メモリと相談）
const YIELD_EVERY = 3500;       // 反復中にイベントループへ譲る頻度
const ROOT_MAXCAND_EARLY = 22;  // 序盤候補
const ROOT_MAXCAND_LATE  = 30;  // 中終盤候補
const CAND_RADIUS_EARLY  = 3;
const CAND_RADIUS_LATE   = 4;

const N = 9;
const PLAY_MIN = 1, PLAY_MAX = 7;
const EMPTY = 0, BLACK = 1, WHITE = 2;
const dirs8 = [
  [-1,-1],[-1,0],[-1,1],
  [0,-1],       [0,1],
  [1,-1],[1,0],[1,1]
];
const checkDirs = [[1,0],[0,1],[1,1],[1,-1]];

const opp = (c)=> (c===BLACK?WHITE:BLACK);
const playable = (r,c)=> (r>=PLAY_MIN && r<=PLAY_MAX && c>=PLAY_MIN && c<=PLAY_MAX);

function nowMs(){ return Number(process.hrtime.bigint()/1000000n); }

// ===== Board helpers =====
// board: Uint8Array length 81, index = r*9 + c
function idx(r,c){ return r*N + c; }

function cloneBoard(b){
  const nb = new Uint8Array(b.length);
  nb.set(b);
  return nb;
}

function countStones(b){
  let n=0;
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      if(b[idx(r,c)]!==EMPTY) n++;
    }
  }
  return n;
}

function anyStoneExists(b){
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      if(b[idx(r,c)]!==EMPTY) return true;
    }
  }
  return false;
}

function inB(r,c){ return r>=0 && r<N && c>=0 && c<N; }

function flips(b, r, c, col){
  // return list of indices to flip (as int[])
  const out = [];
  const o = opp(col);
  for(const [dR,dC] of dirs8){
    let x=r+dR, y=c+dC;
    const tmp = [];
    while(inB(x,y) && b[idx(x,y)]===o){
      tmp.push(idx(x,y));
      x+=dR; y+=dC;
    }
    if(tmp.length && inB(x,y) && b[idx(x,y)]===col){
      for(const k of tmp) out.push(k);
    }
  }
  return out;
}

function applyMoveInPlace(b, r, c, col){
  if(!playable(r,c)) return false;
  const k = idx(r,c);
  if(b[k]!==EMPTY) return false;
  b[k]=col;
  const f = flips(b, r, c, col);
  for(const p of f) b[p]=col;
  return true;
}

function hasFive(b, col){
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      if(b[idx(r,c)]!==col) continue;
      for(const [dR,dC] of checkDirs){
        let n=1, x=r+dR, y=c+dC;
        while(playable(x,y) && b[idx(x,y)]===col){
          n++;
          if(n>=5) return true;
          x+=dR; y+=dC;
        }
      }
    }
  }
  return false;
}

function legalMoves(b){
  const m=[];
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      if(b[idx(r,c)]===EMPTY) m.push([r,c]);
    }
  }
  return m;
}

// ===== Move candidates =====
function candidateMoves(b, radius){
  if(!anyStoneExists(b)){
    // start neighborhood around center of 7x7 (which is (4,4) in 1..7)
    return [[4,4],[4,3],[3,4],[4,5],[5,4],[3,3],[5,5],[3,5],[5,3]];
  }

  const stones = countStones(b);
  if(stones >= 36){
    return legalMoves(b); // endgame: everything
  }

  const set = new Set();
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      if(b[idx(r,c)]===EMPTY) continue;
      for(let dr=-radius; dr<=radius; dr++){
        for(let dc=-radius; dc<=radius; dc++){
          const rr=r+dr, cc=c+dc;
          if(playable(rr,cc) && b[idx(rr,cc)]===EMPTY){
            set.add(rr*10+cc); // compact
          }
        }
      }
    }
  }
  const out=[];
  for(const v of set){
    out.push([Math.floor(v/10), v%10]);
  }
  return out;
}

// ===== Threat / pattern features (lightweight) =====
function lineFeature(b, r, c, col, dR, dC){
  let a=0, x=r+dR, y=c+dC;
  while(playable(x,y) && b[idx(x,y)]===col){ a++; x+=dR; y+=dC; }
  const end1 = (playable(x,y) && b[idx(x,y)]===EMPTY) ? 1 : 0;

  let bcnt=0; x=r-dR; y=c-dC;
  while(playable(x,y) && b[idx(x,y)]===col){ bcnt++; x-=dR; y-=dC; }
  const end2 = (playable(x,y) && b[idx(x,y)]===EMPTY) ? 1 : 0;

  return { len: 1+a+bcnt, openEnds: end1+end2 };
}

function countImmediateWins(b, col, candList){
  let cnt=0;
  const moves = candList || legalMoves(b);
  for(const [r,c] of moves){
    if(b[idx(r,c)]!==EMPTY) continue;
    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb, r,c, col)) continue;
    if(hasFive(nb, col)) cnt++;
    if(cnt>=2) return 2;
  }
  return cnt;
}

// ===== Evaluation =====
function evaluate(b, meCol){
  const opCol = opp(meCol);

  if(hasFive(b, meCol)) return 1e15;
  if(hasFive(b, opCol)) return -1e15;

  let score = 0;

  // center preference (small)
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      const v=b[idx(r,c)];
      if(v===EMPTY) continue;
      const centerDist = Math.abs(r-4)+Math.abs(c-4);
      const w = 6 - centerDist; // 6..?
      score += (v===meCol ? +w : -w);
    }
  }

  function addFor(col, sign){
    for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
      for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
        if(b[idx(r,c)]!==col) continue;
        for(const [dR,dC] of checkDirs){
          const f=lineFeature(b,r,c,col,dR,dC);
          if(f.len>=4){
            if(f.openEnds===2) score += sign*1200000;
            else if(f.openEnds===1) score += sign*260000;
            else score += sign*30000;
          }else if(f.len===3){
            if(f.openEnds===2) score += sign*35000;
            else if(f.openEnds===1) score += sign*9000;
            else score += sign*900;
          }else if(f.len===2){
            if(f.openEnds===2) score += sign*1200;
            else if(f.openEnds===1) score += sign*320;
            else score += sign*40;
          }
        }
      }
    }
  }
  addFor(meCol, +1);
  addFor(opCol, -1);

  // double-threat / immediate wins count (near-candidates)
  const cand = candidateMoves(b, 3);
  const myWins = countImmediateWins(b, meCol, cand);
  const opWins = countImmediateWins(b, opCol, cand);

  if(myWins>=2) score += 5e8;
  else if(myWins===1) score += 8e6;

  if(opWins>=2) score -= 6e8;
  else if(opWins===1) score -= 1.2e7;

  return score;
}

// ===== Zobrist hashing for TT =====
function makeZobrist(){
  // 7x7 only => 49 cells, but store in 9x9 indices for simplicity
  const rand64 = () => {
    // xorshift64*
    let x = BigInt(Math.floor(Math.random()*2**30)) << 34n
          ^ BigInt(Math.floor(Math.random()*2**30)) << 4n
          ^ BigInt(Math.floor(Math.random()*16));
    x ^= x >> 12n; x ^= x << 25n; x ^= x >> 27n;
    return (x * 2685821657736338717n) & ((1n<<64n)-1n);
  };

  const table = Array.from({length:N*N}, ()=> [0n, rand64(), rand64()]); // [empty, black, white]
  const turnKey = [0n, rand64(), rand64()];
  return { table, turnKey };
}
const Z = makeZobrist();

function hashBoard(b, turnCol){
  let h = Z.turnKey[turnCol];
  for(let r=PLAY_MIN;r<=PLAY_MAX;r++){
    for(let c=PLAY_MIN;c<=PLAY_MAX;c++){
      const v = b[idx(r,c)];
      if(v!==EMPTY) h ^= Z.table[idx(r,c)][v];
    }
  }
  return h;
}

// TT entry: {depth, flag, val, bestMove:[r,c]}
// flag: 0 exact, 1 lowerbound, 2 upperbound
class TTMap {
  constructor(max){
    this.max = max;
    this.map = new Map(); // key: BigInt
  }
  get(key){ return this.map.get(key); }
  set(key, val){
    this.map.set(key, val);
    if(this.map.size > this.max){
      // crude prune: delete some earliest keys
      // (Map is insertion-ordered)
      const it = this.map.keys();
      for(let i=0;i<Math.floor(this.max*0.15);i++){
        const k = it.next().value;
        if(k===undefined) break;
        this.map.delete(k);
      }
    }
  }
}

// ===== Move ordering =====
function orderedMoves(b, col, maxCand, radius){
  const o = opp(col);
  const cand = candidateMoves(b, radius);
  const scored = [];

  // opponent immediate win squares to block
  const oppWin = new Set();
  for(const [r,c] of cand){
    if(b[idx(r,c)]!==EMPTY) continue;
    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb, r,c, o)) continue;
    if(hasFive(nb, o)) oppWin.add(r*10+c);
  }

  for(const [r,c] of cand){
    if(b[idx(r,c)]!==EMPTY) continue;
    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb, r,c, col)) continue;

    const winNow = hasFive(nb, col) ? 1 : 0;
    const blocks = oppWin.has(r*10+c) ? 1 : 0;

    // fork count (0/1/2)
    const nextCand = candidateMoves(nb, radius);
    const forks = countImmediateWins(nb, col, nextCand);
    const forkBonus = (forks>=2) ? 1 : (forks===1 ? 0.2 : 0);

    let local=0;
    for(const [dR,dC] of checkDirs){
      const f=lineFeature(nb, r,c, col, dR,dC);
      local = Math.max(local, f.len*10 + f.openEnds*5);
    }

    const rough = evaluate(nb, col);

    const pri =
      winNow*1e18 +
      blocks*8e17 +
      forkBonus*4e16 +
      local*1e6 +
      rough;

    scored.push({r,c,pri});
  }

  scored.sort((a,b)=> b.pri - a.pri);
  return scored.slice(0, maxCand).map(x=>[x.r,x.c]);
}

// ===== Alpha-beta with iterative deepening =====
async function maybeYield(ctx){
  ctx.nodes++;
  if(ctx.nodes % YIELD_EVERY === 0){
    await new Promise(res=>setImmediate(res));
  }
}

function terminalScore(b, meCol){
  const opCol = opp(meCol);
  if(hasFive(b, meCol)) return 1e15;
  if(hasFive(b, opCol)) return -1e15;
  return null;
}

async function alphabeta(b, depth, alpha, beta, meCol, turnCol, deadline, tt, ctx){
  if(nowMs() > deadline) return evaluate(b, meCol);

  const term = terminalScore(b, meCol);
  if(term !== null) return term;

  if(depth === 0){
    // small “threat bias” at horizon
    const cand = candidateMoves(b, 3);
    const myWins = countImmediateWins(b, meCol, cand);
    const opWins = countImmediateWins(b, opp(meCol), cand);
    if(myWins>=1) return 9e14;
    if(opWins>=1) return -9e14;
    return evaluate(b, meCol);
  }

  await maybeYield(ctx);
  if(nowMs() > deadline) return evaluate(b, meCol);

  const key = hashBoard(b, turnCol);
  const ent = tt.get(key);
  if(ent && ent.depth >= depth){
    if(ent.flag === 0) return ent.val;
    if(ent.flag === 1) alpha = Math.max(alpha, ent.val);
    else if(ent.flag === 2) beta = Math.min(beta, ent.val);
    if(alpha >= beta) return ent.val;
  }

  // move ordering (use TT best move first if available)
  const stones = countStones(b);
  const radius = stones <= 10 ? CAND_RADIUS_EARLY : CAND_RADIUS_LATE;
  const maxCand = stones <= 10 ? ROOT_MAXCAND_EARLY : ROOT_MAXCAND_LATE;

  let moves = orderedMoves(b, turnCol, maxCand, radius);
  if(ent && ent.bestMove){
    const [br,bc] = ent.bestMove;
    const k = br*10+bc;
    const idx0 = moves.findIndex(m => (m[0]*10+m[1])===k);
    if(idx0 > 0){
      const t = moves[idx0];
      moves.splice(idx0,1);
      moves.unshift(t);
    }
  }

  if(moves.length===0){
    const v = evaluate(b, meCol);
    tt.set(key, {depth, flag:0, val:v, bestMove:null});
    return v;
  }

  const maximizing = (turnCol === meCol);
  let bestVal = maximizing ? -Infinity : Infinity;
  let bestMove = null;

  const a0 = alpha, b0 = beta;

  for(const [r,c] of moves){
    if(nowMs() > deadline) break;

    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb, r,c, turnCol)) continue;

    const v = await alphabeta(nb, depth-1, alpha, beta, meCol, opp(turnCol), deadline, tt, ctx);

    if(maximizing){
      if(v > bestVal){ bestVal = v; bestMove = [r,c]; }
      alpha = Math.max(alpha, bestVal);
    }else{
      if(v < bestVal){ bestVal = v; bestMove = [r,c]; }
      beta = Math.min(beta, bestVal);
    }

    if(beta <= alpha) break;
  }

  // store TT
  let flag = 0;
  if(bestVal <= a0) flag = 2;
  else if(bestVal >= b0) flag = 1;

  tt.set(key, {depth, flag, val:bestVal, bestMove});

  return bestVal;
}

async function chooseBestMove(b, turnCol, timeMs){
  // quick checks: win now / block now
  const stones = countStones(b);
  const radius = stones <= 10 ? CAND_RADIUS_EARLY : CAND_RADIUS_LATE;
  const maxCand = stones <= 10 ? ROOT_MAXCAND_EARLY : ROOT_MAXCAND_LATE;

  const baseMoves = orderedMoves(b, turnCol, maxCand, radius);

  // win now
  for(const [r,c] of baseMoves){
    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb,r,c,turnCol)) continue;
    if(hasFive(nb,turnCol)) return [r,c];
  }

  // block opponent win now
  const op = opp(turnCol);
  const cand = candidateMoves(b, radius);
  for(const [r,c] of cand){
    if(b[idx(r,c)]!==EMPTY) continue;
    const nb = cloneBoard(b);
    if(!applyMoveInPlace(nb,r,c,op)) continue;
    if(hasFive(nb,op)) return [r,c];
  }

  const start = nowMs();
  const deadline = start + timeMs;

  const tt = new TTMap(TT_MAX);
  const ctx = { nodes: 0 };

  let bestMove = baseMoves[0] || [4,4];

  // Iterative deepening
  let depth = 3;
  const DEPTH_CAP = 18;

  while(nowMs() < deadline && depth <= DEPTH_CAP){
    // PV move first
    const moves = (() => {
      const m = orderedMoves(b, turnCol, maxCand, radius);
      const k = bestMove[0]*10+bestMove[1];
      const i = m.findIndex(x => (x[0]*10+x[1])===k);
      if(i>0){
        const t = m[i];
        m.splice(i,1);
        m.unshift(t);
      }
      return m;
    })();

    let localBest = bestMove;
    let localBestVal = -Infinity;

    for(const [r,c] of moves){
      if(nowMs() > deadline) break;

      const nb = cloneBoard(b);
      if(!applyMoveInPlace(nb, r,c, turnCol)) continue;

      const v = await alphabeta(nb, depth-1, -Infinity, Infinity, turnCol, opp(turnCol), deadline, tt, ctx);

      if(v > localBestVal){
        localBestVal = v;
        localBest = [r,c];
      }
    }

    bestMove = localBest;
    depth++;
  }

  return bestMove;
}

// ===== Coordinate I/O =====
// user definition: (a1,b1) is left-top. a is horizontal (col), b is vertical (row).
function rcToAB(r,c){ return {a:c, b:r}; }

function moveLabelAB(m){ return `(a${m.a},b${m.b})`; }

// ===== Game generation =====
async function generateCase(caseNo, openingAB){
  let b = new Uint8Array(N*N); // all EMPTY
  let turn = BLACK;
  let moves = []; // from 2nd move onward, as {a,b}
  let result = "不明";

  const opening = {a: openingAB.a, b: openingAB.b};

  // apply opening
  if(!applyMoveInPlace(b, opening.b, opening.a, turn)){
    throw new Error(`Case ${caseNo}: 初手が不正 ${moveLabelAB(opening)}`);
  }

  if(hasFive(b, turn)){
    result = "黒勝ち（初手）";
    return { opening, moves, result };
  }

  turn = opp(turn);

  for(let ply=2; ply<=MAX_PLY; ply++){
    const legal = legalMoves(b);
    if(legal.length===0){
      result = "引き分け（満局）";
      break;
    }

    const t0 = nowMs();
    const [r,c] = await chooseBestMove(b, turn, THINK_TIME_MS);
    const spent = nowMs() - t0;

    // apply (with fallback)
    let rr=r, cc=c;
    if(!playable(rr,cc) || b[idx(rr,cc)]!==EMPTY){
      // fallback: first legal
      const [fr,fc] = legal[0];
      rr=fr; cc=fc;
    }

    applyMoveInPlace(b, rr, cc, turn);

    const ab = rcToAB(rr,cc);
    moves.push(ab);

    const who = (turn===BLACK) ? "黒" : "白";
    console.log(`Case${caseNo} 手${ply} ${who} ${moveLabelAB(ab)}  (${(spent/1000).toFixed(1)}s)`);

    if(hasFive(b, turn)){
      result = (turn===BLACK) ? "黒勝ち" : "白勝ち";
      break;
    }

    turn = opp(turn);

    // Save progress every move (crash-safe)
    const tmp = { opening, moves, result: "生成中…" };
    fs.writeFileSync(`case${caseNo}.json`, JSON.stringify(tmp, null, 2), "utf-8");
  }

  return { opening, moves, result };
}

async function main(){
  const cases = {
    1: {a:4,b:4},
    2: {a:4,b:5},
    3: {a:4,b:6},
    4: {a:5,b:5},
  };

  console.log(`=== 五目オセロ 棋譜生成（30秒/手）開始 ===`);
  console.log(`出力: case1.json..case4.json`);
  console.log(``);

  for(const k of Object.keys(cases)){
    const caseNo = Number(k);
    console.log(`--- Case ${caseNo} 初手=黒 (a${cases[k].a},b${cases[k].b}) ---`);
    const data = await generateCase(caseNo, cases[k]);
    fs.writeFileSync(`case${caseNo}.json`, JSON.stringify(data, null, 2), "utf-8");
    console.log(`=> Case ${caseNo} 結果: ${data.result}`);
    console.log(`case${caseNo}.json を保存しました`);
    console.log(``);
  }

  console.log(`=== 完了 ===`);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});
