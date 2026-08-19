/**
 * Pipeline Meshy : text-to-3d (preview) -> refine (texture) -> telechargement du .glb.
 * Reprend la ou il s'est arrete : un asset deja telecharge est saute.
 * Usage : node generate.mjs [nom-asset ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const OUT = path.resolve('../feel-lab/public/models');
const STATE = path.resolve('state.json');
const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY absente (source ../../.env)'); process.exit(1); }

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(body) {
  const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${res.status}: ${text}`);
  return JSON.parse(text).result;
}

async function poll(taskId, label, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  let lastProgress = -1;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${API}/${taskId}`, { headers });
    if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
    const task = await res.json();
    if (task.progress !== lastProgress) {
      lastProgress = task.progress;
      log(`  ${label} ${task.status} ${task.progress}%`);
    }
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
    }
    await sleep(8000);
  }
  throw new Error(`${label} timeout`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { return {}; }
}
async function saveState(s) { await fs.writeFile(STATE, JSON.stringify(s, null, 2)); }

async function generate(asset, state) {
  const dest = path.join(OUT, `${asset.name}.glb`);
  try { await fs.access(dest); log(`= ${asset.name} deja present, saute`); return { name: asset.name, ok: true, skipped: true }; }
  catch {}

  const entry = state[asset.name] ?? {};
  try {
    if (!entry.previewId) {
      entry.previewId = await post({
        mode: 'preview', prompt: asset.prompt, art_style: 'realistic',
        should_remesh: true, topology: 'triangle',
        target_polycount: asset.polycount, symmetry_mode: asset.symmetry,
      });
      state[asset.name] = entry; await saveState(state);
      log(`+ ${asset.name} preview lance`);
    }
    await poll(entry.previewId, `${asset.name} preview`);

    if (!entry.refineId) {
      entry.refineId = await post({ mode: 'refine', preview_task_id: entry.previewId, enable_pbr: true });
      state[asset.name] = entry; await saveState(state);
      log(`+ ${asset.name} texture lancee`);
    }
    const refined = await poll(entry.refineId, `${asset.name} texture`);

    const url = refined.model_urls?.glb;
    if (!url) throw new Error('pas de glb dans model_urls');
    await fs.mkdir(OUT, { recursive: true });
    await download(url, dest);
    const { size } = await fs.stat(dest);
    log(`OK ${asset.name} -> ${(size / 1024 / 1024).toFixed(2)} Mo`);
    entry.done = true; state[asset.name] = entry; await saveState(state);
    return { name: asset.name, ok: true };
  } catch (err) {
    log(`FAIL ${asset.name}: ${err.message}`);
    return { name: asset.name, ok: false, error: err.message };
  }
}

async function main() {
  const { assets } = JSON.parse(await fs.readFile('assets.json', 'utf8'));
  const filter = process.argv.slice(2);
  const todo = filter.length ? assets.filter((a) => filter.includes(a.name)) : assets;
  const state = await loadState();
  await fs.mkdir(OUT, { recursive: true });

  const CONCURRENCY = 4;
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const asset = todo[cursor++];
      results.push(await generate(asset, state));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok).length;
  log(`--- ${ok}/${results.length} assets prets ---`);
  const manifest = results.filter((r) => r.ok).map((r) => r.name);
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const r of results.filter((r) => !r.ok)) log(`  echec: ${r.name} (${r.error})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
