/**
 * LES FILES VUES PAR LE JOUEUR — la présence, et les suggestions de bascule.
 *
 * Depuis qu'il n'y a plus de partie hors ligne, le lobby EST le matchmaking. Ce banc
 * éprouve les deux choses que le serveur dit aux joueurs en plus de « ta partie
 * commence » :
 *
 *   1. LA PRÉSENCE — combien attendent dans chacune des neuf files, diffusé à tous les
 *      connectés, en file ou non. Un lobby qui ne dit pas où sont les gens est un lobby
 *      qu'on croit vide.
 *
 *   2. LES SUGGESTIONS — « quelqu'un attend en 1v1 à 2 USDG, ta partie y démarrerait
 *      tout de suite ». Le scénario fondateur : A charge une arène à seize, B attend en
 *      duel, personne ne rejoint A, et A doit se voir proposer le duel — jamais l'inverse,
 *      puisque l'arène de A ne partirait pas pour autant.
 *
 * L'horloge est factice : vingt secondes d'attente coûtent zéro seconde de test.
 *
 * Usage : node files.mjs
 */

import { preparer } from '../../serveur/src/monde.js';
import { creerMatchmaking } from '../../serveur/src/matchmaking.js';
import { POLITIQUES } from '../../serveur/src/politique.js';
import { demarrerServeur } from '../../serveur/src/serveur.js';
import { MICROS, ORDRE_MODES, PALIERS } from '../../serveur/src/economie.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

const USDG = (n) => n * MICROS;
const pilote = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
const joueur = (nom) => ({ nom, faire: pilote });

/**
 * Un matchmaking sous horloge factice, qui garde tout ce qu'il envoie.
 *
 * `recus(nom)` rend les messages adressés à un joueur, `diffuses` ceux envoyés à tous.
 * On lit ce que le serveur DIT, pas ce qu'il pense : c'est la seule chose que le client
 * verra.
 */
function banc(politique, graine = 7) {
  let maintenant = 1_000_000;
  const parNom = new Map();
  const diffuses = [];
  // Un banc n'a pas de backend : les files payantes n'y existent que si l'identité est
  // facultative, comme sous DEV. La forme des files, elle, reste celle de PRODUCTION.
  const regle = typeof politique === 'string' ? { ...POLITIQUES[politique], identite: 'facultative' } : politique;
  const mm = creerMatchmaking({
    politique: regle,
    graine,
    horloge: () => maintenant,
    envoyer: (nom, m) => { if (!parNom.has(nom)) parNom.set(nom, []); parNom.get(nom).push(m); },
    diffuser: (m) => diffuses.push(m),
  });
  return {
    mm,
    diffuses,
    avancer: (s) => { maintenant += s * 1000; },
    recus: (nom, type) => (parNom.get(nom) ?? []).filter((m) => !type || m.type === type),
    dernier: (nom, type) => { const l = (parNom.get(nom) ?? []).filter((m) => m.type === type); return l[l.length - 1] ?? null; },
  };
}

const t0 = Date.now();
await preparer();

// ===========================================================================
titre('1. La présence : neuf files, toujours, même vides');
// ===========================================================================
{
  const b = banc('PRODUCTION');
  const p = b.mm.presence();
  dit(p.type === 'files' && p.files.length === ORDRE_MODES.length * PALIERS.length,
    `${p.files.length} files annoncées avant le premier joueur (attendu ${ORDRE_MODES.length * PALIERS.length})`);
  dit(p.files.every((f) => f.joueurs === 0 && f.cible > 0 && f.minimum > 0),
    'chacune dit zéro joueur, mais dit aussi sa cible et son minimum');

  const arene = p.files.find((f) => f.mode === 'arena' && f.mise === USDG(2));
  dit(arene?.cible === 16 && arene?.minimum === 13, `l'arène à 2 USDG annonce ${arene?.cible} places, minimum ${arene?.minimum}`);
  // Sous DEV, une arène GRATUITE part à deux mais une arène MISÉE exige trois : la
  // présence doit annoncer le minimum qui vaudra vraiment, avec la mise.
  const dev = banc('DEV').mm.presence().files;
  dit(dev.find((f) => f.mode === 'arena' && f.mise === USDG(2))?.minimum === 3,
    'sous DEV, l\'arène à 2 USDG annonce le minimum RELEVÉ à trois — celui qui s\'appliquera');

  b.mm.rejoindre(joueur('A'), USDG(2), 'arena');
  const apres = b.mm.presence().files.find((f) => f.mode === 'arena' && f.mise === USDG(2));
  dit(apres.joueurs === 1, 'un joueur entre : la file passe à 1');
  dit(b.diffuses.length >= 1 && b.diffuses[b.diffuses.length - 1].type === 'files',
    'et TOUS les connectés en sont prévenus aussitôt, sans attendre le battement');

  b.mm.quitter('A');
  const vide = b.mm.presence().files.find((f) => f.mode === 'arena' && f.mise === USDG(2));
  dit(vide.joueurs === 0, 'il repart : la file redescend à 0');

  // Une file hors catalogue — un banc à mise nulle — reste visible : rien de ce qui
  // existe n'est caché.
  b.mm.rejoindre(joueur('Z'), 0, 'duel');
  dit(b.mm.presence().files.some((f) => f.mode === 'duel' && f.mise === 0 && f.joueurs === 1),
    'une file ouverte hors catalogue (mise nulle) apparaît quand même');
  b.mm.arreter();
}

// ===========================================================================
titre('2. Le scénario fondateur : seul dans l\'arène, quelqu\'un attend en duel');
// ===========================================================================
{
  const b = banc('PRODUCTION');
  const delai = POLITIQUES.PRODUCTION.suggererApres;

  b.mm.rejoindre(joueur('A'), USDG(2), 'arena');
  b.avancer(5);
  b.mm.rejoindre(joueur('B'), USDG(2), 'duel');
  b.mm.battre();
  dit(b.recus('A', 'suggestion').length === 0 && b.recus('B', 'suggestion').length === 0,
    `avant ${delai} s d'attente, personne ne se voit rien suggérer`);

  b.avancer(delai);
  b.mm.battre();
  const sA = b.dernier('A', 'suggestion');
  dit(sA?.mode === 'duel' && sA?.mise === USDG(2),
    `à ${delai} s, A (seul en arène) se voit proposer le duel à 2 USDG où B attend`);
  dit(sA?.demarre === true && sA?.joueurs === 1 && sA?.cible === 2,
    'la suggestion dit que sa partie DÉMARRERAIT : 1 joueur présent, 2 places');
  dit(typeof sA?.depuis === 'number' && sA.depuis >= delai,
    `elle dit depuis combien de temps A attend (${sA?.depuis} s)`);
  // Plus de barème par salon depuis que la roue tire à la FIN (2 septembre 2026) : une
  // suggestion ne porte plus de variante, seulement le mode et la mise — et rien d'autre.
  dit(sA?.variante === undefined, 'et aucune variante : le barème n\'est plus tiré au salon');
  dit(b.recus('B', 'suggestion').length === 0,
    'B ne se voit PAS proposer l\'arène : à deux, elle ne partirait toujours pas');

  // Deux battements sans changement : on ne répète pas.
  const n = b.recus('A', 'suggestion').length;
  b.mm.battre(); b.mm.battre();
  dit(b.recus('A', 'suggestion').length === n, 'la même suggestion n\'est envoyée qu\'une fois');

  // B s'en va : l'invitation est RETIRÉE, sinon A cliquerait vers un salon vide.
  b.mm.quitter('B');
  b.mm.battre();
  const retrait = b.dernier('A', 'suggestion');
  dit(retrait?.aucune === true, 'B quitte : A est prévenu que la suggestion n\'existe plus');
  b.mm.arreter();
}

// ===========================================================================
titre('3. Jamais une mise plus haute');
// ===========================================================================
{
  const b = banc('PRODUCTION');
  b.mm.rejoindre(joueur('pauvre'), USDG(2), 'duel');
  b.mm.rejoindre(joueur('riche'), USDG(5), 'duel');
  b.avancer(POLITIQUES.PRODUCTION.suggererApres + 1);
  b.mm.battre();
  const sPauvre = b.dernier('pauvre', 'suggestion');
  const sRiche = b.dernier('riche', 'suggestion');
  dit(!sPauvre, 'celui qui mise 2 ne se voit pas proposer la table à 5');
  dit(sRiche?.mode === 'duel' && sRiche?.mise === USDG(2) && sRiche?.demarre,
    'celui qui mise 5 se voit proposer la table à 2, où sa partie démarrerait');
  b.mm.arreter();
}

// ===========================================================================
titre('4. Personne ne se croise');
// ===========================================================================
/*
 * Sous DEV et SANS MISE, le minimum vaut deux partout : A seul en squad et B seul en arène
 * pourraient chacun rendre l'autre salon PROPOSABLE. Sans garde, chacun recevrait
 * l'invitation de l'autre, et deux clics plus tard chacun attendrait seul dans la file de
 * l'autre. (Avec une mise, `formatDe` relève le minimum à trois et le cas n'existe plus —
 * c'est pourquoi ces deux sections jouent gratuitement : elles éprouvent la topologie,
 * pas l'argent.)
 */
{
  const b = banc('DEV');
  b.mm.rejoindre(joueur('A'), 0, 'squad');
  b.avancer(2);
  b.mm.rejoindre(joueur('B'), 0, 'arena');
  b.avancer(POLITIQUES.DEV.suggererApres + 1);
  b.mm.battre();

  const sA = b.dernier('A', 'suggestion');
  const sB = b.dernier('B', 'suggestion');
  const suggeres = [sA, sB].filter((s) => s && !s.aucune).length;
  dit(suggeres === 1, `deux joueurs seuls, deux salons proposables : UNE seule suggestion (${suggeres})`);
  dit(sB?.mode === 'squad' && !sA,
    'c\'est le plus récent (B) qui est invité vers le plus ancien (le squad de A), pas l\'inverse');
  dit(sB?.demarre === false, 'et elle dit honnêtement que la partie ne démarrerait pas, seulement qu\'un départ réduit deviendrait possible');
  b.mm.arreter();
}

// ===========================================================================
titre('5. On ne dérange pas quelqu\'un dont la partie va partir');
// ===========================================================================
{
  const b = banc('DEV');
  // C attend en duel depuis plus longtemps que le squad n'existe : sa suggestion est
  // mûre, alors que le squad, lui, n'a pas encore son temps de calme.
  b.mm.rejoindre(joueur('C'), 0, 'duel');
  b.avancer(POLITIQUES.DEV.suggererApres - 1);
  b.mm.rejoindre(joueur('A'), 0, 'squad');
  b.mm.rejoindre(joueur('B'), 0, 'squad');
  b.avancer(2);
  // A et B sont deux dans un squad : le duel de C démarrerait si l'un d'eux venait — mais
  // leur salon est plus rempli ; c'est C qui doit venir, pas eux.
  b.mm.battre();
  dit(!b.dernier('A', 'suggestion') && !b.dernier('B', 'suggestion'),
    'les deux du squad ne se voient rien proposer : on ne vide pas un salon vers un moins rempli');
  const sC = b.dernier('C', 'suggestion');
  dit(sC?.mode === 'squad' && sC?.joueurs === 2,
    'C, seul en duel, se voit proposer le squad où deux joueurs attendent déjà');

  // Le squad, à deux depuis assez longtemps sans nouvelle arrivée, est PRÊT : plus rien ne
  // doit y être suggéré.
  b.avancer(POLITIQUES.DEV.modes.squad.calme + 1);
  dit(b.mm.salonDe('A')?.pretAPartir() === true, 'le squad, calme depuis assez longtemps, est prêt à partir');
  b.mm.battre();   // il part
  dit(b.mm.instanceDe('A') !== null, 'et il est parti');
  const apres = b.dernier('C', 'suggestion');
  dit(apres?.aucune === true, 'C est prévenu que le squad n\'attend plus personne');
  b.mm.arreter();
}

// ===========================================================================
titre('6. Basculer : un seul geste, et la partie démarre');
// ===========================================================================
{
  const b = banc('PRODUCTION');
  b.mm.rejoindre(joueur('A'), USDG(2), 'arena');
  b.mm.rejoindre(joueur('B'), USDG(2), 'duel');
  b.avancer(POLITIQUES.PRODUCTION.suggererApres + 1);
  b.mm.battre();
  const s = b.dernier('A', 'suggestion');
  dit(s?.mode === 'duel', 'A a reçu la suggestion');

  const r = b.mm.basculer('A', s.mise, s.mode);
  dit(r.accepte === true && r.place === 2 && r.sur === 2, `A bascule et prend la place ${r.place}/${r.sur} du duel`);
  dit(b.mm.salonDe('A') === b.mm.salonDe('B'), 'A et B sont dans le MÊME salon');
  dit(b.mm.presence().files.find((f) => f.mode === 'arena' && f.mise === USDG(2)).joueurs === 0,
    'l\'arène qu\'il a quittée est vide');

  const partis = b.mm.battre();
  dit(partis.length === 1 && b.mm.instanceDe('A') && b.mm.instanceDe('A') === b.mm.instanceDe('B'),
    'au battement suivant, le duel part avec les deux');
  dit(b.recus('A', 'manche').length >= 1 && b.recus('B', 'manche').length >= 1,
    'et les deux reçoivent l\'annonce de manche');

  // Les refus sont nommés.
  const hors = b.mm.basculer('personne', USDG(2), 'duel');
  dit(hors.accepte === false && hors.raison === 'PAS_EN_SALON', `basculer sans être en salon : ${hors.raison}`);
  b.mm.rejoindre(joueur('C'), USDG(2), 'arena');
  const inconnu = b.mm.basculer('C', USDG(2), 'jackpot');
  dit(inconnu.accepte === false && inconnu.raison === 'MODE_INCONNU', `basculer vers un mode inventé : ${inconnu.raison}`);
  dit(b.mm.salonDe('C') !== null,
    'et C est resté dans sa file : un refus ne déplace personne');
  b.mm.arreter();
}

// ===========================================================================
titre('7. Sur le fil : un vrai serveur, de vraies sockets');
// ===========================================================================
{
  const serveur = await demarrerServeur({
    port: 0,
    politique: { ...POLITIQUES.DEV, nom: 'DEV_FILES', suggererApres: 1, attente: 60, proposerApres: 60 },
    graine: 99,
  });
  const url = `ws://127.0.0.1:${serveur.port}`;

  const client = (nom) => new Promise((resoudre) => {
    const ws = new WebSocket(url);
    const messages = [];
    ws.onmessage = (e) => { if (typeof e.data === 'string') messages.push(JSON.parse(e.data)); };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'bonjour', nom }));
      resoudre({
        ws, messages,
        attendre: async (pred, ms = 8000) => {
          const debut = Date.now();
          while (Date.now() - debut < ms) {
            const m = messages.find(pred);
            if (m) return m;
            await patienter(25);
          }
          return null;
        },
        envoyer: (o) => ws.send(JSON.stringify(o)),
      });
    };
  });

  const a = await client('A');
  const bienvenue = await a.attendre((m) => m.type === 'bienvenue');
  dit(bienvenue?.joueurs === 1, `« bienvenue » dit combien sont connectés (${bienvenue?.joueurs})`);
  const files = await a.attendre((m) => m.type === 'files');
  dit(files?.files?.length === 9, 'la présence arrive dès la connexion, avant tout choix');

  a.envoyer({ type: 'rejoindre', mise: USDG(2), mode: 'arena', modele: 'char-babytrump' });
  const b2 = await client('B');
  const vue = await b2.attendre((m) => m.type === 'files' && m.files.some((f) => f.mode === 'arena' && f.joueurs === 1));
  dit(Boolean(vue), 'B, qui n\'a rien choisi, voit déjà A attendre dans l\'arène');

  b2.envoyer({ type: 'rejoindre', mise: USDG(2), mode: 'duel', modele: 'char-techtitan' });
  const sugg = await a.attendre((m) => m.type === 'suggestion' && !m.aucune, 6000);
  dit(sugg?.mode === 'duel' && sugg?.demarre === true, 'A reçoit la suggestion du duel sur le fil');

  a.envoyer({ type: 'basculer', mise: sugg.mise, mode: sugg.mode });
  const mancheA = await a.attendre((m) => m.type === 'manche', 8000);
  const mancheB = await b2.attendre((m) => m.type === 'manche', 8000);
  dit(Boolean(mancheA) && Boolean(mancheB), 'A bascule : les deux reçoivent l\'annonce de manche');
  dit(mancheA?.joueurs?.length === 2, `la manche compte ${mancheA?.joueurs?.length} joueurs`);
  // Le personnage choisi a survécu à la bascule : il est parti avec `rejoindre` et le
  // serveur l'a gardé avec l'identité, pas avec le salon.
  const moi = mancheB?.joueurs?.find((j) => j.nom === 'A');
  dit(moi?.modele === 'char-babytrump', `B voit A avec le personnage qu'A avait choisi (${moi?.modele})`);

  a.ws.close(); b2.ws.close();
  await serveur.arreter();
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko ? 1 : 0);
