/**
 * LE TAMPON D'ENTRÉES, à sec — sans serveur, sans physique, sans horloge.
 *
 * `serveur/src/tampon.js` est la pièce qui a remplacé « rejouer la dernière entrée reçue »
 * par « jouer chaque image une fois, à son rang ». Ce banc lui présente les cas que le
 * réseau produit vraiment — un flux régulier, une image de retard, une coupure suivie
 * d'une rafale, un paquet perdu, un silence — et vérifie ce qu'il rend à chaque tick :
 * les images, l'accusé, et ce qu'il fait de son avance.
 */

import { creerTampon, resumer, CIBLE_MIN, CIBLE_MAX, MARGE } from '../../serveur/src/tampon.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** Un paquet tel que le protocole le livre : le numéro, et les trois dernières images. */
const paquet = (seq, faire = () => ({})) => ({
  seq,
  frames: [seq - 2, seq - 1, seq].map((t) => ({ tick: t, x: 0, z: -1, jump: false, dive: false, ...faire(t) })),
});

// ===========================================================================
titre('1. Un flux régulier : chaque image est jouée une fois, à son rang');
// ===========================================================================
{
  const t = creerTampon();
  let seq = 0;
  const joues = [];
  let tick = 0;
  // Deux images par tick, comme un client à 60 pas par seconde face à 30 ticks.
  for (let i = 0; i < 100; i++) {
    for (let k = 0; k < 2; k++) { const p = paquet(++seq); t.deposer(p.seq, p.frames); }
    for (const f of t.tirer(2, ++tick)) if (!f.extrapole) joues.push(f.seq);
  }
  // Le tampon garde `CIBLE_MIN` images d'avance : les toutes dernières attendent le tick suivant.
  dit(joues.length === 200 - CIBLE_MIN, `${joues.length} images jouées sur 200 déposées — ${CIBLE_MIN} d'avance en file`);
  dit(joues.every((s, i) => s === i + 1), 'dans l\'ordre, sans trou ni doublon');
  dit(t.accuse === 200 - CIBLE_MIN, `l'accusé est la dernière image JOUÉE (${t.accuse}), pas la dernière reçue (200)`);
  dit(t.profondeur === CIBLE_MIN, `la réserve tient : ${t.profondeur} images en file après le tick`);
  dit(t.statistiques.famines === 0 && t.statistiques.sautes === 0, 'aucune famine, aucune image sautée');
  dit(t.cible === CIBLE_MIN, `la cible reste au minimum (${t.cible})`);
}

// ===========================================================================
titre('1 bis. Le battement des horloges : une image ce tick, trois le suivant');
// ===========================================================================
{
  // Soixante envois par seconde face à trente ticks ne tombent jamais en phase : un tick
  // en voit arriver une, le suivant trois. C'est la réserve qui absorbe ce battement.
  const t = creerTampon();
  let seq = 0;
  let tick = 0;
  let joues = 0;
  for (let i = 0; i < 100; i++) {
    const n = i % 2 === 0 ? 1 : 3;
    for (let k = 0; k < n; k++) { const p = paquet(++seq); t.deposer(p.seq, p.frames); }
    for (const f of t.tirer(2, ++tick)) if (!f.extrapole) joues++;
  }
  dit(t.statistiques.famines === 0, `aucune famine sur ${joues} images jouées : le battement est absorbé`);
  dit(t.cible === CIBLE_MIN, `la cible n'a pas eu à monter (${t.cible})`);
}

// ===========================================================================
titre('2. Un paquet perdu : la redondance le reconstitue');
// ===========================================================================
{
  const t = creerTampon();
  let seq = 0;
  const joues = [];
  let tick = 0;
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < 2; k++) {
      const p = paquet(++seq);
      if (seq % 7 === 0) continue;        // ce paquet n'arrive jamais
      t.deposer(p.seq, p.frames);
    }
    for (const f of t.tirer(2, ++tick)) if (!f.extrapole) joues.push(f.seq);
  }
  dit(joues.every((s, i) => s === i + 1), `${joues.length} images jouées sans trou : le paquet suivant portait la perdue`);
  dit(t.statistiques.famines === 0, 'et sans famine : la perte est invisible tant qu\'on n\'en perd pas trois d\'affilée');
}

// ===========================================================================
titre('3. Le silence : on extrapole les axes, jamais un bouton, et l\'accusé ne bouge pas');
// ===========================================================================
{
  const t = creerTampon();
  let tick = 0;
  // Dix images, la dernière avec un saut et une direction, puis plus rien.
  for (let s = 1; s <= 10; s++) t.deposer(s, [{ tick: s, x: 0.5, z: -1, jump: s === 10, dive: false }]);
  const avant = [];
  while (t.profondeur > 0) avant.push(...t.tirer(2, ++tick));
  const saut = avant.filter((f) => f.jump).length;
  const accuse = t.accuse;
  const pendant = [];
  for (let i = 0; i < 30; i++) pendant.push(...t.tirer(2, ++tick));
  dit(saut === 1, `le saut a été joué une fois (${saut})`);
  dit(pendant.every((f) => f.extrapole), `${pendant.length} images extrapolées pendant le silence`);
  dit(pendant.every((f) => f.x === 0.5 && f.z === -1), 'avec les derniers axes connus : le personnage continue tout droit');
  dit(pendant.every((f) => !f.jump && !f.dive), 'et sans aucun bouton : un saut ne se devine pas');
  dit(t.accuse === accuse, `l'accusé est resté à ${accuse} : le client sait qu'il n'y a rien de neuf à comparer`);
  dit(t.statistiques.famines === 1, 'une seule famine comptée pour tout l\'épisode');
  dit(t.cible === CIBLE_MIN, `la cible n'a pas bougé (${t.cible}) : rien n'est revenu pour dire si c'était le réseau`);
}

// ===========================================================================
titre('4. Une coupure puis une rafale : on saute ce qu\'on a extrapolé, on garde les boutons');
// ===========================================================================
{
  const t = creerTampon();
  let tick = 0;
  let seq = 0;
  for (let i = 0; i < 10; i++) { for (let k = 0; k < 2; k++) { const p = paquet(++seq); t.deposer(p.seq, p.frames); } t.tirer(2, ++tick); }
  const cibleAvant = t.cible;
  const avant = t.statistiques.extrapoles;
  // Trois cents millisecondes sans rien : neuf ticks, dont le premier vit sur la réserve.
  for (let i = 0; i < 9; i++) t.tirer(2, ++tick);
  const extrapoles = t.statistiques.extrapoles - avant;
  dit(extrapoles === 16, `la réserve a tenu un tick, puis ${extrapoles} pas ont été extrapolés`);
  // Puis les dix-huit images arrivent d'un coup — l'une d'elles porte un saut.
  for (let k = 0; k < 18; k++) { const p = paquet(++seq, (s) => ({ jump: s === 21 })); t.deposer(p.seq, p.frames); }
  dit(t.profondeur === 18, `rien n'est jeté à la réception : ${t.profondeur} en file`);
  const suite = t.tirer(2, ++tick);
  dit(t.cible > cibleAvant, `la rafale prouve que c'était le réseau : la cible monte de ${cibleAvant} à ${t.cible}`);
  dit(t.statistiques.sautes === extrapoles,
    `à la reprise on saute AUTANT d'images qu'on a extrapolé de pas (${t.statistiques.sautes}) : le personnage n'a pas joué la coupure deux fois`);
  dit(suite.every((f) => !f.extrapole) && t.accuse === 38, `et on joue les plus récentes : l'accusé est à ${t.accuse}`);
  dit(suite.filter((f) => f.jump).length === 1, 'le saut demandé pendant la coupure est reporté sur la première image gardée');
  dit(t.statistiques.dette === 0, 'la dette est soldée');
}

// ===========================================================================
titre('4 bis. Un joueur immobile offre sa réserve ; un joueur qui court ne paie rien');
// ===========================================================================
{
  // Immobile : les images arrivent une par tick (un client à trente pas par seconde), et
  // le serveur en garde pour plus tard sans que personne ne le voie.
  const t = creerTampon();
  let tick = 0;
  let seq = 0;
  // Le départ : quatre images d'un coup, comme après le décompte.
  for (let k = 0; k < 4; k++) t.deposer(++seq, [{ tick: seq, x: 0, z: 0, jump: false, dive: false }]);
  t.tirer(2, ++tick);
  let joues = 0;
  for (let i = 0; i < 20; i++) {
    t.deposer(++seq, [{ tick: seq, x: 0, z: 0, jump: false, dive: false }]);
    for (const f of t.tirer(2, ++tick)) if (!f.extrapole) joues++;
  }
  dit(t.statistiques.famines === 0, `aucune famine : un joueur immobile ne doit rien (${joues} images jouées sur 22 reçues)`);
  dit(t.profondeur >= CIBLE_MIN, `et la réserve s'est reconstituée : ${t.profondeur} images en file`);

  // Qui court : les mêmes arrivées, mais le personnage bouge — on joue tout de suite.
  const c = creerTampon();
  tick = 0; seq = 0;
  for (let k = 0; k < 4; k++) c.deposer(++seq, [{ tick: seq, x: 0, z: -1, jump: false, dive: false }]);
  c.tirer(2, ++tick);
  const avant = c.accuse;
  c.deposer(++seq, [{ tick: seq, x: 0, z: -1, jump: false, dive: false }]);
  c.tirer(2, ++tick);
  dit(c.accuse > avant, `l'image d'un joueur qui court est jouée dès son arrivée (accusé ${avant} → ${c.accuse})`);

  // Un client LENT (dix images par seconde, un navigateur à genoux) : ses famines ne font
  // pas monter la cible, et la reconstitution à l'arrêt n'attend pas indéfiniment.
  const l = creerTampon();
  tick = 0; seq = 0;
  for (let i = 0; i < 90; i++) {
    if (i % 3 === 0) l.deposer(++seq, [{ tick: seq, x: 0, z: -1, jump: false, dive: false }]);
    l.tirer(2, ++tick);
  }
  dit(l.statistiques.famines > 10 && l.cible === CIBLE_MIN,
    `${l.statistiques.famines} famines d'un client lent, et la cible reste à ${l.cible} : plus d'avance ne l'aiderait pas`);
  // Le même client s'arrête, puis plonge : le plongeon part au plus tard `cible` ticks après.
  for (let i = 0; i < 30; i++) { if (i % 3 === 0) l.deposer(++seq, [{ tick: seq, x: 0, z: 0, jump: false, dive: false }]); l.tirer(2, ++tick); }
  l.deposer(++seq, [{ tick: seq, x: 0, z: 0, jump: false, dive: true }]);
  let delai = 0;
  while (delai < 20 && !l.tirer(2, ++tick).some((f) => f.dive)) delai++;
  dit(delai <= CIBLE_MIN, `son plongeon est joué ${delai} tick(s) après son arrivée — la réserve ne le retient pas`);
}

// ===========================================================================
titre('5. La cible redescend avec le calme, et ne dépasse jamais le plafond');
// ===========================================================================
{
  const t = creerTampon();
  let tick = 0;
  let seq = 0;
  // Dix coupures coup sur coup — chacune après assez d'images pour que le tampon ait
  // repris — : la cible bute sur le plafond.
  for (let i = 0; i < 10; i++) {
    for (let k = 0; k < CIBLE_MAX + 4; k++) { const p = paquet(++seq); t.deposer(p.seq, p.frames); }
    for (let k = 0; k < CIBLE_MAX; k++) t.tirer(2, ++tick);
  }
  dit(t.cible === CIBLE_MAX, `la cible plafonne à ${t.cible} images (${Math.round(CIBLE_MAX / 60 * 1000)} ms)`);
  // Puis un flux parfait pendant trente secondes.
  for (let i = 0; i < 900; i++) { for (let k = 0; k < 2; k++) { const p = paquet(++seq); t.deposer(p.seq, p.frames); } t.tirer(2, ++tick); }
  dit(t.cible === CIBLE_MAX - 3, `trente secondes de calme rendent trois images (${t.cible})`);
  dit(t.profondeur <= t.cible + 2 + MARGE, `la file ne dépasse pas cible + tick + marge (${t.profondeur})`);
}

// ===========================================================================
titre('6. Le résumé d\'un tick : les axes de la dernière image, les boutons de toutes');
// ===========================================================================
{
  const r = resumer([{ seq: 1, x: 0.2, z: -1, jump: true, dive: false }, { seq: 2, x: 0.9, z: 0, jump: false, dive: true }]);
  dit(r.x === 0.9 && r.z === 0, 'les axes sont ceux de la dernière image');
  dit(r.jump && r.dive, 'un bouton pressé sur l\'une des deux se lit dans le résumé');
  dit(r.pas.length === 2, 'et les images elles-mêmes voyagent avec, pour la simulation');
}

// ===========================================================================
titre('7. Un paquet en retard sur un autre est ignoré en bloc');
// ===========================================================================
{
  const t = creerTampon();
  const a = paquet(10); const b = paquet(8);
  dit(t.deposer(a.seq, a.frames) === true, 'le paquet 10 est rangé');
  dit(t.deposer(b.seq, b.frames) === false, 'le paquet 8, arrivé après, est refusé — rejouer du périmé ferait reculer le personnage');
  dit(t.profondeur === 3, `la file contient les trois images du paquet 10 (${t.profondeur})`);
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko === 0 ? 0 : 1);
