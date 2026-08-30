/**
 * Recompresse les textures d'un GLB : c'est presque toujours elles qui pesent, pas la
 * geometrie.
 *
 * Meshy livre ses personnages avec une planche PNG en pleine resolution — jusqu'a
 * dix-sept megaoctets pour un seul modele de trente mille triangles. Sur un personnage
 * vu a quelques metres, la difference entre 4096 et 1024 pixels ne se voit pas, mais
 * elle divise le telechargement par trente.
 *
 * Le PNG devient du JPEG, sauf s'il porte de la transparence : un JPEG n'a pas de canal
 * alpha, et convertir une texture a trous la remplirait de noir.
 *
 * Usage : node retexture.mjs <entree.glb> <sortie.glb> [taille] [qualite]
 */
import fs from 'node:fs/promises';
import { Jimp } from 'jimp';

const JSON_CHUNK = 0x4E4F534A;
const BIN_CHUNK = 0x004E4942;

function lireGlb(buf) {
  let offset = 12, json = null, bin = null;
  while (offset < buf.length) {
    const longueur = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + longueur);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK) bin = data;
    offset += 8 + longueur + ((4 - (longueur % 4)) % 4);
  }
  return { json, bin };
}

function ecrireGlb(json, bin) {
  const texte = Buffer.from(JSON.stringify(json), 'utf8');
  const padJson = (4 - (texte.length % 4)) % 4;
  const padBin = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + texte.length + padJson + 8 + bin.length + padBin;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let p = 12;
  out.writeUInt32LE(texte.length + padJson, p);
  out.writeUInt32LE(JSON_CHUNK, p + 4);
  texte.copy(out, p + 8);
  out.fill(0x20, p + 8 + texte.length, p + 8 + texte.length + padJson);
  p += 8 + texte.length + padJson;
  out.writeUInt32LE(bin.length + padBin, p);
  out.writeUInt32LE(BIN_CHUNK, p + 4);
  bin.copy(out, p + 8);
  return out;
}

const [src, dst, tailleArg, qualiteArg] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node retexture.mjs <entree.glb> <sortie.glb> [taille] [qualite]');
  process.exit(1);
}
const TAILLE = Number(tailleArg) || 1024;
const QUALITE = Number(qualiteArg) || 88;

const { json, bin } = lireGlb(await fs.readFile(src));
const images = json.images ?? [];
if (!images.length) { console.log('aucune image : rien a faire'); process.exit(0); }

// Le binaire est reconstruit morceau par morceau : les bufferViews des images sont
// remplacees, toutes les autres sont recopiees telles quelles avec un offset corrige.
const garder = json.bufferViews.map((bv, i) => ({ i, bv, image: null }));
for (const [k, im] of images.entries()) {
  if (im.bufferView === undefined) continue;
  const bv = json.bufferViews[im.bufferView];
  const brut = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const img = await Jimp.read(Buffer.from(brut));
  const avant = `${img.bitmap.width}x${img.bitmap.height}`;
  // La transparence interdit le JPEG : on garde alors le PNG, seulement redimensionne.
  let alpha = false;
  for (let p = 3; p < img.bitmap.data.length && !alpha; p += 4) if (img.bitmap.data[p] < 250) alpha = true;
  const cote = Math.min(TAILLE, Math.max(img.bitmap.width, img.bitmap.height));
  img.resize({ w: cote, h: cote });
  const sortie = alpha
    ? await img.getBuffer('image/png')
    : await img.getBuffer('image/jpeg', { quality: QUALITE });
  garder[im.bufferView].image = sortie;
  im.mimeType = alpha ? 'image/png' : 'image/jpeg';
  console.log(`  image ${k} : ${avant} ${(bv.byteLength / 1048576).toFixed(1)} Mo`
    + ` -> ${cote}x${cote} ${(sortie.length / 1048576).toFixed(2)} Mo${alpha ? ' (PNG, transparence)' : ' (JPEG)'}`);
}

const morceaux = [];
let longueur = 0;
for (const e of garder) {
  const data = e.image ?? bin.subarray(e.bv.byteOffset ?? 0, (e.bv.byteOffset ?? 0) + e.bv.byteLength);
  const pad = (4 - (longueur % 4)) % 4;
  if (pad) { morceaux.push(Buffer.alloc(pad)); longueur += pad; }
  e.bv.byteOffset = longueur;
  e.bv.byteLength = data.length;
  morceaux.push(data);
  longueur += data.length;
}
const nouveauBin = Buffer.concat(morceaux);
json.buffers = [{ byteLength: nouveauBin.length }];
await fs.writeFile(dst, ecrireGlb(json, nouveauBin));
const avant = (await fs.stat(src)).size, apres = (await fs.stat(dst)).size;
console.log(`${dst} : ${(avant / 1048576).toFixed(1)} Mo -> ${(apres / 1048576).toFixed(1)} Mo`);
