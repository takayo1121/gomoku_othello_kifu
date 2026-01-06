/**
 * 五目オセロ 棋譜生成（CPU vs CPU）
 * GitHub Codespaces 用 / Node.js
 * 1手あたり最大30秒
 */

const fs = require("fs");

const THINK_TIME_MS = 30000; // ← 今回は30秒

// =========================
// ここでは簡略化のため
// すでにあなたが使っている
// 「最強CPUロジック」を
// そのまま移植する想定です。
// =========================

// ※ ここは次のメッセージで
//   完全版コードを渡します
//   （ここでは「骨組み」だけ示しています）

async function generateCase(caseNo, opening) {
  console.log(`Case ${caseNo} 開始:`, opening);

  // 実際には
  // while(!gameOver){
  //   bestMove = await search(30秒)
  //   moves.push(bestMove)
  // }

  return {
    opening,
    moves: [
      // {a:?, b:?}
    ],
    result: "未定"
  };
}

async function main(){
  const cases = {
    1: {a:4,b:4},
    2: {a:4,b:5},
    3: {a:4,b:6},
    4: {a:5,b:5}
  };

  for(const k of Object.keys(cases)){
    const data = await generateCase(k, cases[k]);
    fs.writeFileSync(
      `case${k}.json`,
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    console.log(`case${k}.json を保存しました`);
  }
}

main();
