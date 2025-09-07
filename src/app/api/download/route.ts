export const runtime = "edge";

import { randomFillSync } from "node:crypto";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sizeStr = url.searchParams.get("size") ?? "10485760"; // 10MB
  const size = Math.max(1, Number(sizeStr) | 0);

  const chunkSize = 64 * 1024;
  let remaining = size;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const len = Math.min(chunkSize, remaining);
      if (len <= 0) {
        controller.close();
        return;
      }
      const buf = new Uint8Array(len);
      randomFillSync(buf); // 乱数で非圧縮化を促す
      // Edge Runtime: Web Crypto を使用
      crypto.getRandomValues(buf);
      controller.enqueue(buf);
      remaining -= len;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="bin.dat"',
      // ストリーミング時の Content-Length は付けない（Workers では自動/chunked）
      // 圧縮＆キャッシュ抑止（環境により上書きされる可能性はあります）
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Encoding": "identity",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
