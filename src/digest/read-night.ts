import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest } from './types.js';

type RunRecord = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isStatus(value: unknown): value is DigestStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

function isRunRecord(value: unknown): value is RunRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.at === 'string' &&
    typeof record.job === 'string' &&
    isStatus(record.status) &&
    (typeof record.owner === 'string' || record.owner === null) &&
    (!('error' in record) || typeof record.error === 'string')
  );
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  if (contents === '') return { rows: [], malformedLines: 0 };

  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const rowsByJob = new Map<string, DigestRow>();
  let malformedLines = 0;

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }

    if (!isRunRecord(value)) {
      malformedLines += 1;
      continue;
    }

    const row = rowsByJob.get(value.job);
    if (row === undefined) {
      rowsByJob.set(value.job, {
        job: value.job,
        owner: value.owner,
        runs: 1,
        retries: value.status === 'retry' ? 1 : 0,
        lastStatus: value.status,
        lastError: value.error ?? null,
        firstAt: value.at,
        lastAt: value.at,
      });
      continue;
    }

    row.owner = value.owner;
    row.runs += 1;
    if (value.status === 'retry') row.retries += 1;
    row.lastStatus = value.status;
    row.lastError = value.error ?? null;
    row.lastAt = value.at;
  }

  return { rows: [...rowsByJob.values()], malformedLines };
}
