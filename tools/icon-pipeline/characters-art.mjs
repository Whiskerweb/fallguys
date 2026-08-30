/**
 * Planches de personnages, etape 1 du pipeline image-to-3D.
 *
 * On dessine d'abord, on modelise ensuite. Le text-to-3D de Meshy interprete librement
 * le prompt et donne des resultats inegaux ; partir d'une image fige la silhouette, la
 * palette et l'expression avant la conversion, et le modele obtenu ressemble a ce qu'on
 * a valide a l'ecran.
 *
 * Contraintes de l'image, imposees par la suite du pipeline :
 *  - pose en A, bras ecartes et jambes separees : sans quoi le rigging automatique
 *    echoue a estimer la pose ;
 *  - vue de face, corps entier, fond blanc uni : la reconstruction 3D suit la silhouette,
 *    tout decor parasite s'y retrouve modelise.
 *
 * Usage : node characters-art.mjs [nom ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.OPENROUTER_KEY;
if (!KEY) { console.error('OPENROUTER_KEY absente'); process.exit(1); }

const MODELS = ['google/gemini-2.5-flash-image', 'google/gemini-3.1-flash-image', 'openai/gpt-5-image-mini'];
const OUT = path.resolve('character-art');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function generate(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) return { error: String(data.error.message ?? data.error).slice(0, 130) };
  const choice = data.choices?.[0];
  const images = choice?.message?.images ?? [];
  if (!images.length) return { error: `${choice?.finish_reason ?? '?'}/${choice?.native_finish_reason ?? '?'}` };
  return { buffer: Buffer.from((images[0].image_url?.url ?? '').replace(/^data:[^,]+,/, ''), 'base64') };
}

const { charte, characters } = JSON.parse(await fs.readFile('characters-art.json', 'utf8'));
const only = process.argv.slice(2);
const todo = only.length ? characters.filter((c) => only.includes(c.name)) : characters;
await fs.mkdir(OUT, { recursive: true });

const done = [];
for (const ch of todo) {
  const dest = path.join(OUT, `${ch.name}.png`);
  try { await fs.access(dest); log(`= ${ch.name} deja present`); done.push(ch.name); continue; } catch {}
  let ok = false;
  for (const model of MODELS) {
    const out = await generate(model, `${charte}\n\nCHARACTER: ${ch.prompt}.`);
    if (out.error) { log(`  ${ch.name} via ${model} : ${out.error}`); continue; }
    await fs.writeFile(dest, out.buffer);
    log(`OK ${ch.name} (${model.split('/')[1]}) ${Math.round(out.buffer.length / 1024)} Ko`);
    done.push(ch.name);
    ok = true;
    break;
  }
  if (!ok) log(`ECHEC ${ch.name}`);
}
log(`--- ${done.length}/${todo.length} planches ---`);
