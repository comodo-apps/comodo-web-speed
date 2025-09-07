// src/app/api/download/route.ts
export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const size = Math.max(
    1,
    Number(url.searchParams.get("size") ?? "10485760") | 0
  ); // 10MB
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
      // Edge Runtime: Node の randomFillSync は不可。Web Crypto を使う
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
      // ストリーミング時は Content-Length を付けない
      "Cache-Control":
        "no-store, no-cache, must-revalidate, max-age=0, no-transform",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Encoding": "identity",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
