/**
 * LE NETCODE SOUS UN RÉSEAU QUI GIGOTE — la connexion du directeur produit, en boîte.
 *
 * Le 4 septembre 2026, depuis les Canaries vers le serveur de Paris, une vidéo montrait
 * le personnage téléporté d'un bout à l'autre de la carte, « 153 resyncs » au compteur,
 * et une latence affichée entre 138 et 445 ms. Ce banc rejoue ce réseau-là sans quitter
 * le processus : un aller simple de 120 ms, et toutes les deux secondes une COUPURE de
 * 300 ms pendant laquelle rien ne passe — puis tout arrive d'un coup, comme après une
 * perte TCP. Il mesure ensuite exactement ce que `client.mjs` mesure sur un réseau
 * parfait : l'erreur de prédiction au même pas, et le nombre de recalages secs.
 *
 * Ce qu'on attend n'est pas « moins pire » : c'est la MÊME barre que sans latence. Un
 * réseau lent doit coûter de la latence, jamais des téléportations.
 *
 * La gigue est posée sur `WebSocket` lui-même, pour le CLIENT seulement : le serveur, lui,
 * ne sait pas qu'on le fait attendre — c'est le point.
 */

import { poserDoublures } from '../../serveur/src/navigateur-absent.js';

poserDoublures();

const { demarrerServeur } = await import('../../serveur/src/serveur.js');
const { preparer, construire, creerPerso, liberer } = await import('../../serveur/src/monde.js');
const { avancerTick } = await import('../../serveur/src/tick.js');
const { CIBLE_MIN } = await import('../../serveur/src/tampon.js');
const { creerSession } = await import('../../tools/feel-lab/src/enligne/session.js');
const { SEUIL_RECALAGE } = await import('../../tools/feel-lab/src/enligne/reconciliation.js');

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Le réseau ───────────────────────────────────────────────────────────────

/** Un aller simple, en ms. Deux cent quarante d'aller-retour : les Canaries vers Paris, un mauvais jour. */
const ALLER = 120;
/** Toutes les `PERIODE` ms, rien ne passe pendant `COUPURE` ms. */
const PERIODE = 2000;
const COUPURE = 300;

const WebSocketVrai = globalThis.WebSocket;
const t0 = performance.now();

/**
 * Quand un message parti à `depuis` arrive de l'autre côté. Parti pendant une coupure, il
 * attend la fin de la coupure — et tout ce qui est parti pendant arrive alors d'un coup,
 * dans l'ordre : `dernier` garantit qu'on ne double jamais un message plus ancien.
 */
function arrivee(depuis, etat) {
  const phase = (depuis - t0) % PERIODE;
  let t = depuis + ALLER;
  if (phase < COUPURE) t = Math.max(t, depuis - phase + COUPURE + ALLER);
  t = Math.max(t, etat.dernier);
  etat.dernier = t;
  return t;
}

/**
 * Un FIL : livre dans l'ordre, jamais autrement.
 *
 * Une minuterie par message ne suffit pas : Node range ses minuteries par DURÉE, et deux
 * durées différentes dont l'échéance tombe dans la même milliseconde partent dans un
 * ordre qui n'est pas celui des échéances. Un `rejoindre` doublait alors son `bonjour`
 * une fois sur trois — et le serveur, qui ne connaissait pas encore le joueur, le
 * jetait. Un vrai fil TCP ne fait jamais ça ; le simulateur ne doit pas le faire non plus.
 */
function creerFil() {
  const etat = { dernier: 0 };
  const file = [];
  let minuterie = null;
  const pomper = () => {
    minuterie = null;
    const maintenant = performance.now();
    while (file.length && file[0].t <= maintenant + 0.5) file.shift().fn();
    if (file.length) minuterie = setTimeout(pomper, Math.max(1, file[0].t - performance.now()));
  };
  return {
    livrer(fn) {
      const t = arrivee(performance.now(), etat);
      file.push({ t, fn });
      if (!minuterie) minuterie = setTimeout(pomper, Math.max(1, t - performance.now()));
      return t;
    },
  };
}

class WebSocketGigue extends WebSocketVrai {
  #montant = creerFil();
  #descendant = creerFil();

  send(donnees) {
    const t = this.#montant.livrer(() => { try { super.send(donnees); } catch (e) { if (process.env.GIGUE_DEBUG) console.log('send KO', e.message); } });
    if (process.env.GIGUE_DEBUG && typeof donnees === 'string') console.log('envoi', donnees.slice(0, 60), 'dans', Math.round(t - performance.now()), 'ms');
  }

  set onmessage(fn) {
    super.onmessage = (e) => {
      const t = this.#descendant.livrer(() => fn(e));
      if (process.env.GIGUE_DEBUG) console.log('recu', typeof e.data === 'string' ? e.data.slice(0, 220) : 'bin', 'dans', Math.round(t - performance.now()), 'ms');
    };
  }

  get onmessage() { return super.onmessage; }
}

globalThis.WebSocket = WebSocketGigue;

// ─── Le client sans navigateur — celui de `client.mjs`, au pas près ───────────

function creerJoueur(url, nom, strategie) {
  const session = creerSession({ url, nom });
  const j = {
    nom, session, monde: null, perso: null, minuteur: null,
    erreurs: [], effets: { ignore: 0, absorbe: 0, recale: 0 }, latences: [],
  };

  session.sur('manche', (msg) => {
    if (j.monde) { j.perso = null; liberer(j.monde); j.monde = null; }
    const moi = msg.joueurs.find((p) => p.nom === nom);
    if (!moi) return;
    j.monde = construire(msg.epreuve, msg.graine);
    j.perso = creerPerso(j.monde, moi.index, msg.joueurs.length);
    session.attacher({ personnage: j.perso, scene: null, assets: null });
  });

  session.sur('correction', ({ effet, moi, reference, accuse }) => {
    j.effets[effet]++;
    if (!j.perso || !reference) return;
    const e = Math.hypot(moi.x - reference.x, moi.y - reference.y, moi.z - reference.z);
    j.erreurs.push(e);
    if (process.env.GIGUE_DEBUG && nom === 'canaries') {
      const p = j.perso.body.translation();
      const v = j.perso.body.linvel();
      const h = session.lien.enAttente;
      console.log(`corr ${((performance.now() - t0) / 1000).toFixed(2)}s acc=${accuse} ${effet} err=${e.toFixed(2)} serveur=(${moi.x.toFixed(1)},${moi.y.toFixed(1)},${moi.z.toFixed(1)}) ref=(${reference.x.toFixed(1)},${reference.y.toFixed(1)},${reference.z.toFixed(1)}) ici=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) vz=${v.z.toFixed(1)} attente=${h.length} seqs=${h[0]?.seq}..${h[h.length - 1]?.seq} notes=${h.slice(0, 4).map((x) => x.pos ? x.pos.z.toFixed(2) : 'null').join('/')} dernieres=${h.slice(-3).map((x) => x.pos ? x.pos.z.toFixed(2) : 'null').join('/')}`);
    }
  });

  j.jouer = () => {
    let reste = 0;
    let precedent = Date.now();
    j.minuteur = setInterval(() => {
      if (!j.perso || !j.monde) return;
      const maintenant = Date.now();
      reste += (maintenant - precedent) / 1000;
      precedent = maintenant;
      // Pendant le décompte on ne pilote pas — comme le vrai client, qui met l'entrée à
      // zéro tant que le compte n'est pas écoulé. Le serveur, lui, ne consomme rien.
      const entree = session.enDecompte ? { x: 0, z: 0, jump: false, dive: false } : strategie(j);
      let pas = 0;
      while (reste >= 1 / 30 && pas < 3) {
        reste -= 1 / 30;
        pas++;
        const seqs = [session.envoyer(entree), session.envoyer(entree)];
        // L'horloge du décor est celle du SERVEUR (`tempsMonde`), comme dans le vrai
        // client : à zéro, une plate-forme qui bouge n'est pas là où le serveur la voit,
        // et le personnage tombe à travers un sol que l'autre côté tient pour solide.
        avancerTick(j.monde, [{ perso: j.perso, entrees: [{ ...entree }, { ...entree }] }],
          session.tempsMonde, 1 / 30, true, { apresSousPas: (s) => session.noterPas(seqs[s]) });
      }
      session.avancer(1 / 60);
      const l = session.mesurerLatence(60);
      if (l !== null) j.latences.push(l);
    }, 1000 / 60);
  };

  j.arreter = () => {
    clearInterval(j.minuteur);
    session.fermer();
    if (j.monde) { liberer(j.monde); j.monde = null; }
  };
  return j;
}

async function jusqua(condition, ms = 20000, quoi = 'condition') {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > ms) throw new Error(`${quoi} jamais atteinte`);
    await patienter(25);
  }
}

const mediane = (t) => { const s = [...t].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const centile = (t, p) => { const s = [...t].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };

await preparer();
const debutBanc = Date.now();

// ===========================================================================
titre(`1. Un aller-retour de ${2 * ALLER} ms, une coupure de ${COUPURE} ms toutes les ${PERIODE / 1000} s`);
// ===========================================================================
{
  /*
   * SUR LA COURSE, pas sur Les Portes. Ce banc mesure le RÉSEAU ; une carte de portes
   * cassables, où l'autre joueur nous bouscule et où une porte cède d'un côté avant
   * l'autre, mesurerait la physique des contacts. La graine du serveur décide de la
   * carte : on essaie des graines jusqu'à tomber sur la course.
   */
  let s = null; let a = null; let b = null;
  for (const graine of [20260907, 20260911, 20260915, 20260918, 20260922, 20260934, 20260909]) {
    s = await demarrerServeur({ port: 0, politique: 'DUEL_TEST', graine });
    const url = `ws://127.0.0.1:${s.port}`;
    a = creerJoueur(url, 'canaries', () => ({ x: 0, z: -1, jump: false, dive: false }));
    // L'autre s'écarte : une bousculade est arbitrée par le serveur, et arrive avec
    // l'aller-retour de retard — un vrai désaccord, mais pas celui qu'on mesure ici.
    let pas = 0;
    b = creerJoueur(url, 'paris', (j) => {
      pas++;
      return { x: 0.5, z: -1, jump: j.perso.state === 'grounded' && pas % 50 === 0, dive: false };
    });
    a.session.connecter(); b.session.connecter();
    await jusqua(() => a.session.etat === 'ouvert' && b.session.etat === 'ouvert', 8000, 'connexion');
    a.session.rejoindre(0); b.session.rejoindre(0);
    await jusqua(() => a.monde && b.monde, 20000, 'manche');
    if (a.session.manche.epreuve === 'course') break;
    a.arreter(); b.arreter(); await s.arreter(); s = null;
  }
  if (!s) throw new Error('aucune graine candidate ne tire la course');
  dit(true, `les deux clients sont en manche : ${a.session.manche.epreuve}, graine ${a.session.manche.graine}`);
  a.jouer(); b.jouer();

  await patienter(a.session.manche.decompte * 1000 + 800);
  a.erreurs.length = 0; a.latences.length = 0;
  a.effets.ignore = a.effets.absorbe = a.effets.recale = 0;
  const DUREE = 8000;
  await patienter(DUREE);

  const instance = s.matchmaking.instances[0];
  const reseau = instance?.reseau?.canaries ?? null;
  const med = mediane(a.erreurs);
  const p90 = centile(a.erreurs, 0.9);
  const max = Math.max(...a.erreurs);
  const latence = mediane(a.latences);

  console.log(`     ${a.erreurs.length} comparaisons en ${DUREE / 1000} s · ${Math.floor(DUREE / PERIODE)} coupures traversées`);
  console.log(`     erreur au même pas — médiane ${(med * 100).toFixed(1)} cm · 90e centile ${(p90 * 100).toFixed(0)} cm · max ${(max * 100).toFixed(0)} cm`);
  console.log(`     effets : ${a.effets.ignore} ignorés · ${a.effets.absorbe} absorbés · ${a.effets.recale} recalages`
    + ` · latence estimée ${Math.round(latence)} ms`);
  if (reseau) {
    console.log(`     tampon du serveur : ${reseau.famines} famines · ${reseau.extrapoles} pas extrapolés`
      + ` · ${reseau.sautes} sautés · cible ${reseau.cible} images`);
  }

  dit(a.erreurs.length > 60, `le serveur a accusé ${a.erreurs.length} pas neufs : la boucle tourne malgré les coupures`);
  // LA MÊME BARRE QUE SANS LATENCE (`client.mjs` : 15 cm). Avant le tampon, l'erreur
  // médiane ici valait la vitesse fois l'aller-retour — plus de 1,5 m.
  dit(med < 0.15, `erreur médiane sous 15 cm — la latence ne se voit plus dans l'écart`);
  dit(a.effets.recale === 0, `aucun recalage sec (avant : un par instantané, « 153 resyncs » sur la vidéo)`);
  dit(max < SEUIL_RECALAGE, `même le pire écart (${(max * 100).toFixed(0)} cm) reste sous le seuil de recalage`);
  dit(latence >= 2 * ALLER, `la latence affichée dit la vérité : ${Math.round(latence)} ms pour ${2 * ALLER} ms d'aller-retour, tampon compris`);
  dit(reseau !== null && reseau.famines >= 1, `le serveur a connu ${reseau?.famines ?? '?'} famine(s) — les coupures l'ont bien atteint`);
  dit(reseau !== null && reseau.cible > CIBLE_MIN, `et sa cible est montée à ${reseau?.cible ?? '?'} images : il paie la gigue en latence, pas en erreurs`);

  a.arreter(); b.arreter();
  await s.arreter();
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - debutBanc) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
