/**
 * Icones d'interface : generation via OpenRouter puis DETOURAGE.
 *
 * Les modeles d'image ne produisent pas de transparence. On genere donc sur un fond
 * vert chroma pur, puis on le supprime par distance colorimetrique. Le seuil est
 * volontairement large et suivi d'un adoucissement des bords, sinon il reste un lisere
 * vert sur les contours anti-crenelés.
 *
 * Usage : node generate.mjs [nom ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Jimp } from 'jimp';

const KEY = process.env.OPENROUTER_KEY;
if (!KEY) { console.error('OPENROUTER_KEY absente'); process.exit(1); }

const MODELS = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3.1-flash-image',
  'openai/gpt-5-image-mini',
];
const OUT = path.resolve('../feel-lab/public/icons');
const RAW = path.resolve('raw');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function generate(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) return { error: String(data.error.message ?? data.error).slice(0, 120) };
  const choice = data.choices?.[0];
  const images = choice?.message?.images ?? [];
  if (!images.length) return { error: `${choice?.finish_reason ?? '?'}/${choice?.native_finish_reason ?? '?'}` };
  return { buffer: Buffer.from((images[0].image_url?.url ?? '').replace(/^data:[^,]+,/, ''), 'base64') };
}

/** Retire le fond vert et adoucit le liseré laissé par l'anticrénelage. */
async function cutout(srcPath, dstPath, size = 256) {
  const img = await Jimp.read(srcPath);
  img.resize({ w: size, h: size });
  const w = img.bitmap.width, h = img.bitmap.height, d = img.bitmap.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // Vert dominant et franc : c'est le fond.
    const greenness = g - Math.max(r, b);
    if (greenness > 55) {
      d[i + 3] = 0;
    } else if (greenness > 22) {
      // Bord anticrenelé : semi-transparent, et on retire la teinte verte résiduelle
      // sinon les contours gardent un halo vert très visible sur fond sombre.
      d[i + 3] = Math.round(255 * (1 - (greenness - 22) / 33));
      d[i + 1] = Math.round((r + b) / 2);
    }
  }
  await img.write(dstPath);
}

async function main() {
  const { charte, icons } = JSON.parse(await fs.readFile('icons.json', 'utf8'));
  const only = process.argv.slice(2);
  const todo = only.length ? icons.filter((i) => only.includes(i.name)) : icons;
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(RAW, { recursive: true });

  const done = [];
  for (const icon of todo) {
    const prompt = `${charte} SUBJECT: ${icon.prompt}.`;
    let ok = false;
    for (const model of MODELS) {
      const out = await generate(model, prompt);
      if (out.error) { log(`  ${icon.name} via ${model} : ${out.error}`); continue; }
      const raw = path.join(RAW, `${icon.name}.png`);
      await fs.writeFile(raw, out.buffer);
      await cutout(raw, path.join(OUT, `${icon.name}.png`));
      log(`OK ${icon.name} (${model.split('/')[1]})`);
      done.push(icon.name);
      ok = true;
      break;
    }
    if (!ok) log(`ECHEC ${icon.name}`);
  }
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(done, null, 2));
  log(`--- ${done.length}/${todo.length} icones installees ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
