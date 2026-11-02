import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/read-night.js';
import type { NightDigest } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type DigestEventCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type NightStatus = {
  night: string;
  counts: DigestEventCounts | null;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightStatus[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function countDigestEvents(digest: NightDigest): DigestEventCounts {
  let runs = 0;
  let retry = 0;
  let fail = 0;

  for (const row of digest.rows) {
    runs += row.runs;
    retry += row.retries;
    if (row.lastStatus === 'fail') fail += 1;
  }

  return { ok: runs - retry - fail, retry, fail };
}

function readNightStatus(runsDir: string, night: string): NightStatus {
  try {
    const digest = readNight(runsDir, night);
    return { night, counts: digest ? countDigestEvents(digest) : null };
  } catch {
    return { night, counts: null };
  }
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => readNightStatus(config.runsDir, night)),
  };
}
