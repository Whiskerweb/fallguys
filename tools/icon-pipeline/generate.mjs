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

/**
 * Detoure l'icone. Le fond n'est PAS suppose vert : certains modeles rendent sur un
 * fond de leur choix malgre la consigne. On echantillonne donc les quatre coins ; s'ils
 * concordent, cette couleur est le fond et on la retire par distance colorimetrique.
 * Un remplissage par diffusion depuis les bords evite d'effacer une zone interieure
 * qui aurait la meme couleur que le fond.
 */
async function cutout(srcPath, dstPath, size = 256) {
  const img = await Jimp.read(srcPath);
  img.resize({ w: size, h: size });
  const w = img.bitmap.width, h = img.bitmap.height, d = img.bitmap.data;
  const at = (x, y) => (y * w + x) * 4;

  // Couleur de fond = mediane des quatre coins.
  const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => {
    const i = at(x, y); return [d[i], d[i + 1], d[i + 2]];
  });
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, k) => s + k[c], 0) / corners.length));
  const spread = Math.max(...corners.map((k) => Math.hypot(k[0] - bg[0], k[1] - bg[1], k[2] - bg[2])));
  if (spread > 60) { await img.write(dstPath); return { removed: 0, note: 'coins discordants' }; }

  const dist = (i) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
  const NEAR = 62, FAR = 108;

  // Diffusion depuis les bords : seul le fond CONNECTE au bord est retire.
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push([x, 0], [x, h - 1]); }
  for (let y = 0; y < h; y++) { stack.push([0, y], [w - 1, y]); }
  let removed = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const k = y * w + x;
    if (seen[k]) continue;
    const i = k * 4;
    const dd = dist(i);
    if (dd > FAR) continue;
    seen[k] = 1;
    if (dd <= NEAR) { d[i + 3] = 0; removed++; }
    else {
      // Bord anticrenele : opacite progressive, et on neutralise la teinte du fond
      // qui laisserait un lisere colore sur les contours.
      d[i + 3] = Math.round(255 * ((dd - NEAR) / (FAR - NEAR)));
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] * 0.55 + 128 * 0.45);
    }
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  await img.write(dstPath);
  return { removed, bg };
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
      const cut = await cutout(raw, path.join(OUT, `${icon.name}.png`));
      log(`OK ${icon.name} (${model.split('/')[1]}) — fond retire : ${cut.removed ?? 0} px${cut.note ? ' · ' + cut.note : ''}`);
      done.push(icon.name);
      ok = true;
      break;
    }
    if (!ok) log(`ECHEC ${icon.name}`);
  }

  /*
   * Le manifeste reflete le CONTENU du dossier, jamais le resultat du run.
   *
   * Il etait ecrit a partir de `done` : regenerer une seule icone effacait toutes les
   * autres de la liste, et `applyIcons()` les ignorait alors bien qu'elles soient sur le
   * disque. Les vignettes de map, produites par `cartes.mjs` qui ne touche pas au
   * manifeste, n'y figuraient jamais. C'est deja ainsi que procedent
   * `diag/portrait.mjs` et `meshy-pipeline/generate.mjs`.
   */
  const liste = (await fs.readdir(OUT))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort();
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(liste, null, 2));
  log(`--- ${done.length}/${todo.length} icones installees · manifeste : ${liste.length} entrees ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
