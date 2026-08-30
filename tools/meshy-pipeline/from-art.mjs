/**
 * Personnages a partir des planches : image-to-3D puis rigging.
 *
 * Le text-to-3D interprete librement le prompt et donne des resultats inegaux. En
 * partant d'une planche validee a l'ecran, la silhouette, la palette et l'expression
 * sont figees avant la conversion, et le modele obtenu ressemble a ce qu'on a approuve.
 *
 * Usage : node from-art.mjs [nom-sans-prefixe ...]      ex. node from-art.mjs tycoon
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const I2M = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const RIG = 'https://api.meshy.ai/openapi/v1/rigging';
const ART = path.resolve('../icon-pipeline/character-art');
const OUT = path.resolve('../feel-lab/public/models');
const STATE = path.resolve('from-art-state.json');

const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY absente'); process.exit(1); }
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).result;
}

async function poll(url, id, label, timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${url}/${id}`, { headers });
    if (!res.ok) throw new Error(`GET ${res.status}`);
    const task = await res.json();
    if (task.progress !== last) { last = task.progress; log(`  ${label} ${task.status} ${task.progress ?? 0}%`); }
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? {}).slice(0, 180)}`);
    }
    await sleep(9000);
  }
  throw new Error(`${label} timeout`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return ((await fs.stat(dest)).size / 1024 / 1024).toFixed(2);
}

const loadState = async () => { try { return JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { return {}; } };

async function build(artFile, state) {
  const short = path.basename(artFile, '.png').replace(/^art-/, '');
  const name = `char-${short}`;
  const dest = path.join(OUT, `${name}.glb`);
  const st = state[name] ?? (state[name] = {});
  const save = () => fs.writeFile(STATE, JSON.stringify(state, null, 2));

  try { await fs.access(dest); log(`= ${name} deja present`); return { name, ok: true }; } catch {}

  try {
    if (!st.model) {
      const bytes = await fs.readFile(artFile);
      st.model = await post(I2M, {
        image_url: `data:image/png;base64,${bytes.toString('base64')}`,
        ai_model: 'meshy-5',
        should_remesh: true,
        should_texture: true,
        topology: 'triangle',
        target_polycount: 12000,
        symmetry_mode: 'on',
      });
      await save(); log(`+ ${name} modelisation`);
    }
    await poll(I2M, st.model, `${name} modelisation`);

    if (!st.rig) {
      st.rig = await post(RIG, { input_task_id: st.model, character_height: 1.6 });
      await save(); log(`+ ${name} rigging`);
    }
    const rigged = await poll(RIG, st.rig, `${name} rigging`);

    const url = rigged.result?.rigged_character_glb_url ?? rigged.model_urls?.glb;
    if (!url) throw new Error('pas de glb rigge');
    log(`OK ${name} -> ${await download(url, dest)} Mo (rigge)`);
    st.done = true; await save();
    return { name, ok: true };
  } catch (err) {
    log(`FAIL ${name}: ${err.message}`);
    return { name, ok: false, error: err.message };
  }
}

const only = process.argv.slice(2);
const files = (await fs.readdir(ART)).filter((f) => f.endsWith('.png'))
  .filter((f) => !only.length || only.some((o) => f.includes(o)));
const state = await loadState();
await fs.mkdir(OUT, { recursive: true });

const CONCURRENCY = 3;
const results = [];
let cursor = 0;
const worker = async () => { while (cursor < files.length) results.push(await build(path.join(ART, files[cursor++]), state)); };
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

log(`--- ${results.filter((r) => r.ok).length}/${results.length} personnages ---`);
for (const r of results.filter((r) => !r.ok)) log(`  echec ${r.name} : ${r.error}`);
