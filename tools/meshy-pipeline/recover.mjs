/** Recupere un rigging deja termine cote Meshy dont le telechargement a echoue. */
import fs from 'node:fs/promises';
import path from 'node:path';
const KEY = process.env.MESHY_API_KEY;
const headers = { Authorization: `Bearer ${KEY}` };
const STATE = path.resolve('from-art-state.json');
const OUT = path.resolve('../feel-lab/public/models');
const state = JSON.parse(await fs.readFile(STATE, 'utf8'));

for (const [name, st] of Object.entries(state)) {
  if (st.done || !st.rig) continue;
  const res = await fetch(`https://api.meshy.ai/openapi/v1/rigging/${st.rig}`, { headers });
  const task = await res.json();
  console.log(`${name}: ${task.status} ${task.progress ?? 0}%`);
  if (task.status !== 'SUCCEEDED') continue;
  const url = task.result?.rigged_character_glb_url ?? task.model_urls?.glb;
  if (!url) { console.log('  pas d url glb', JSON.stringify(task).slice(0, 300)); continue; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  await fs.writeFile(path.join(OUT, `${name}.glb`), buf);
  st.done = true;
  await fs.writeFile(STATE, JSON.stringify(state, null, 2));
  console.log(`  -> ${name}.glb (${(buf.length / 1e6).toFixed(1)} Mo)`);
}
