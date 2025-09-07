"use client";

import { useRef, useState } from "react";

const DOWNLOAD_SIZE_MB = 20;
const UPLOAD_SIZE_MB = 10;
const PARALLEL = 4;
const PING_COUNT = 8;
const TIMEOUT_MS = 60_000;

function mbps(bytes: number, ms: number) {
  const bits = bytes * 8;
  return bits / (ms / 1000) / 1e6;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const stdev = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export default function Page() {
  const [down, setDown] = useState<string>("-- Mbps");
  const [up, setUp] = useState<string>("-- Mbps");
  const [lat, setLat] = useState<string>("-- ms");
  const [jit, setJit] = useState<string>("-- ms");
  const [log, setLog] = useState<string>("");
  const [running, setRunning] = useState(false);
  const barRef = useRef<HTMLProgressElement>(null);

  const addLog = (m: string) => setLog((s) => s + m + "\n");
  const step = () => {
    const steps = PING_COUNT + 2 * PARALLEL + 2 * PARALLEL;
    if (barRef.current) {
      barRef.current.value = Math.min(100, barRef.current.value + 100 / steps);
    }
  };

  const pingOnce = async (signal: AbortSignal) => {
    const t0 = performance.now();
    const res = await fetch(`/api/ping?ts=${Date.now()}&r=${Math.random()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error("ping failed");
    await res.text();
    return performance.now() - t0;
  };

  const measureLatency = async () => {
    const samples: number[] = [];
    for (let i = 0; i < PING_COUNT; i++) {
      const dur = await withTimeout((ab) => pingOnce(ab), TIMEOUT_MS);
      samples.push(dur);
      step();
    }
    return { avg: mean(samples), jitter: stdev(samples) };
  };

  const downloadOnce = async (bytes: number, signal: AbortSignal) => {
    const t0 = performance.now();
    const res = await fetch(`/api/download?size=${bytes}&r=${Math.random()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok || !res.body) throw new Error("download failed");
    const reader = res.body.getReader();
    let received = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value!.length;
    }
    const ms = performance.now() - t0;
    return { bytes: received, ms };
  };

  const measureDownload = async () => {
    const bytes = DOWNLOAD_SIZE_MB * 1024 * 1024;
    const tasks = Array.from({ length: PARALLEL }, () =>
      withTimeout((ab) => downloadOnce(bytes, ab), TIMEOUT_MS).finally(step)
    );
    const results = await Promise.all(tasks);
    const total = results.reduce((s, r) => s + r.bytes, 0);
    const ms = Math.max(...results.map((r) => r.ms)); // 近似
    return mbps(total, ms);
  };

  const randomBlob = (bytes: number) => {
    const u8 = new Uint8Array(bytes);
    // Web Crypto で十分高速
    crypto.getRandomValues(u8);
    return new Blob([u8], { type: "application/octet-stream" });
  };

  const uploadOnce = async (bytes: number, signal: AbortSignal) => {
    const blob = randomBlob(bytes);
    const t0 = performance.now();
    const res = await fetch(`/api/upload?r=${Math.random()}`, {
      method: "POST",
      body: blob,
      cache: "no-store",
      signal,
    });
    if (!res.ok && res.status !== 204) throw new Error("upload failed");
    const ms = performance.now() - t0;
    return { bytes, ms };
  };

  const measureUpload = async () => {
    const bytes = UPLOAD_SIZE_MB * 1024 * 1024;
    const tasks = Array.from({ length: PARALLEL }, () =>
      withTimeout((ab) => uploadOnce(bytes, ab), TIMEOUT_MS).finally(step)
    );
    const results = await Promise.all(tasks);
    const total = results.reduce((s, r) => s + r.bytes, 0);
    const ms = Math.max(...results.map((r) => r.ms));
    return mbps(total, ms);
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    setDown("-- Mbps");
    setUp("-- Mbps");
    setLat("-- ms");
    setJit("-- ms");
    setLog("");
    if (barRef.current) barRef.current.value = 0;

    try {
      addLog("🔔 Latency計測中…");
      const { avg, jitter } = await measureLatency();
      setLat(`${avg.toFixed(1)} ms`);
      setJit(`${jitter.toFixed(1)} ms`);

      addLog("⬇️ Download計測中…");
      const dl = await measureDownload();
      setDown(`${dl.toFixed(1)} Mbps`);

      addLog("⬆️ Upload計測中…");
      const ul = await measureUpload();
      setUp(`${ul.toFixed(1)} Mbps`);

      addLog("✅ 完了");
      if (barRef.current) barRef.current.value = 100;
    } catch (e: any) {
      console.error(e);
      addLog("❌ エラー: " + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main
      style={{
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h1>ネット回線速度テスト（Next.js）</h1>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <div style={{ color: "#555", fontSize: 12 }}>Download</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{down}</div>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <div style={{ color: "#555", fontSize: 12 }}>Upload</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{up}</div>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <div style={{ color: "#555", fontSize: 12 }}>Latency (avg)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{lat}</div>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <div style={{ color: "#555", fontSize: 12 }}>Jitter (σ)</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{jit}</div>
          </div>
        </div>

        <p>
          <button
            onClick={start}
            disabled={running}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#f8f8f8",
              cursor: "pointer",
            }}
          >
            {running ? "計測中…" : "計測スタート"}
          </button>
        </p>
        <progress
          ref={barRef}
          value={0}
          max={100}
          style={{ width: "100%", height: 12 }}
        />
        <p style={{ whiteSpace: "pre-wrap" }}>{log}</p>
      </div>
    </main>
  );
}
