/**
 * Fusionne plusieurs GLB Meshy en UN SEUL portant toutes leurs animations.
 *
 * Meshy livre une animation par fichier, et chaque fichier embarque une copie complete du
 * maillage et de sa texture : trois clips coutaient cinquante megaoctets pour un
 * personnage qui en pese seize. On garde donc le premier fichier tel quel et on ne
 * recopie, depuis les autres, que les donnees d'animation — quelques centaines de
 * kilo-octets.
 *
 * La fusion n'est valide que si tous les fichiers partagent la MEME liste de noeuds, dans
 * le meme ordre : les canaux d'animation ciblent les os par index, et un ordre different
 * melangerait les membres. Le script le verifie et refuse sinon.
 *
 * Usage : node fusion-anims.mjs <sortie.glb> <base.glb:nom> [autre.glb:nom ...]
 */
import fs from 'node:fs/promises';

const JSON_CHUNK = 0x4E4F534A;
const BIN_CHUNK = 0x004E4942;

function lireGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('ce n\'est pas un GLB');
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
  const texteJson = Buffer.from(JSON.stringify(json), 'utf8');
  const padJson = (4 - (texteJson.length % 4)) % 4;
  const padBin = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + texteJson.length + padJson + 8 + bin.length + padBin;

  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);

  let p = 12;
  out.writeUInt32LE(texteJson.length + padJson, p);
  out.writeUInt32LE(JSON_CHUNK, p + 4);
  texteJson.copy(out, p + 8);
  out.fill(0x20, p + 8 + texteJson.length, p + 8 + texteJson.length + padJson);   // espaces
  p += 8 + texteJson.length + padJson;

  out.writeUInt32LE(bin.length + padBin, p);
  out.writeUInt32LE(BIN_CHUNK, p + 4);
  bin.copy(out, p + 8);
  return out;
}

const [sortie, ...sources] = process.argv.slice(2);
if (!sortie || !sources.length) {
  console.error('usage: node fusion-anims.mjs <sortie.glb> <base.glb:nom> [autre.glb:nom ...]');
  process.exit(1);
}

const entrees = [];
for (const spec of sources) {
  const i = spec.lastIndexOf(':');
  const chemin = spec.slice(0, i), nom = spec.slice(i + 1);
  entrees.push({ chemin, nom, ...lireGlb(await fs.readFile(chemin)) });
}

const socle = entrees[0];
const reference = JSON.stringify(socle.json.nodes.map((n) => n.name ?? ''));
for (const e of entrees.slice(1)) {
  if (JSON.stringify(e.json.nodes.map((n) => n.name ?? '')) !== reference) {
    console.error(`ECHEC : ${e.chemin} n'a pas la meme liste de noeuds que ${socle.chemin}.`);
    console.error('Les canaux ciblent les os par index : fusionner melangerait les membres.');
    process.exit(1);
  }
}

const json = socle.json;
// Les animations de CHAQUE source sont relevees avant de vider la liste : `json` est la
// meme reference que `socle.json`, et remettre le tableau a zero effacait au passage le
// clip du fichier socle, qui disparaissait silencieusement de la fusion.
// Un nom vide ou « - » : on prend le maillage de ce fichier mais PAS son animation.
// Sert au fichier socle, dont le clip livre par Meshy n'est qu'une pose de liaison en A
// dont on ne veut pas dans le jeu.
for (const e of entrees) e.anim = (e.nom && e.nom !== '-') ? e.json.animations?.[0] : null;
json.animations = [];
const morceaux = [socle.bin];
let longueur = socle.bin.length;

for (const e of entrees) {
  const anim = e.anim;
  if (!anim) { console.log(`= ${e.chemin.split('/').pop()} : maillage seul, animation ecartee`); continue; }

  const vus = new Map();
  const copierAccessor = (idx) => {
    if (vus.has(idx)) return vus.get(idx);
    const acc = { ...e.json.accessors[idx] };
    const bv = e.json.bufferViews[acc.bufferView];
    const debut = bv.byteOffset ?? 0;
    // Alignement sur 4 octets : un accessor mal aligne fait echouer le chargement.
    const pad = (4 - (longueur % 4)) % 4;
    if (pad) { morceaux.push(Buffer.alloc(pad)); longueur += pad; }
    morceaux.push(e.bin.subarray(debut, debut + bv.byteLength));
    json.bufferViews.push({ buffer: 0, byteOffset: longueur, byteLength: bv.byteLength });
    longueur += bv.byteLength;
    acc.bufferView = json.bufferViews.length - 1;
    json.accessors.push(acc);
    const n = json.accessors.length - 1;
    vus.set(idx, n);
    return n;
  };

  json.animations.push({
    name: e.nom,
    samplers: anim.samplers.map((s) => ({
      input: copierAccessor(s.input),
      output: copierAccessor(s.output),
      ...(s.interpolation ? { interpolation: s.interpolation } : {}),
    })),
    channels: anim.channels.map((c) => ({ sampler: c.sampler, target: { ...c.target } })),
  });
  console.log(`+ "${anim.name ?? '(sans nom)'}" -> "${e.nom}" (${anim.channels.length} canaux)`);
}

const bin = Buffer.concat(morceaux);
json.buffers = [{ byteLength: bin.length }];
await fs.writeFile(sortie, ecrireGlb(json, bin));
const { size } = await fs.stat(sortie);
const total = entrees.reduce((a, e) => a + e.bin.length, 0);
console.log(`\n${sortie} : ${(size / 1024 / 1024).toFixed(2)} Mo, ${json.animations.length} animations`);
console.log(`(les ${entrees.length} fichiers d'origine pesaient ${(total / 1024 / 1024).toFixed(2)} Mo de binaire)`);
