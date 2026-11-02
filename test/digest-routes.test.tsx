import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow } from '../src/digest/types.js';

const tempDirs: string[] = [];

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
} satisfies Omit<RigConfig, 'runsDir'>;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeApp() {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(runsDir);
  return { app: createApp({ ...baseConfig, runsDir }), runsDir };
}

function writeNight(runsDir: string, night: string, lines: string[]): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
}

function renderedJobs(html: string): string[] {
  return [...html.matchAll(/<tr>\s*<td>([^<]+)<\/td>/g)].map((match) => match[1]);
}

describe('digest routes', () => {
  it('renders and returns the same jobs in sorted order', async () => {
    const { app, runsDir } = makeApp();
    const night = '2026-10-30';
    writeNight(runsDir, night, [
      JSON.stringify({
        at: '2026-10-30T23:02:00+01:00',
        job: 'jobs/zulu',
        status: 'ok',
        owner: 'rook',
      }),
      JSON.stringify({
        at: '2026-10-30T23:00:00+01:00',
        job: 'jobs/alpha',
        status: 'fail',
        owner: null,
        error: 'disk full',
      }),
      JSON.stringify({
        at: '2026-10-30T23:01:00+01:00',
        job: 'jobs/middle',
        status: 'retry',
        owner: 'mechanic',
      }),
    ]);

    const [pageResponse, apiResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const page = await pageResponse.text();
    const rows = (await apiResponse.json()) as DigestRow[];

    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get('content-type')).toContain('text/html');
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get('content-type')).toContain('application/json');
    expect(page).toContain(`<h1>digest · ${night}</h1>`);
    expect(page).toContain('<th>last error</th>');
    expect(page).toContain('disk full');
    expect(page).toContain('<td>—</td>');

    const apiJobs = rows.map((row) => row.job);
    expect(apiJobs).toEqual(['jobs/alpha', 'jobs/middle', 'jobs/zulu']);
    expect(renderedJobs(page)).toEqual(apiJobs);
    expect(rows.find((row) => row.job === 'jobs/alpha')).toEqual({
      job: 'jobs/alpha',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'disk full',
      firstAt: '2026-10-30T23:00:00+01:00',
      lastAt: '2026-10-30T23:00:00+01:00',
    });
  });

  it('returns 404 from both routes when the night is missing', async () => {
    const { app } = makeApp();

    const [pageResponse, apiResponse] = await Promise.all([
      app.request('/digest/missing'),
      app.request('/api/digest/missing'),
    ]);

    expect(pageResponse.status).toBe(404);
    expect(apiResponse.status).toBe(404);
  });

  it('renders an empty state and returns no API rows for an empty night', async () => {
    const { app, runsDir } = makeApp();
    writeNight(runsDir, '2026-10-31', []);

    const [pageResponse, apiResponse] = await Promise.all([
      app.request('/digest/2026-10-31'),
      app.request('/api/digest/2026-10-31'),
    ]);
    const page = await pageResponse.text();

    expect(pageResponse.status).toBe(200);
    expect(page).toContain('<p class="mute">nothing ran</p>');
    expect(page).not.toContain('<table>');
    expect(apiResponse.status).toBe(200);
    expect(await apiResponse.json()).toEqual([]);
  });

  it('reports a malformed line while both routes keep the valid job', async () => {
    const { app, runsDir } = makeApp();
    writeNight(runsDir, '2026-11-01', [
      '{not json',
      JSON.stringify({
        at: '2026-11-01T23:00:00+01:00',
        job: 'jobs/valid',
        status: 'ok',
        owner: 'rook',
      }),
    ]);

    const [pageResponse, apiResponse] = await Promise.all([
      app.request('/digest/2026-11-01'),
      app.request('/api/digest/2026-11-01'),
    ]);
    const page = await pageResponse.text();
    const rows = (await apiResponse.json()) as DigestRow[];

    expect(pageResponse.status).toBe(200);
    expect(page).toContain('1 malformed line skipped');
    expect(renderedJobs(page)).toEqual(['jobs/valid']);
    expect(apiResponse.status).toBe(200);
    expect(rows.map((row) => row.job)).toEqual(['jobs/valid']);
  });
});
