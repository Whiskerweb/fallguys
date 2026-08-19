/**
 * Pipeline personnage anime : text-to-3d (preview -> texture) -> rigging -> animations -> .glb
 * Le rigging automatique de Meshy exige un humanoide en pose T : c'est pour ca que le
 * personnage anime est genere separement du blob decoratif, avec un prompt dedie.
 * Usage : node rig.mjs <preview_task_id>
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const V2 = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const RIG = 'https://api.meshy.ai/openapi/v1/rigging';
const ANIM = 'https://api.meshy.ai/openapi/v1/animations';
const OUT = path.resolve('../feel-lab/public/models');
const STATE = path.resolve('rig-state.json');

const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY absente'); process.exit(1); }
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} ${res.status}: ${text}`);
  return JSON.parse(text).result;
}

async function poll(url, id, label, timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${url}/${id}`, { headers });
    if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
    const task = await res.json();
    if (task.progress !== last) { last = task.progress; log(`  ${label} ${task.status} ${task.progress ?? 0}%`); }
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED')
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
    await sleep(8000);
  }
  throw new Error(`${label} timeout`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  const { size } = await fs.stat(dest);
  log(`  -> ${path.basename(dest)} ${(size / 1024 / 1024).toFixed(2)} Mo`);
}

const loadState = async () => { try { return JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { return {}; } };
const saveState = (s) => fs.writeFile(STATE, JSON.stringify(s, null, 2));

async function main() {
  const previewId = process.argv[2];
  if (!previewId) { console.error('usage: node rig.mjs <preview_task_id>'); process.exit(1); }
  const st = await loadState();
  st.previewId = previewId;
  await fs.mkdir(OUT, { recursive: true });

  await poll(V2, previewId, 'preview');

  if (!st.refineId) {
    st.refineId = await post(V2, { mode: 'refine', preview_task_id: previewId, enable_pbr: true });
    await saveState(st);
    log('texture lancee');
  }
  const refined = await poll(V2, st.refineId, 'texture');
  if (refined.model_urls?.glb) await download(refined.model_urls.glb, path.join(OUT, 'player-tpose.glb'));

  if (!st.riggingId) {
    st.riggingId = await post(RIG, { input_task_id: st.refineId, character_height: 1.6 });
    await saveState(st);
    log('rigging lance');
  }
  const rigged = await poll(RIG, st.riggingId, 'rigging');
  log('rigging OK, sorties : ' + JSON.stringify(Object.keys(rigged.result ?? rigged.model_urls ?? rigged)));
  const riggedUrls = rigged.model_urls ?? rigged.result?.model_urls ?? {};
  if (riggedUrls.glb) await download(riggedUrls.glb, path.join(OUT, 'player-rigged.glb'));

  await saveState(st);
  console.log('\n--- tache de rigging complete ---');
  console.log(JSON.stringify(rigged, null, 2).slice(0, 2500));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
