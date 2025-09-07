export const runtime = "edge";

export async function POST(req: Request) {
  // 全データを読み切って破棄
  // （Body は 1 回しか読めないので注意）
  await req.arrayBuffer();

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET() {
  return new Response("method not allowed", { status: 405 });
}
