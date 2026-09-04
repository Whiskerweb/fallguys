/**
 * LES ENTRÉES NE SE PERDENT PAS — le verdict qui manquait.
 *
 * Ce fichier existe à cause d'un défaut précis, et il vaut mieux le raconter que de le
 * résumer : le serveur ne gardait qu'une seule image d'entrée par joueur, écrasée à chaque
 * paquet. Le client en envoyant 60 par seconde et le serveur n'en consommant que 30, une
 * image sur deux partait à la poubelle.
 *
 * Pour une direction, invisible — elle est maintenue pendant des dizaines d'images. Pour
 * un saut, fatal : `jump` n'est vrai qu'une seule image. Mesuré alors : **16 sauts
 * demandés, 10 joués**. Le joueur voyait son personnage sauter, parce que le client
 * prédit ; il ne franchissait pas l'obstacle, parce que le serveur n'avait jamais sauté.
 *
 * Aucun test ne couvrait ce chemin. Les verdicts existants alimentaient la simulation en
 * direct — ils prouvaient que la physique saute, jamais que l'appui lui parvient. C'est
 * exactement l'espace où le défaut s'est logé, et c'est celui-ci qu'on ferme.
 *
 * On mesure **à travers le vrai protocole**, encodage et décodage compris : un test qui
 * appellerait `inst.entree()` avec des objets fabriqués à la main ne prouverait rien du
 * fil.
 *
 * Usage : node entrees.mjs
 */

import { preparer } from '../../serveur/src/monde.js';
import { creerInstance } from '../../serveur/src/instance.js';
import { encoderEntree, decoderEntree, encoderInstantane, decoderInstantane, REDONDANCE } from '../feel-lab/src/enligne/protocole.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const t0 = Date.now();
await preparer();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un pilote inerte : les bots ne doivent pas polluer ce qu'on mesure. */
const inerte = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });

/**
 * Joue une partie et compte les sauts, du clavier jusqu'à la simulation.
 *
 * @param {object} p
 * @param {number} p.presses     combien de sauts demander
 * @param {number} p.periode     une pression toutes les N images de client
 * @param {number} p.perte       fraction de paquets jetés en route (0 = réseau parfait)
 * @param {number} p.silence     secondes de silence à la fin, pour guetter les doublons
 */
async function mesurer({ presses = 20, periode = 20, perte = 0, silence = 0 } = {}) {
  const inst = creerInstance({
    id: 'ENTREES',
    graine: 4242,
    // Deux joueurs : à un seul, la manche n'aurait personne à éliminer.
    inscrits: [
      { nom: 'j', estBot: false, faire: inerte },
      { nom: 'k', estBot: false, faire: inerte },
    ],
    dureeMax: 120,
    envoyer: () => {},
  });
  inst.demarrer();

  /*
   * L'ESPION est posé sur `partie.avancer` : c'est le seuil exact entre le transport et la
   * simulation, donc le seul endroit où « l'appui est-il arrivé ? » a une réponse nette.
   * On sait déjà, par ailleurs, que tout appui franchissant ce seuil est joué.
   */
  const p = inst.partie;
  const originale = p.avancer.bind(p);
  let recus = 0;
  p.avancer = (carte) => {
    if (carte?.get('j')?.jump) recus++;
    return originale(carte);
  };

  // On laisse passer le décompte : avant lui, les entrées ne sont pas consommées.
  await dormir(3600);
  if (!inst.partie.manche || inst.partie.manche.phase !== 'en-jeu') {
    inst.arreter();
    throw new Error('la manche n\'a pas démarré — mesure invalide');
  }

  let hautMax = -Infinity;
  const bas = inst.partie.manche.etatCoureurs().find((c) => c.nom === 'j')?.y ?? 0;

  let seq = 0;
  let envoyes = 0;
  let demandes = 0;
  let traine = 0;
  const recent = [];

  await new Promise((fini) => {
    const battement = setInterval(() => {
      const c = inst.partie.manche?.etatCoureurs().find((x) => x.nom === 'j');
      if (c) hautMax = Math.max(hautMax, c.y);

      /*
       * LA TRAÎNE. Après la dernière pression on continue d'envoyer des images vides
       * pendant un instant, comme le ferait un vrai client — qui ne se tait jamais.
       *
       * Sans elle, le harnais coupait le fil sur la pression même : si c'était ce
       * paquet-là que la perte simulée emportait, la redondance n'avait plus une seule
       * occasion de le rattraper, et le test accusait le jeu de sa propre impatience.
       */
      if (demandes >= presses && ++traine > REDONDANCE * 2) {
        // Puis silence complet : le serveur ne doit RIEN rejouer pendant ce temps.
        if (++envoyes > silence * 60) { clearInterval(battement); fini(); }
        return;
      }

      seq++;
      const saute = demandes < presses && seq % periode === 0;
      if (saute) demandes++;
      recent.push({ x: 0, z: 0, jump: saute, dive: false });
      while (recent.length > REDONDANCE) recent.shift();

      // Le vrai fil : on encode, on jette peut-être le paquet, on décode.
      const paquet = encoderEntree(seq, recent);
      if (perte > 0 && seq % Math.round(1 / perte) === 0) return;
      inst.entree('j', decoderEntree(new Uint8Array(paquet)));
    }, 1000 / 60);
  });

  inst.arreter();
  return { demandes, recus, montee: hautMax - bas };
}

// ===========================================================================
titre('1. Un réseau parfait : aucun appui perdu');
// ===========================================================================
{
  const r = await mesurer({ presses: 20, periode: 20 });
  console.log(`     ${r.demandes} demandés · ${r.recus} arrivés · le personnage est monté de ${r.montee.toFixed(2)} m`);
  dit(r.recus === r.demandes,
    `les ${r.demandes} sauts atteignent la simulation (avant correctif : 10 sur 16)`);
  // Sans cette seconde assertion, un espion qui compterait juste passerait alors que le
  // personnage reste collé au sol. On veut le saut, pas le message.
  dit(r.montee > 1.0, `et ils sont bien JOUÉS — ${r.montee.toFixed(2)} m de montée`);
}

// ===========================================================================
titre('2. Un paquet sur trois jeté : la redondance fait son travail');
// ===========================================================================
{
  const r = await mesurer({ presses: 15, periode: 20, perte: 1 / 3 });
  console.log(`     ${r.demandes} demandés · ${r.recus} arrivés malgré un paquet sur trois perdu`);
  dit(r.recus === r.demandes,
    'chaque paquet porte les trois dernières images, et le serveur les lit toutes');
}

// ===========================================================================
titre('3. Aucun appui rejoué');
// ===========================================================================
{
  // Une seconde de silence complet après le dernier appui : si le serveur gardait son
  // accumulateur, le personnage sauterait encore soixante fois tout seul.
  const r = await mesurer({ presses: 10, periode: 20, silence: 1 });
  console.log(`     ${r.demandes} demandés · ${r.recus} joués, silence d'une seconde compris`);
  dit(r.recus === r.demandes, 'un appui consommé est effacé : autant de sauts que de pressions, jamais plus');
}

// ===========================================================================
titre('4. Une partie à un seul joueur se clôt aussitôt');
// ===========================================================================
{
  /*
   * Ce verdict est ici parce que ce comportement m'a fait accuser le jeu à tort.
   *
   * Ma première mesure du saut tournait à un seul joueur : elle a compté zéro saut sur
   * dix-neuf, et j'y ai lu une perte totale. En réalité la partie s'était terminée avant
   * la première image — une partie s'arrête quand il ne reste qu'un survivant, et à un
   * seul inscrit c'est vrai dès le départ.
   *
   * C'est correct, et ça reste piégeux. Autant l'écrire noir sur blanc : le prochain
   * harnais qui part d'un joueur unique saura pourquoi il ne mesure rien.
   */
  const inst = creerInstance({
    id: 'SEUL', graine: 7, dureeMax: 60, envoyer: () => {},
    inscrits: [{ nom: 'seul', estBot: false, faire: inerte }],
  });
  inst.demarrer();
  await dormir(300);
  const fini = inst.arretee;
  const classement = inst.partie.resultat?.classement ?? [];
  inst.arreter();
  dit(fini && classement[0]?.nom === 'seul' && classement[0]?.rang === 1,
    'aucune manche n\'est jouée, et le survivant est premier — pas un défaut, un piège de mesure');
}

// ===========================================================================
titre('5. Le plongeon voyage — l\'appui ET la bascule du corps');
// ===========================================================================
{
  /*
   * Un plongeon n'est pas un déplacement, c'est une ROTATION. Le joueur qui plonge passe en
   * ragdoll et son corps bascule ; le squelette, lui, ne fait qu'écarter les membres.
   *
   * L'instantané ne portait que la position : un adversaire qui plongeait glissait donc
   * vers l'avant, bien droit. « On voit les sauts, on ne voit pas les plongeons. » On
   * vérifie ici les deux moitiés — que l'appui arrive, et que la bascule tient sur le fil.
   */
  const inst = creerInstance({
    id: 'PLONGEON', graine: 4242, dureeMax: 120, envoyer: () => {},
    inscrits: [
      { nom: 'j', estBot: false, faire: inerte },
      { nom: 'k', estBot: false, faire: inerte },
    ],
  });
  inst.demarrer();

  const p = inst.partie;
  const originale = p.avancer.bind(p);
  let recus = 0;
  p.avancer = (carte) => { if (carte?.get('j')?.dive) recus++; return originale(carte); };

  await dormir(3600);

  let enPlongeon = 0;
  let basculeMax = 0;
  const guet = setInterval(() => {
    const c = inst.partie.manche?.etatCoureurs().find((x) => x.nom === 'j');
    if (!c) return;
    // On regarde ce que le FIL transporte, pas ce que le serveur détient : c'est la seule
    // chose que l'autre joueur recevra.
    const vu = decoderInstantane(new Uint8Array(encoderInstantane(0, [c], 0))).joueurs[0];
    if (vu.pose !== 'diving') return;
    enPlongeon++;
    // `qw` vaut 1 pour un corps debout. Plus il s'en éloigne, plus le corps a basculé.
    basculeMax = Math.max(basculeMax, 1 - Math.abs(vu.qw));
  }, 8);

  let seq = 0;
  let demandes = 0;
  const recent = [];
  const env = setInterval(() => {
    seq++;
    const plonge = seq % 30 === 0;
    if (plonge) demandes++;
    recent.push({ x: 0, z: -1, jump: false, dive: plonge });
    while (recent.length > REDONDANCE) recent.shift();
    inst.entree('j', decoderEntree(new Uint8Array(encoderEntree(seq, recent))));
  }, 1000 / 60);

  await dormir(10000);
  clearInterval(env);
  // Le tampon du serveur garde quelques images d'avance (`tampon.js`) : on laisse le
  // dernier plongeon en sortir avant de compter, sinon on le compterait comme perdu.
  await dormir(250);
  clearInterval(guet); inst.arreter();

  console.log(`     ${demandes} plongeons demandés · ${recus} arrivés · ${enPlongeon} relevés en pose « diving »`);
  console.log(`     bascule du corps transportée : ${(basculeMax * 100).toFixed(0)} % d'écart à la verticale`);
  dit(recus === demandes, `les ${demandes} plongeons atteignent la simulation`);
  dit(enPlongeon > 0, 'la pose « diving » traverse l\'encodage sans se perdre');
  // Sans l'orientation sur le fil, `qw` restait à 1 et ce verdict tombait : le corps
  // n'avait aucune raison de basculer chez celui qui regarde.
  dit(basculeMax > 0.05, `le corps bascule VRAIMENT sur le fil — sans quoi le plongeon est invisible`);
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
