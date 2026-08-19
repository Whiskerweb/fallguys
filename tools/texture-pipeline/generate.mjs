/**
 * Génère les textures du jeu via OpenRouter, puis les rend RACCORDABLES et les installe.
 *
 * Deux écueils rencontrés et traités ici :
 *  - Le filtre Google renvoie IMAGE_RECITATION dès qu'un prompt évoque une marque ou un
 *    visuel existant. Les prompts décrivent donc une matière, jamais un jeu.
 *  - Aucun générateur ne produit une image réellement raccordable. Le décalage-fondu de
 *    seamless.mjs s'en charge après coup, donc l'image d'entrée n'a pas besoin d'être parfaite.
 *
 * Usage : node generate.mjs [nom-de-slot ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const KEY = process.env.OPENROUTER_KEY;
if (!KEY) { console.error('OPENROUTER_KEY absente (source ../../.env)'); process.exit(1); }

const MODELS = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3.1-flash-image',
  'openai/gpt-5-image-mini',
  'openai/gpt-5-image',
];
const RAW = path.resolve('raw');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function generate(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) return { error: data.error.message ?? JSON.stringify(data.error) };
  const choice = data.choices?.[0];
  const images = choice?.message?.images ?? [];
  if (!images.length) return { error: `${choice?.finish_reason ?? '?'}/${choice?.native_finish_reason ?? '?'}` };
  const url = images[0].image_url?.url ?? '';
  return { buffer: Buffer.from(url.replace(/^data:[^,]+,/, ''), 'base64') };
}

async function main() {
  const { common, slots } = JSON.parse(await fs.readFile('textures.json', 'utf8'));
  const only = process.argv.slice(2);
  const todo = only.length ? slots.filter((s) => only.includes(s.name)) : slots;
  await fs.mkdir(RAW, { recursive: true });

  const results = [];
  for (const slot of todo) {
    const prompt = `${common}\n\n${slot.prompt}`;
    let done = false;
    for (const model of MODELS) {
      const out = await generate(model, prompt);
      if (out.error) { log(`  ${slot.name} via ${model} : ${out.error}`); continue; }
      const raw = path.join(RAW, `${slot.name}.png`);
      await fs.writeFile(raw, out.buffer);
      log(`OK ${slot.name} via ${model} (${Math.round(out.buffer.length / 1024)} Ko)`);
      const { stdout } = await run('node', ['../meshy-pipeline/seamless.mjs', raw, slot.name, '1024']);
      log('   ' + stdout.trim().split('\n').pop());
      results.push(slot.name);
      done = true;
      break;
    }
    if (!done) log(`ECHEC ${slot.name} sur tous les modeles`);
  }
  log(`--- ${results.length}/${todo.length} textures installees ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
