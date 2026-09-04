/**
 * LE PROTOCOLE — ce qui passe sur le fil, et sous quelle forme.
 *
 * Deux régimes, et le partage n'est pas arbitraire :
 *
 *   - LE CHEMIN CHAUD est BINAIRE. Les entrées du joueur (60 Hz) et les instantanés du
 *     serveur (20 Hz) sont les deux seuls messages envoyés en continu ; ce sont donc les
 *     deux seuls qui méritent d'être comptés à l'octet. Un instantané de seize joueurs
 *     tient en 134 octets, soit 2,7 Ko/s par joueur.
 *   - TOUT LE RESTE EST EN JSON. Rejoindre un salon, annoncer une manche, publier un
 *     classement : quelques messages par partie. Les encoder en binaire ferait gagner des
 *     octets qu'on ne compte pas, au prix d'un format qu'on ne peut plus lire dans un
 *     journal quand quelque chose ne va pas.
 *
 * ─── LA REDONDANCE DES ENTRÉES ──────────────────────────────────────────────
 *
 * Chaque paquet d'entrée porte les TROIS DERNIÈRES frames, pas seulement la nouvelle.
 * C'est la technique standard : à 60 Hz, perdre un paquet devient invisible tant qu'on
 * n'en perd pas trois d'affilée, et il n'y a aucune retransmission à demander — donc
 * aucun aller-retour à attendre. Le coût est de six octets par paquet.
 *
 * ─── LA QUANTIFICATION DES POSITIONS ────────────────────────────────────────
 *
 * Un entier signé de 16 bits au centimètre couvre ±327,67 m. Les cinq cartes tiennent
 * dedans (la plus longue va de +40 à −220 en Z). On y gagne un facteur quatre sur des
 * flottants, et le centimètre est très en dessous de ce qu'un joueur peut distinguer à
 * l'écran — la position est de toute façon interpolée entre deux instantanés.
 *
 * Un dépassement serait silencieux et catastrophique — un joueur téléporté à l'autre bout
 * de la carte —, donc on borne explicitement plutôt que de laisser l'entier boucler.
 */

/** Les types de message, sur le premier octet des trames binaires. */
export const TYPE = { ENTREE: 1, INSTANTANE: 2 };

/** Combien de frames d'entrée voyagent dans chaque paquet. */
export const REDONDANCE = 3;

/**
 * LA CADENCE DU SERVEUR — trente ticks par seconde.
 *
 * Elle vit ici parce que c'est ce fichier qui transporte les numéros de tick : sans elle,
 * le client reçoit des ticks qu'il ne sait pas convertir en secondes.
 *
 * Et il en a besoin pour une raison précise. Le décor s'anime en fonction du temps écoulé
 * — sur Le Rondin, `angleA(elapsed) = phase + omega * elapsed` fixe à la fois le visuel du
 * tronc ET son collider. Le client comptait ce temps depuis l'OUVERTURE DE LA PAGE, le
 * serveur depuis le début de la manche : les deux troncs n'étaient pas au même angle, et
 * le joueur heurtait un obstacle qu'il ne voyait pas. Chaque page ayant son propre
 * décalage, deux joueurs ne voyaient même pas le même monde.
 *
 * `manche.js` déclare la même valeur de son côté ; un verdict vérifie qu'elles ne
 * divergent pas. C'est le même traitement que la table des gains, pour la même raison :
 * deux constantes qui doivent être égales ne le restent que si un test le dit.
 */
export const HZ = 30;

/** Les boutons, un bit chacun. */
export const BOUTON = { SAUT: 1, PLONGEON: 2 };

const CM = 100;
const BORNE = 32767;

const versCm = (m) => Math.max(-BORNE, Math.min(BORNE, Math.round(m * CM)));

/** Douze octets par joueur dans un instantané : voir le format ci-dessous. */
export const OCTETS_JOUEUR = 12;

/** Une composante de quaternion : −1..1 sur un octet signé. */
const versUnite = (n) => Math.max(-127, Math.min(127, Math.round((n ?? 0) * 127)));

/**
 * Encode un paquet d'entrées.
 *
 * @param {number} tick numéro de séquence de la frame la PLUS RÉCENTE. C'est un compteur
 *   du CLIENT, pas le tick du serveur : le client envoie des entrées avant même de
 *   savoir où en est le serveur, et c'est ce numéro que l'accusé lui renverra.
 * @param {Array<{x:number,z:number,jump:boolean,dive:boolean}>} frames
 *   de la plus ancienne à la plus récente, au plus `REDONDANCE`
 */
export function encoderEntree(tick, frames) {
  const buf = new ArrayBuffer(5 + REDONDANCE * 3);
  const vue = new DataView(buf);
  vue.setUint8(0, TYPE.ENTREE);
  vue.setUint32(1, tick >>> 0);

  // Les axes tiennent sur un octet signé : −127..127 pour −1..1. Un centième de course
  // d'axe est très en dessous de ce qu'un clavier ou une manette produisent réellement.
  for (let i = 0; i < REDONDANCE; i++) {
    const f = frames[frames.length - REDONDANCE + i] ?? frames[0] ?? { x: 0, z: 0 };
    const o = 5 + i * 3;
    vue.setInt8(o, Math.max(-127, Math.min(127, Math.round((f.x ?? 0) * 127))));
    vue.setInt8(o + 1, Math.max(-127, Math.min(127, Math.round((f.z ?? 0) * 127))));
    vue.setUint8(o + 2, (f.jump ? BOUTON.SAUT : 0) | (f.dive ? BOUTON.PLONGEON : 0));
  }
  return buf;
}

/**
 * Décode un paquet d'entrées.
 *
 * @returns {{tick:number, frames:Array}} `frames[REDONDANCE - 1]` est la plus récente, et
 *   correspond à `tick` ; celle d'avant à `tick - 1`, etc.
 */
export function decoderEntree(buf) {
  const vue = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength ?? buf.length);
  const tick = vue.getUint32(1);
  const frames = [];
  for (let i = 0; i < REDONDANCE; i++) {
    const o = 5 + i * 3;
    const b = vue.getUint8(o + 2);
    frames.push({
      tick: tick - (REDONDANCE - 1 - i),
      x: vue.getInt8(o) / 127,
      z: vue.getInt8(o + 1) / 127,
      jump: (b & BOUTON.SAUT) !== 0,
      dive: (b & BOUTON.PLONGEON) !== 0,
    });
  }
  return { tick, frames };
}

/**
 * Encode un instantané.
 *
 * Format : type(1) tick(4) ACCUSÉ(4) nombre(1) puis, par joueur,
 * index(1) x(2) y(2) z(2) etat(1) qx(1) qy(1) qz(1) qw(1). Dix octets d'en-tête, douze par
 * joueur — 202 pour seize, soit 4 ko/s à vingt instantanés par seconde.
 *
 * ─── POURQUOI L'ORIENTATION EST SUR LE FIL ──────────────────────────────────
 *
 * Le cap, lui, reste DÉDUIT du déplacement (voir `figurants.js`) : un personnage regarde
 * là où il va, et l'envoyer coûterait des octets pour rien.
 *
 * Mais le plongeon et la culbute ne sont pas des caps. Ce sont des ragdolls : le corps
 * bascule, et c'est cette bascule qui rend le geste lisible — le squelette n'écarte que
 * les membres. Sans ces quatre octets, un adversaire qui plonge glisse vers l'avant tout
 * droit, et le joueur ne voit rien. Rapporté en jouant : « on voit les sauts, on ne voit
 * pas les plongeons. »
 *
 * On envoie le quaternion tel quel, un octet par composante — chacune tient dans −1..1, ce
 * qui donne un ou deux degrés d'erreur, invisibles sur un corps qui culbute. Le déduire de
 * la pose serait une SECONDE animation, qui divergerait de la vraie au premier réglage.
 *
 * Et on l'envoie pour TOUT LE MONDE, tout le temps, même debout : un enregistrement de
 * taille fixe se décode sans ambiguïté, alors qu'un champ optionnel fait lire un octet de
 * trop et rend des positions plausibles mais fausses.
 *
 * On envoie l'INDEX et non le nom : un octet au lieu d'une chaîne, et le client connaît
 * déjà la correspondance depuis l'annonce de la manche.
 *
 * L'ACCUSÉ est le numéro de la dernière entrée que le serveur a RÉELLEMENT appliquée pour
 * le destinataire. Sans lui, le client ne peut pas réconcilier : il sait où le serveur
 * l'a placé, mais pas jusqu'où ce serveur avait lu ses touches, donc il ne sait pas
 * quelles entrées rejouer par-dessus. C'est la seule raison pour laquelle l'instantané
 * n'est pas identique pour tout le monde — on le sérialise donc une fois par joueur, ce
 * qui coûte 320 sérialisations par seconde pour seize joueurs. Rien du tout.
 */
export function encoderInstantane(tick, joueurs, accuse = 0) {
  const buf = new ArrayBuffer(10 + joueurs.length * OCTETS_JOUEUR);
  const vue = new DataView(buf);
  vue.setUint8(0, TYPE.INSTANTANE);
  vue.setUint32(1, tick >>> 0);
  vue.setUint32(5, accuse >>> 0);
  vue.setUint8(9, joueurs.length);

  for (let i = 0; i < joueurs.length; i++) {
    const j = joueurs[i];
    const o = 10 + i * OCTETS_JOUEUR;
    vue.setUint8(o, j.index);
    vue.setInt16(o + 1, versCm(j.x));
    vue.setInt16(o + 3, versCm(j.y));
    vue.setInt16(o + 5, versCm(j.z));
    vue.setUint8(o + 7, codeEtat(j));
    vue.setInt8(o + 8, versUnite(j.qx));
    vue.setInt8(o + 9, versUnite(j.qy));
    vue.setInt8(o + 10, versUnite(j.qz));
    vue.setInt8(o + 11, versUnite(j.qw));
  }
  return buf;
}

export function decoderInstantane(buf) {
  const vue = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength ?? buf.length);
  const tick = vue.getUint32(1);
  const accuse = vue.getUint32(5);
  const n = vue.getUint8(9);
  const joueurs = [];
  for (let i = 0; i < n; i++) {
    const o = 10 + i * OCTETS_JOUEUR;
    const e = vue.getUint8(o + 7);
    joueurs.push({
      index: vue.getUint8(o),
      x: vue.getInt16(o + 1) / CM,
      y: vue.getInt16(o + 3) / CM,
      z: vue.getInt16(o + 5) / CM,
      pose: POSES[e & 0x0f] ?? 'grounded',
      etat: COURSE[(e >> 4) & 0x0f] ?? 'court',
      qx: vue.getInt8(o + 8) / 127,
      qy: vue.getInt8(o + 9) / 127,
      qz: vue.getInt8(o + 10) / 127,
      qw: vue.getInt8(o + 11) / 127,
    });
  }
  return { tick, accuse, joueurs };
}

/*
 * L'état tient sur UN octet : la pose du personnage dans les quatre bits bas, sa situation
 * dans la manche dans les quatre bits hauts. Le client en a besoin pour choisir une
 * animation et pour griser un joueur éliminé — deux choses qu'une position seule ne dit pas.
 */
/*
 * Les MEMES chaines que `State` dans `character.js`, a la lettre pres.
 *
 * `gettingUp` etait ecrit `getup` ici : `indexOf` rendait -1, ramene a 0 par le
 * `Math.max`, et l'etat partait donc encode comme « au sol ». Un adversaire en train de se
 * relever apparaissait debout et courant. Une table de correspondance qui se trompe d'un
 * caractere ne leve aucune erreur — elle ment.
 */
const POSES = ['grounded', 'airborne', 'diving', 'tumbling', 'gettingUp'];
const COURSE = ['court', 'qualifie', 'elimine'];

function codeEtat(j) {
  const p = Math.max(0, POSES.indexOf(j.pose));
  const c = Math.max(0, COURSE.indexOf(j.etat));
  return (c << 4) | p;
}

/** Le type d'une trame binaire reçue, ou `null` si ce n'en est pas une. */
export function typeDe(donnees) {
  if (typeof donnees === 'string') return null;
  const vue = new Uint8Array(donnees.buffer ?? donnees, donnees.byteOffset ?? 0, 1);
  return vue[0] ?? null;
}
