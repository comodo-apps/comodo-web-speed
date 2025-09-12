"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

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
  const [message, setMessage] = useState<string>("");

  const [running, setRunning] = useState(false);
  const barRef = useRef<HTMLProgressElement>(null);
  const dlCircleRef = useRef<SVGCircleElement>(null);
  const ulCircleRef = useRef<SVGCircleElement>(null);
  const ltCircleRef = useRef<SVGCircleElement>(null);
  const dlValueRef = useRef<HTMLDivElement>(null);
  const ulValueRef = useRef<HTMLDivElement>(null);
  const ltValueRef = useRef<HTMLDivElement>(null);

  const step = () => {
    const steps = PING_COUNT + 2 * PARALLEL + 2 * PARALLEL;
    if (barRef.current) {
      barRef.current.value = Math.min(100, barRef.current.value + 100 / steps);
    }
  };

  // ====== 可視化ユーティリティ ======
  const CIRC = 326; // stroke-dasharray
  const setGaugePercent = (el: SVGCircleElement | null, p01: number) => {
    if (!el) return;
    const p = Math.max(0, Math.min(1, p01));
    el.style.strokeDashoffset = String(CIRC * (1 - p));
  };
  const animateGaugeTo = (
    el: SVGCircleElement | null,
    from: number,
    to: number,
    dur = 900
  ) => {
    if (!el) return;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setGaugePercent(el, from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  const animateNumber = (
    el: HTMLDivElement | null,
    from: number,
    to: number,
    suffix = "",
    dur = 900,
    decimals = 0
  ) => {
    if (!el) return;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (to - from) * eased;
      el.textContent =
        (decimals ? val.toFixed(decimals) : String(Math.round(val))) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  const normMbps = (mbpsVal: number) =>
    Math.max(0, Math.min(1, mbpsVal / 1000));
  const normLatency = (msVal: number) =>
    1 - Math.max(0, Math.min(1, msVal / 300));

  // 履歴機能は削除

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
    console.log({ total, ms });
    return mbps(total, ms);
  };

  function fillWithRandom(u8: Uint8Array) {
    const MAX = 65536;
    for (let i = 0; i < u8.length; i += MAX) {
      crypto.getRandomValues(u8.subarray(i, Math.min(i + MAX, u8.length)));
    }
  }

  const randomBlob = (bytes: number) => {
    const u8 = new Uint8Array(bytes);
    fillWithRandom(u8);
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
    setMessage("");
    if (barRef.current) barRef.current.value = 0;

    try {
      setMessage("Latency計測中…");
      const { avg, jitter } = await measureLatency();
      setLat(`${avg.toFixed(1)} ms`);
      setJit(`${jitter.toFixed(1)} ms`);
      animateGaugeTo(ltCircleRef.current, 0, normLatency(avg), 1000);
      animateNumber(ltValueRef.current, 0, avg, "", 1000, 0);

      setMessage("Download計測中…");
      const dl = await measureDownload();
      setDown(`${dl.toFixed(1)} Mbps`);
      animateGaugeTo(dlCircleRef.current, 0, normMbps(dl), 1200);
      animateNumber(dlValueRef.current, 0, dl, "", 1200, 0);

      setMessage("Upload計測中…");
      const ul = await measureUpload();
      setUp(`${ul.toFixed(1)} Mbps`);
      animateGaugeTo(ulCircleRef.current, 0, normMbps(ul), 1200);
      animateNumber(ulValueRef.current, 0, ul, "", 1200, 0);

      setMessage("完了");
      if (barRef.current) barRef.current.value = 100;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 外部ライブラリ都合で一時的にany
    } catch (e: any) {
      console.error(e);
      setMessage("❌ エラー: " + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className={styles.speedTestContainer}>
      <div className={styles.speedTestCard}>
        <div className={styles.header}>
          <h1 className={styles.title}>
            <span className={styles.titleIcon}>
              <Image src="/icons/bolt.svg" alt="bolt" width={28} height={28} />
            </span>
            ネット回線速度計測
          </h1>
          <p className={styles.subtitle}>
            リアルタイムでインターネット速度を測定
          </p>
        </div>

        <div className={styles.metricsGrid}>
          <div className={`${styles.metricCard} ${styles.download}`}>
            <div className={styles.gauge}>
              <svg
                className={styles.gaugeSvg}
                viewBox="0 0 120 120"
                aria-hidden="true"
              >
                <circle className={styles.gaugeBg} cx="60" cy="60" r="52" />
                <circle
                  ref={dlCircleRef}
                  className={`${styles.gaugeFg} ${styles.gaugeFgDownload}`}
                  cx="60"
                  cy="60"
                  r="52"
                />
              </svg>
              <div className={styles.gaugeValue}>
                <div ref={dlValueRef} className={`${styles.value}`}>
                  --
                </div>
                <div className={styles.unit}>Mbps</div>
              </div>
            </div>
            <div
              className={`${styles.metricLabel} ${styles.metricLabelDownload}`}
            >
              Download
            </div>
            <div className={styles.jitterSmall}>Jitter: {jit}</div>
          </div>

          <div className={`${styles.metricCard} ${styles.upload}`}>
            <div className={styles.gauge}>
              <svg
                className={styles.gaugeSvg}
                viewBox="0 0 120 120"
                aria-hidden="true"
              >
                <circle className={styles.gaugeBg} cx="60" cy="60" r="52" />
                <circle
                  ref={ulCircleRef}
                  className={`${styles.gaugeFg} ${styles.gaugeFgUpload}`}
                  cx="60"
                  cy="60"
                  r="52"
                />
              </svg>
              <div className={styles.gaugeValue}>
                <div ref={ulValueRef} className={styles.value}>
                  --
                </div>
                <div className={styles.unit}>Mbps</div>
              </div>
            </div>
            <div
              className={`${styles.metricLabel} ${styles.metricLabelUpload}`}
            >
              Upload
            </div>
            <div className={styles.jitterSmall}>Jitter: {jit}</div>
          </div>

          <div className={`${styles.metricCard} ${styles.latency}`}>
            <div className={styles.gauge}>
              <svg
                className={styles.gaugeSvg}
                viewBox="0 0 120 120"
                aria-hidden="true"
              >
                <circle className={styles.gaugeBg} cx="60" cy="60" r="52" />
                <circle
                  ref={ltCircleRef}
                  className={`${styles.gaugeFg} ${styles.gaugeFgLatency}`}
                  cx="60"
                  cy="60"
                  r="52"
                />
              </svg>
              <div className={styles.gaugeValue}>
                <div ref={ltValueRef} className={styles.value}>
                  --
                </div>
                <div className={styles.unit}>ms</div>
              </div>
            </div>
            <div
              className={`${styles.metricLabel} ${styles.metricLabelLatency}`}
            >
              Latency
            </div>
            <div className={styles.jitterSmall}>Jitter: {jit}</div>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            onClick={start}
            disabled={running}
            className={`${styles.startButton} ${running ? styles.running : ""}`}
          >
            <span className={styles.buttonIcon}>{running ? "⏳" : "🚀"}</span>
            {running ? "計測中…" : "計測スタート"}
          </button>
        </div>

        <div className={styles.progressContainer}>
          <progress
            ref={barRef}
            value={0}
            max={100}
            className={styles.progressBar}
          />
        </div>

        {/* 履歴UIは削除 */}

        <div className={styles.logContainer}>
          <pre className={styles.logText}>{message}</pre>
        </div>
      </div>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p>
            <a
              href="https://comodo-apps.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.footerLink}
            >
              Comodo Apps
            </a>
          </p>
          <p>
            <span className={styles.copyright}>
              © {new Date().getFullYear()} Comodo Apps
            </span>
          </p>
        </div>
      </footer>
    </main>
  );
}
