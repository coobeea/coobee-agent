/**
 * ChunkQueue 独立测试（不依赖测试框架）
 *
 * 运行: npx tsx src/main/agent/runtime/pimono/__tests__/test-chunk-queue.ts
 */

import { ChunkQueue } from "../ChunkQueue";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    console.log(`  ✗ 异常: ${e}`);
    failed++;
  }
}

// ===== 1. Push + Pull（基本流转） =====
async function testPushPull(): Promise<void> {
  const q = new ChunkQueue<string>();
  q.push("a"); q.push("b"); q.push("c");
  q.end();
  const result: string[] = [];
  for await (const item of q) result.push(item);
  assert(result.length === 3, "push 3 条拉取 3 条");
  assert(result[0] === "a" && result[1] === "b" && result[2] === "c", "顺序 a→b→c");
}

// ===== 2. 先拉后 push（异步等待） =====
async function testPullBeforePush(): Promise<void> {
  const q = new ChunkQueue<string>();
  const result: string[] = [];
  const consumer = (async () => { for await (const item of q) result.push(item); })();
  await new Promise((r) => setTimeout(r, 10));
  q.push("x"); q.push("y");
  q.end();
  await consumer;
  assert(result.length === 2, "异步 push 2 条");
  assert(result[0] === "x" && result[1] === "y", "顺序 x→y");
}

// ===== 3. end 后 push 无效 =====
async function testPushAfterEnd(): Promise<void> {
  const q = new ChunkQueue<string>();
  q.push("only");
  q.end();
  q.push("ignored");
  const result: string[] = [];
  for await (const item of q) result.push(item);
  assert(result.length === 1, "end 后 push 被忽略");
}

// ===== 4. 空队列 =====
async function testEmptyEnd(): Promise<void> {
  const q = new ChunkQueue<string>();
  q.end();
  const result: string[] = [];
  for await (const item of q) result.push(item);
  assert(result.length === 0, "空队列拉取 0 条");
}

// ===== 5. 交替 push/pull =====
async function testInterleaved(): Promise<void> {
  const q = new ChunkQueue<number>();
  q.push(1);
  const result: number[] = [];
  const consumer = (async () => { for await (const item of q) result.push(item); })();
  await new Promise((r) => setTimeout(r, 5));
  q.push(2); q.push(3);
  q.end();
  await consumer;
  assert(result.length === 3, "交替 push 3 条");
  assert(result[0] === 1 && result[1] === 2 && result[2] === 3, "顺序 1→2→3");
}

// ===== 6. 大量 push =====
async function testManyItems(): Promise<void> {
  const q = new ChunkQueue<number>();
  const count = 100;
  for (let i = 0; i < count; i++) q.push(i);
  q.end();
  const result: number[] = [];
  for await (const item of q) result.push(item);
  assert(result.length === count, `push ${count} 条拉取 ${result.length} 条`);
  assert(result[0] === 0 && result[count - 1] === count - 1, "首尾正确");
}

// ===== 7. 迭代器 done 值 =====
async function testDoneValue(): Promise<void> {
  const q = new ChunkQueue<string>();
  q.push("last");
  q.end();
  const iter = q[Symbol.asyncIterator]();
  const r1 = await iter.next();
  const r2 = await iter.next();
  assert(r1.done === false && r1.value === "last", "第1次: done=false, value=last");
  assert(!!r2.done, "第2次: done=true");
}

// ===== 8. throw 后队列终止 =====
async function testThrow(): Promise<void> {
  const q = new ChunkQueue<string>();
  q.push("a"); q.push("b");

  let errorCaught = false;
  const result: string[] = [];
  try {
    for await (const item of q) {
      result.push(item);
      if (item === "a") {
        // throw() 设置 error → end() → 下次 next() 抛出 error
        q.throw(new Error("stop")).catch(() => {});
      }
    }
  } catch {
    errorCaught = true;
  }

  assert(result.length === 1, "拿到第1条");
  assert(result[0] === "a", "第1条是 a");
  assert(errorCaught, "第2次 next() 抛出异常");
}
// ===== 9. 大字符串 =====
async function testLargePayload(): Promise<void> {
  const q = new ChunkQueue<string>();
  const bigStr = "x".repeat(10000);
  q.push(bigStr);
  q.end();
  const result: string[] = [];
  for await (const item of q) result.push(item);
  assert(result.length === 1, "大字符串推送成功");
  assert(result[0].length === 10000, "字符串长度不变");
}

// ===== main =====
(async () => {
  console.log("=== ChunkQueue 独立测试 ===");

  await test("Push → Pull", testPushPull);
  await test("Pull → Push（异步）", testPullBeforePush);
  await test("Push After End", testPushAfterEnd);
  await test("Empty End", testEmptyEnd);
  await test("Interleaved（交替）", testInterleaved);
  await test("Many Items（100条）", testManyItems);
  await test("Done Value", testDoneValue);
  await test("Throw（错误处理）", testThrow);
  await test("Large Payload（大字符串）", testLargePayload);

  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
