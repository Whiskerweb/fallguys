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

/**
 * Slots connus, LUS a la source.
 *
 * La liste etait ecrite en dur et s'est perimee : huit noms figes pour vingt-neuf slots
 * reels, donc l'avertissement se declenchait sur presque tout et ne voulait plus rien dire.
 * On lit desormais `textures.json`, qui est la declaration de reference — la liste ne peut
 * plus diverger de ce que le pipeline sait produire.
 */
async function slotsConnus() {
  try {
    const src = await fs.readFile(path.resolve('../texture-pipeline/textures.json'), 'utf8');
    return JSON.parse(src).slots.map((s) => s.name);
  } catch {
    return [];   // liste indisponible : on n'avertit sur rien plutot que d'avertir a tort
  }
}
const SLOTS = await slotsConnus();
const OUT = path.resolve('../feel-lab/public/textures');

const [src, slot, sizeArg, liftArg] = process.argv.slice(2);
if (!src || !slot) {
  console.error('usage: node seamless.mjs <image> <slot> [taille]');
  console.error('slots: ' + SLOTS.join(', '));
  process.exit(1);
}
if (SLOTS.length && !SLOTS.includes(slot)) {
  console.warn(`! "${slot}" ne correspond a aucun slot connu — le jeu l'ignorera.`);
}

const SIZE = Number(sizeArg) || 1024;
/**
 * `lift` remonte les valeurs sombres vers le blanc : out = 1 - (1-in) * (1-lift).
 * Une texture de MOTIF multiplie la couleur du matériau ; ses creux gris désaturent
 * donc le rose en rose sale. En relevant les creux, le relief reste lisible mais la
 * couleur du matériau s'exprime pleinement. À ne pas appliquer aux textures de SIGNAL,
 * qui portent elles-mêmes leurs couleurs.
 */
const LIFT = Math.min(0.95, Math.max(0, Number(liftArg) || 0));
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

if (LIFT > 0) {
  const k = 1 - LIFT;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = img.getPixelColor(x, y);
      const up = (v) => Math.round(255 - (255 - v) * k);
      const n = ((up((c >>> 24) & 255) << 24) | (up((c >>> 16) & 255) << 16) |
                 (up((c >>> 8) & 255) << 8) | 255) >>> 0;
      img.setPixelColor(n, x, y);
    }
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
