/**
 * Rend une image RACCORDABLE (tileable) puis l'installe dans le jeu.
 *
 * Une image générée par IA ne se raccorde jamais d'elle-même : ses bords ne coïncident
 * pas. On applique un décalage-fondu : l'image est mélangée avec sa propre copie décalée
 * d'une demi-largeur, pondérée par la distance au bord. Les bords deviennent alors du
 * contenu venu du centre — continu par construction — avec une transition douce.
 * Le motif n'a donc pas besoin d'être parfait en sortie du générateur.
 *
 * Usage : node seamless.mjs <image> <nom-de-slot> [taille]
 *   ex.  node seamless.mjs ~/Downloads/quilt.png ground-quilt
 */
import { Jimp } from 'jimp';
import path from 'node:path';
import fs from 'node:fs/promises';

const SLOTS = [
  'ground-quilt', 'ground-check', 'ground-scale', 'ground-polka',
  'hazard-stripes', 'grass', 'inflatable-bands', 'confetti',
];
const OUT = path.resolve('../feel-lab/public/textures');

const [src, slot, sizeArg] = process.argv.slice(2);
if (!src || !slot) {
  console.error('usage: node seamless.mjs <image> <slot> [taille]');
  console.error('slots: ' + SLOTS.join(', '));
  process.exit(1);
}
if (!SLOTS.includes(slot)) console.warn(`! "${slot}" ne correspond a aucun slot connu — le jeu l'ignorera.`);

const SIZE = Number(sizeArg) || 1024;
const BAND = Math.round(SIZE * 0.22);           // largeur de la zone de fondu

const smooth = (t) => t * t * (3 - 2 * t);      // lissage cubique, évite une cassure nette

const img = await Jimp.read(src);
img.resize({ w: SIZE, h: SIZE });

const orig = img.clone();
const half = SIZE >> 1;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dEdge = Math.min(x, SIZE - 1 - x, y, SIZE - 1 - y);
    if (dEdge >= BAND) continue;                // le centre reste intact
    const w = smooth(dEdge / BAND);

    const x2 = (x + half) % SIZE;
    const y2 = (y + half) % SIZE;
    const a = orig.getPixelColor(x, y);
    const b = orig.getPixelColor(x2, y2);

    const mix = (sa, sb) => Math.round(sa * w + sb * (1 - w));
    const c = ((mix((a >>> 24) & 255, (b >>> 24) & 255) << 24) |
               (mix((a >>> 16) & 255, (b >>> 16) & 255) << 16) |
               (mix((a >>> 8) & 255, (b >>> 8) & 255) << 8) | 255) >>> 0;
    img.setPixelColor(c, x, y);
  }
}

await fs.mkdir(OUT, { recursive: true });
const dest = path.join(OUT, `${slot}.png`);
await img.write(dest);

// Contrôle : écart moyen entre les colonnes/lignes opposées. Proche de 0 = raccord propre.
let diff = 0;
for (let i = 0; i < SIZE; i++) {
  const l = img.getPixelColor(0, i), r = img.getPixelColor(SIZE - 1, i);
  const t = img.getPixelColor(i, 0), b = img.getPixelColor(i, SIZE - 1);
  for (const [p, q] of [[l, r], [t, b]]) {
    diff += Math.abs(((p >>> 24) & 255) - ((q >>> 24) & 255))
          + Math.abs(((p >>> 16) & 255) - ((q >>> 16) & 255))
          + Math.abs(((p >>> 8) & 255) - ((q >>> 8) & 255));
  }
}
const score = diff / (SIZE * 6);
console.log(`OK ${dest}`);
console.log(`ecart moyen aux bords : ${score.toFixed(1)}/255  (${score < 8 ? 'raccord propre' : 'raccord perfectible — augmenter BAND'})`);
