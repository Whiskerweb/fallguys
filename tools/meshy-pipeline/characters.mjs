/**
 * Fabrique de personnages jouables : text-to-3d -> texture -> rigging automatique.
 *
 * Deux exigences imposent la forme des prompts :
 *  - le rigging de Meshy refuse tout ce qui n'est pas un humanoide reconnaissable en
 *    pose T. Meme un pingouin ou un chien doivent donc etre decrits comme des mascottes
 *    BIPEDES, bras ecartes, jambes separees ;
 *  - une charte commune prefixe chaque prompt, pour que les six personnages appartiennent
 *    visiblement a la meme famille : meme silhouette en haricot, memes grands yeux, meme
 *    matiere vinyle. Seuls les attributs distinctifs changent.
 *
 * Les personnalites publiques sont evoquees par leurs TRAITS (coiffure, tenue, couleurs)
 * et jamais nommees : c'est du pastiche, pas une imitation, et cela evite les refus de
 * generation.
 *
 * Usage : node characters.mjs [nom ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const V2 = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const RIG = 'https://api.meshy.ai/openapi/v1/rigging';
const OUT = path.resolve('../feel-lab/public/models');
const STATE = path.resolve('characters-state.json');

const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY absente'); process.exit(1); }
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${res.status}: ${text.slice(0, 180)}`);
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
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? {}).slice(0, 160)}`);
    }
    await sleep(9000);
  }
  throw new Error(`${label} timeout`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  const { size } = await fs.stat(dest);
  return (size / 1024 / 1024).toFixed(2);
}

const loadState = async () => { try { return JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { return {}; } };

async function build(charte, ch, state) {
  const dest = path.join(OUT, `${ch.name}.glb`);
  try { await fs.access(dest); log(`= ${ch.name} deja present`); return { name: ch.name, ok: true }; } catch {}

  const st = state[ch.name] ?? (state[ch.name] = {});
  const save = () => fs.writeFile(STATE, JSON.stringify(state, null, 2));

  try {
    if (!st.preview) {
      st.preview = await post(V2, {
        mode: 'preview',
        prompt: `${charte}. ${ch.prompt}`,
        art_style: 'realistic', should_remesh: true, topology: 'triangle',
        target_polycount: ch.polycount, symmetry_mode: 'on',
      });
      await save(); log(`+ ${ch.name} preview`);
    }
    await poll(V2, st.preview, `${ch.name} preview`);

    if (!st.refine) {
      st.refine = await post(V2, { mode: 'refine', preview_task_id: st.preview, enable_pbr: true });
      await save(); log(`+ ${ch.name} texture`);
    }
    await poll(V2, st.refine, `${ch.name} texture`);

    if (!st.rig) {
      st.rig = await post(RIG, { input_task_id: st.refine, character_height: 1.6 });
      await save(); log(`+ ${ch.name} rigging`);
    }
    const rigged = await poll(RIG, st.rig, `${ch.name} rigging`);

    const url = rigged.result?.rigged_character_glb_url ?? rigged.model_urls?.glb;
    if (!url) throw new Error('pas de glb rigge dans la reponse');
    const mo = await download(url, dest);
    log(`OK ${ch.name} -> ${mo} Mo (rigge)`);
    st.done = true; await save();
    return { name: ch.name, ok: true };
  } catch (err) {
    log(`FAIL ${ch.name}: ${err.message}`);
    return { name: ch.name, ok: false, error: err.message };
  }
}

async function main() {
  const { charte, characters } = JSON.parse(await fs.readFile('characters.json', 'utf8'));
  const only = process.argv.slice(2);
  const todo = only.length ? characters.filter((c) => only.includes(c.name)) : characters;
  const state = await loadState();
  await fs.mkdir(OUT, { recursive: true });

  const CONCURRENCY = 3;
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) results.push(await build(charte, todo[cursor++], state));
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok);
  log(`--- ${ok.length}/${results.length} personnages rigges ---`);
  for (const r of results.filter((r) => !r.ok)) log(`  echec ${r.name} : ${r.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
