/**
 * UN SERVEUR, N CLIENTS, DE VRAIES WEBSOCKETS.
 *
 * C'est ce que le nom de ce dossier promettait depuis le début, et ce que la spec range en
 * « priorité n°1 » (§ 6.6) : *personne ne peut tester un lobby de seize à la main*.
 *
 * Les clients sont headless — ils ne rendent rien, ne prédisent rien, et se contentent
 * d'envoyer des entrées et de compter ce qui revient. C'est suffisant pour éprouver ce
 * qu'on veut éprouver ici : que le serveur tient sa cadence, que les instantanés arrivent,
 * que plusieurs parties tournent en parallèle, et qu'une déconnexion ne fige personne.
 * La prédiction, elle, se juge dans un navigateur.
 *
 * Usage : node reseau.mjs
 */

import { demarrerServeur } from '../../serveur/src/serveur.js';
import { encoderEntree, decoderInstantane, typeDe, TYPE } from '../../serveur/src/reseau.js';
import { POLITIQUES } from '../../serveur/src/politique.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un client headless.
 *
 * Il envoie des entrées à 60 Hz — la cadence réelle d'un navigateur — et note tout ce
 * qu'il reçoit. Sa « stratégie » est de courir droit devant : on ne cherche pas à gagner,
 * on cherche à produire du trafic représentatif.
 */
function creerClient(url, nom) {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const c = {
    nom,
    ws,
    messages: [],                 // les messages JSON reçus, dans l'ordre
    instantanes: 0,
    octetsRecus: 0,
    octetsEnvoyes: 0,
    premierInstantane: null,
    dernierInstantane: null,
    accuseMax: 0,
    seq: 0,
    frames: [],
    minuteur: null,

    /** Attend un message d'un type donné. */
    attendre(type, ms = 15000) {
      return new Promise((resoudre, rejeter) => {
        const deja = c.messages.find((m) => m.type === type);
        if (deja) return resoudre(deja);
        const debut = Date.now();
        const sonde = setInterval(() => {
          const m = c.messages.find((x) => x.type === type);
          if (m) { clearInterval(sonde); resoudre(m); }
          else if (Date.now() - debut > ms) { clearInterval(sonde); rejeter(new Error(`« ${type} » jamais reçu par ${nom}`)); }
        }, 20);
      });
    },

    envoyerJson(o) {
      const s = JSON.stringify(o);
      c.octetsEnvoyes += s.length;
      ws.send(s);
    },

    /** Commence à envoyer des entrées à 60 Hz, comme un vrai client. */
    jouer() {
      if (c.minuteur) return;
      c.minuteur = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        c.seq++;
        // Courir droit devant, et sauter de temps en temps. On produit du trafic, pas une
        // performance sportive.
        c.frames.push({ x: 0, z: -1, jump: c.seq % 45 === 0, dive: false });
        if (c.frames.length > 3) c.frames.shift();
        const paquet = encoderEntree(c.seq, c.frames);
        c.octetsEnvoyes += paquet.byteLength;
        ws.send(paquet);
      }, 1000 / 60);
    },

    arreterDeJouer() { clearInterval(c.minuteur); c.minuteur = null; },
    fermer() { c.arreterDeJouer(); try { ws.close(); } catch {} },
  };

  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      c.octetsRecus += e.data.length;
      try { c.messages.push(JSON.parse(e.data)); } catch {}
      return;
    }
    const vue = new Uint8Array(e.data);
    c.octetsRecus += vue.byteLength;
    if (typeDe(vue) === TYPE.INSTANTANE) {
      c.instantanes++;
      c.dernierInstantane = decoderInstantane(vue);
      c.premierInstantane ??= c.dernierInstantane;
      c.accuseMax = Math.max(c.accuseMax, c.dernierInstantane.accuse);
    }
  };

  return new Promise((resoudre, rejeter) => {
    ws.onopen = () => { c.envoyerJson({ type: 'bonjour', nom }); resoudre(c); };
    ws.onerror = () => rejeter(new Error(`connexion refusée pour ${nom}`));
  });
}

const t0 = Date.now();

// ===========================================================================
titre('1. Un duel : deux machines, deux comptes, aucun bot');
// ===========================================================================
{
  const s = await demarrerServeur({ port: 0, politique: 'DUEL_TEST', graine: 4242 });
  const url = `ws://127.0.0.1:${s.port}`;

  const a = await creerClient(url, 'machine-1');
  const b = await creerClient(url, 'machine-2');
  await a.attendre('bienvenue');
  await b.attendre('bienvenue');
  dit(true, 'les deux clients sont connectés');

  a.envoyerJson({ type: 'rejoindre', mise: 0 });
  await patienter(60);
  const salonA = await a.attendre('salon');
  dit(salonA.humains === 1 && salonA.cible === 2, `salon : ${salonA.humains}/${salonA.cible}`);

  b.envoyerJson({ type: 'rejoindre', mise: 0 });

  // Le salon est plein : il doit partir au battement suivant, sans attendre le décompte.
  const mancheA = await a.attendre('manche');
  const mancheB = await b.attendre('manche');
  dit(mancheA.epreuve === mancheB.epreuve && mancheA.graine === mancheB.graine,
    `les deux clients reçoivent la MÊME manche : ${mancheA.epreuve}, graine ${mancheA.graine}`);
  dit(mancheA.sur === 1, `un duel se joue en ${mancheA.sur} manche — une finale`);
  dit(mancheA.joueurs.length === 2, 'la correspondance index → nom porte deux joueurs');

  a.jouer(); b.jouer();

  /*
   * ON ATTEND LA FIN DU DÉCOMPTE AVANT DE MESURER.
   *
   * Pendant les trois secondes de décompte, la physique tourne mais les entrées ne sont
   * pas lues — c'est le comportement du jeu, pas un défaut. Mesurer dedans donnait « 0 m
   * parcouru » et « 11,6 Hz », deux chiffres justes qui ne mesuraient pas ce que je
   * croyais mesurer.
   */
  await patienter(mancheA.decompte * 1000 + 400);
  const instantanesAuDepart = a.instantanes;
  const octetsAuDepart = a.octetsRecus;
  const envoyesAuDepart = a.octetsEnvoyes;
  const posDepart = a.dernierInstantane.joueurs.find((j) => j.index === 0);

  await patienter(3000);

  const recus = a.instantanes - instantanesAuDepart;
  dit(recus > 50 && recus < 70, `${recus} instantanés en 3 s de jeu (attendu ~60 à 20 Hz)`);
  dit(a.accuseMax > 0, `le serveur accuse réception des entrées (dernière : ${a.accuseMax})`);

  const debit = ((a.octetsRecus - octetsAuDepart) / 1024 / 3).toFixed(1);
  console.log(`     débit descendant : ${debit} Ko/s · montant : `
    + `${((a.octetsEnvoyes - envoyesAuDepart) / 1024 / 3).toFixed(1)} Ko/s`);

  // Les deux clients voient les deux personnages, et ils bougent.
  const vus = a.dernierInstantane?.joueurs ?? [];
  dit(vus.length === 2, 'chaque client voit les deux personnages');

  // Ont-ils bougé ? On compare la position À LA FIN DU DÉCOMPTE à la dernière. Une position
  // immobile signifierait que le serveur simule mais n'applique pas les entrées reçues —
  // le genre de panne qu'un compteur d'instantanés ne verrait pas.
  const arrivee = vus.find((j) => j.index === 0);
  const parcouru = Math.hypot(arrivee.x - posDepart.x, arrivee.z - posDepart.z);
  dit(parcouru > 3, `le personnage a parcouru ${parcouru.toFixed(1)} m : le serveur applique bien les entrées`);

  a.fermer(); b.fermer();
  await s.arreter();
}

// ===========================================================================
titre('2. Cent joueurs → plusieurs parties EN PARALLÈLE');
// ===========================================================================
/*
 * Le cas que tout jeu en ligne traite, et qu'il faut vérifier plutôt que supposer : cent
 * joueurs ne font pas un salon de cent ni une file d'attente de quatre-vingt-quatre. Dès
 * qu'un salon se remplit, il part, et un salon neuf le remplace.
 */
{
  // Une politique de test : salons de 4, aucun bot, pour obtenir plusieurs parties vite.
  const petite = { ...POLITIQUES.PRODUCTION, nom: 'TEST_4', cible: 4, minimum: 4, attente: 1 };
  const s = await demarrerServeur({ port: 0, politique: petite, graine: 777 });
  const url = `ws://127.0.0.1:${s.port}`;

  const N = 20;
  const clients = [];
  for (let i = 0; i < N; i++) clients.push(await creerClient(url, `j${i}`));
  await Promise.all(clients.map((c) => c.attendre('bienvenue')));
  dit(true, `${N} clients connectés`);

  for (const c of clients) c.envoyerJson({ type: 'rejoindre', mise: 0 });
  await patienter(1800);

  const etat = await (await fetch(`http://127.0.0.1:${s.port}/etat`)).json();
  dit(etat.parties === N / 4,
    `${N} joueurs en salons de 4 → ${etat.parties} parties en parallèle (attendu ${N / 4})`);
  dit(etat.joueursEnPartie === N, `les ${etat.joueursEnPartie} joueurs sont tous en partie`);

  // Chaque client doit avoir reçu SA manche, et elles ne sont pas toutes identiques.
  await Promise.all(clients.map((c) => c.attendre('manche')));
  const graines = new Set(clients.map((c) => c.messages.find((m) => m.type === 'manche').graine));
  dit(graines.size === N / 4,
    `${graines.size} graines distinctes : chaque partie a son propre monde`);

  for (const c of clients) c.jouer();
  await patienter(2500);
  const recus = clients.filter((c) => c.instantanes > 20).length;
  dit(recus === N, `les ${recus} clients reçoivent leurs instantanés (parties simultanées)`);

  for (const c of clients) c.fermer();
  await s.arreter();
}

// ===========================================================================
titre('3. Une déconnexion ne fige personne');
// ===========================================================================
/*
 * Le scénario le plus banal d'un jeu en ligne, et celui qui casse les serveurs naïfs : un
 * joueur ferme son onglet au milieu d'une manche. Sa place n'est pas libérée — son
 * personnage passe en pilotage automatique — et les autres continuent. Figer quinze
 * personnes pour la décision d'une seule serait le pire arbitrage possible.
 */
{
  const petite = { ...POLITIQUES.PRODUCTION, nom: 'TEST_4', cible: 4, minimum: 4, attente: 1 };
  const s = await demarrerServeur({ port: 0, politique: petite, graine: 999 });
  const url = `ws://127.0.0.1:${s.port}`;

  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await creerClient(url, `k${i}`));
  await Promise.all(clients.map((c) => c.attendre('bienvenue')));
  for (const c of clients) c.envoyerJson({ type: 'rejoindre', mise: 0 });
  await Promise.all(clients.map((c) => c.attendre('manche')));
  for (const c of clients) c.jouer();

  await patienter(1500);
  const avant = clients[1].instantanes;

  clients[0].fermer();                       // un joueur ferme son onglet
  await patienter(2000);

  dit(clients[1].instantanes > avant + 20,
    `les autres continuent de recevoir (${clients[1].instantanes - avant} instantanés depuis la coupure)`);

  const etat = await (await fetch(`http://127.0.0.1:${s.port}/etat`)).json();
  dit(etat.parties === 1, 'la partie tourne toujours');
  dit(etat.joueursEnPartie === 3, `${etat.joueursEnPartie} joueurs encore connectés sur 4`);
  dit(clients[1].dernierInstantane.joueurs.length === 4,
    'le personnage du parti est TOUJOURS dans l\'instantané — sa place n\'est pas libérée');

  for (const c of clients) c.fermer();
  await s.arreter();
}

// ===========================================================================
titre('4. Le serveur tient sa cadence');
// ===========================================================================
{
  const petite = { ...POLITIQUES.PRODUCTION, nom: 'TEST_16', cible: 16, minimum: 16, attente: 1 };
  const s = await demarrerServeur({ port: 0, politique: petite, graine: 31337 });
  const url = `ws://127.0.0.1:${s.port}`;

  const clients = [];
  for (let i = 0; i < 16; i++) clients.push(await creerClient(url, `p${i}`));
  await Promise.all(clients.map((c) => c.attendre('bienvenue')));
  for (const c of clients) c.envoyerJson({ type: 'rejoindre', mise: 0 });
  await Promise.all(clients.map((c) => c.attendre('manche')));
  for (const c of clients) c.jouer();

  // Même précaution : le décompte ne fait pas avancer `manche.tick`, donc le chronométrer
  // ferait lire une cadence deux fois trop basse.
  const annonce = clients[0].messages.find((m) => m.type === 'manche');
  await patienter(annonce.decompte * 1000 + 400);
  const instantanesAuDepart = clients[0].instantanes;
  const octetsAuDepart = clients[0].octetsRecus;
  const envoyesAuDepart = clients[0].octetsEnvoyes;

  const mesureDebut = Date.now();
  const tickDebut = clients[0].dernierInstantane?.tick ?? 0;
  await patienter(5000);
  const ecoule = (Date.now() - mesureDebut) / 1000;
  const ticks = (clients[0].dernierInstantane?.tick ?? 0) - tickDebut;
  const hz = ticks / ecoule;

  dit(hz > 27 && hz < 33, `simulation à ${hz.toFixed(1)} Hz (attendu 30)`);

  const parClient = (clients[0].instantanes - instantanesAuDepart) / ecoule;
  dit(parClient > 17 && parClient < 23, `diffusion à ${parClient.toFixed(1)} Hz (attendu 20)`);

  const debit = (clients[0].octetsRecus - octetsAuDepart) / 1024 / ecoule;
  console.log(`     16 joueurs · ${debit.toFixed(1)} Ko/s descendant par client`
    + ` · ${((clients[0].octetsEnvoyes - envoyesAuDepart) / 1024 / ecoule).toFixed(1)} Ko/s montant`);
  dit(debit < 10, `le débit reste raisonnable : ${debit.toFixed(1)} Ko/s`);

  for (const c of clients) c.fermer();
  await s.arreter();
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
