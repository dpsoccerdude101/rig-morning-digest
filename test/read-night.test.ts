import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRunsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(dir);
  return dir;
}

describe('readNight', () => {
  it('aggregates the acceptance fixture in log order', () => {
    const digest = readNight('runs', '2026-10-28');

    expect(digest).not.toBeNull();
    expect(digest?.malformedLines).toBe(1);
    expect(digest?.rows).toHaveLength(5);
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'rig/rotate-logs',
      'lane/sync',
      'fixtures/refresh',
      'notes/backup',
      'digest/render',
    ]);
    expect(digest?.rows.find((row) => row.job === 'lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(digest?.rows.find((row) => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
  });

  it('counts invalid JSON and invalid record shapes without throwing', () => {
    const runsDir = makeRunsDir();
    writeFileSync(
      join(runsDir, '2026-10-30.jsonl'),
      [
        '{bad json',
        'null',
        JSON.stringify({ at: 'later+02:00', job: 'job/a', status: 'retry', owner: 'first', error: 'busy' }),
        JSON.stringify({ at: 'ignored', job: 'job/b', status: 'unknown', owner: 'rook' }),
        JSON.stringify({ at: 'earlier-05:00', job: 'job/a', status: 'ok', owner: null }),
        JSON.stringify({ at: 'ignored', job: 'job/c', status: 'fail', owner: 7 }),
      ].join('\n'),
    );

    expect(readNight(runsDir, '2026-10-30')).toEqual({
      rows: [
        {
          job: 'job/a',
          owner: null,
          runs: 2,
          retries: 1,
          lastStatus: 'ok',
          lastError: null,
          firstAt: 'later+02:00',
          lastAt: 'earlier-05:00',
        },
      ],
      malformedLines: 4,
    });
  });

  it('distinguishes a missing night from an empty night', () => {
    const runsDir = makeRunsDir();
    writeFileSync(join(runsDir, '2026-10-31.jsonl'), '');

    expect(readNight(runsDir, 'missing')).toBeNull();
    expect(readNight(runsDir, '2026-10-31')).toEqual({ rows: [], malformedLines: 0 });
  });
});
