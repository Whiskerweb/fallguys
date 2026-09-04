/**
 * LE SERVEUR DE JEU — une WebSocket, un matchmaking, des parties en parallèle.
 *
 * WebSocket et pas autre chose, parce que c'est ce qui marche partout dans un navigateur,
 * sans installation. WebTransport donnerait des datagrammes non fiables — plus proche
 * d'UDP, donc mieux pour un jeu — mais c'est une optimisation de second temps : à 20 Hz
 * et 202 octets par instantané, TCP tient très bien. `envoyer()` est isolé pour que
 * changer de transport ne touche à rien d'autre.
 *
 * Ce fichier ne contient AUCUNE règle de jeu. Il traduit des octets en appels et des
 * appels en octets ; tout ce qui décide se trouve dans `matchmaking.js`, `instance.js`,
 * `salon.js` et `manche.js`. C'est ce qui permet de les éprouver sans réseau.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { preparer } from './monde.js';
import { creerMatchmaking } from './matchmaking.js';
import { POLITIQUES } from './politique.js';
import { typeDe, decoderEntree, TYPE } from './reseau.js';
import { verifierJeton, IDENTITE_CONFIGUREE } from './identite.js';

/** Cadence du matchmaking. Une fois par seconde suffit : il ne simule rien. */
const BATTEMENT = 1000;

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** Le jeu compilé. `npm run build` dans tools/feel-lab le produit. */
const DIST = path.resolve(ICI, '..', '..', 'tools', 'feel-lab', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/**
 * Les adresses par lesquelles une AUTRE machine peut joindre ce serveur.
 *
 * On les affiche au démarrage. Sans cela, tester à deux commence par une chasse à
 * l'adresse IP — dans les réglages système, ou avec `ifconfig` et ses vingt lignes — et
 * cette friction-là suffit à ce qu'on ne teste pas.
 */
function adressesLocales() {
  const out = [];
  for (const cartes of Object.values(networkInterfaces())) {
    for (const c of cartes ?? []) {
      if (c.family === 'IPv4' && !c.internal) out.push(c.address);
    }
  }
  return out;
}

/**
 * Sert le jeu compilé.
 *
 * LE MÊME PROCESSUS SERT LA PAGE ET LA PARTIE, et ce n'est pas un raccourci : c'est ce qui
 * rend l'essai à deux machines possible sans configuration. La seconde machine ouvre une
 * adresse, et la WebSocket part vers ce même hôte — rien à saisir, rien à faire
 * correspondre. Deux serveurs sur deux ports obligeraient à retrouver une IP deux fois, et
 * à se tromper une fois sur deux.
 */
async function servirFichier(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Aucune remontée hors de `dist` : `path.resolve` normalise, et on vérifie que le
  // résultat reste dans le dossier. Sans ce test, `/../../.env` serait servi.
  const fichier = path.resolve(DIST, '.' + rel);
  if (!fichier.startsWith(DIST)) { res.writeHead(403).end(); return true; }

  try {
    const info = await stat(fichier);
    if (!info.isFile()) return false;
    const type = TYPES[path.extname(fichier).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': info.size });
    res.end(await readFile(fichier));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} p
 * @param {number} [p.port]
 * @param {string|object} [p.politique]
 * @param {number} [p.graine]
 * @param {object|null} [p.pont] le pont vers le backend (`argent.js`). Sans lui, aucune
 *   file payante ne s'ouvre hors banc, et `/api/…` répond 503.
 */
export async function demarrerServeur({
  port = 8080,
  politique = POLITIQUES.PRODUCTION,
  graine = Date.now() >>> 0,
  pont = null,
} = {}) {
  await preparer();

  /** Les connexions vivantes, par nom de joueur. */
  const liens = new Map();

  /**
   * Le SEUL endroit qui parle au réseau.
   *
   * Un message objet part en JSON, un `ArrayBuffer` part tel quel. Un joueur qui n'est
   * plus là ne provoque rien : une partie continue sans lui, et tenter d'écrire dans une
   * socket fermée ferait tomber le tick de tout le monde.
   */
  const envoyer = (nom, message) => {
    const ws = liens.get(nom);
    if (!ws || ws.readyState !== ws.OPEN) return;
    try {
      ws.send(message instanceof ArrayBuffer ? message : JSON.stringify(message));
    } catch {
      // Socket morte entre le test et l'envoi. Le ménage se fera sur l'événement `close`.
    }
  };

  /**
   * À TOUS les connectés — c'est par là que part la présence des files.
   *
   * Un joueur qui n'a encore rien choisi doit déjà voir où sont les autres : c'est ce qui
   * fait la différence entre un lobby vivant et un lobby qu'on croit vide. Le message est
   * encodé UNE fois pour tout le monde ; à un battement par seconde et neuf files, c'est
   * dérisoire, mais c'est le geste juste.
   */
  const diffuser = (message) => {
    const texte = JSON.stringify(message);
    for (const ws of liens.values()) {
      if (ws.readyState !== ws.OPEN) continue;
      try { ws.send(texte); } catch { /* le ménage se fera sur `close` */ }
    }
  };

  const mm = creerMatchmaking({ politique, envoyer, diffuser, graine, pont });

  const http = createServer(async (req, res) => {
    // Un point de contrôle, pour savoir d'un coup d'œil ce que le serveur fait.
    if (req.url === '/etat') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        joueurs: liens.size, ...mm.etat(),
        argent: Boolean(pont), identite: IDENTITE_CONFIGUREE,
      }));
      return;
    }
    /*
     * `/api/…` RELAIE AU BACKEND. Le navigateur ne connaît qu'une adresse — celle qui lui
     * a servi la page — et c'est ce qui rend le déploiement à une machine possible sans
     * CORS, sans seconde URL à configurer dans le bundle, et sans exposer le backend
     * lui-même. Le flux d'événements (`/api/stats/flux`) passe aussi : on recopie la
     * réponse morceau par morceau au lieu de l'attendre en entier.
     */
    if (req.url.startsWith('/api/') || req.url === '/api') {
      if (!pont) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"erreur":"ARGENT_INDISPONIBLE"}'); return; }
      await relayer(req, res, pont.url);
      return;
    }
    if (await servirFichier(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Introuvable. Le jeu compile manque ? `cd tools/feel-lab && npm run build`');
  });

  const wss = new WebSocketServer({ server: http });

  const politiqueObjet = typeof politique === 'string' ? POLITIQUES[politique] : politique;

  wss.on('connection', (ws) => {
    let nom = null;
    /** L'identifiant Supabase vérifié, ou `null` pour un invité. */
    let compte = null;
    /**
     * Les messages arrivés PENDANT la vérification de `bonjour`, rejoués après elle.
     *
     * La vérification est un aller-retour HTTP vers Supabase ; ce qui arrivait entre-temps
     * était jeté, `nom` étant encore nul. Sur un réseau propre ça ne se voyait pas — le
     * joueur clique PLAY des secondes après l'ouverture. Sur un réseau qui coupe et
     * relâche par rafales, `bonjour` et `rejoindre` peuvent arriver dans la même
     * milliseconde, et le second se perdait : le joueur restait devant un bouton qui ne
     * faisait rien. Vu au banc `tools/test-harness/gigue.mjs`, pas deviné.
     */
    let enAttente = null;
    const PLAFOND_ATTENTE = 32;

    const traiter = (donnees, estBinaire) => {
      if (!nom && enAttente) {
        if (enAttente.length < PLAFOND_ATTENTE) enAttente.push([donnees, estBinaire]);
        return;
      }
      recevoir(donnees, estBinaire);
    };
    ws.on('message', traiter);

    function recevoir(donnees, estBinaire) {
      /*
       * LE CHEMIN CHAUD D'ABORD.
       *
       * Une trame binaire est une entrée de joueur : soixante par seconde et par joueur,
       * contre quelques messages JSON par partie. On la traite avant de tenter le moindre
       * `JSON.parse`, qui coûterait cher pour rien à cette cadence.
       */
      if (estBinaire) {
        if (!nom || typeDe(donnees) !== TYPE.ENTREE) return;
        const instance = mm.instanceDe(nom);
        if (!instance) return;
        try {
          instance.entree(nom, decoderEntree(donnees));
        } catch {
          // Trame malformée : on l'ignore. Un client qui envoie n'importe quoi ne doit pas
          // pouvoir faire tomber la partie des quinze autres.
        }
        return;
      }

      let msg;
      try { msg = JSON.parse(donnees.toString()); } catch { return; }

      switch (msg.type) {
        case 'bonjour': {
          /*
           * LE NOM EST UNE ÉTIQUETTE ; LE COMPTE EST UNE PREUVE.
           *
           * Le nom reste déclaré : c'est ce que les autres voient. Mais depuis que le
           * serveur fait engager des mises et régler des gains, il lui faut savoir QUI
           * paie : le jeton Supabase envoyé avec `bonjour` est vérifié auprès de Supabase
           * (`identite.js`), et le compte qu'il désigne suit le joueur jusqu'au règlement.
           * Sans jeton valide, c'est un invité — files gratuites seulement (`politique.js`).
           *
           * La vérification est un aller-retour HTTP : on répond `bienvenue` APRÈS, pour
           * que le client sache d'emblée s'il est reconnu. Les messages qui arriveraient
           * entre-temps sont ignorés (`nom` est encore nul).
           */
          if (nom || enAttente) return;
          const voulu = String(msg.nom ?? '').slice(0, 32) || `joueur-${liens.size + 1}`;
          enAttente = [];
          verifierJeton(msg.jeton).then((identite) => {
            if (ws.readyState !== ws.OPEN) return;
            if (liens.has(voulu)) { ws.close(4001, 'nom deja pris'); return; }
            nom = voulu;
            compte = identite?.userId ?? null;
            liens.set(nom, ws);
            envoyer(nom, {
              type: 'bienvenue', nom, politique: mm.etat().politique, joueurs: liens.size,
              compte,
              // Ce que le client doit savoir pour dessiner son lobby : y a-t-il de l'argent
              // derrière ce serveur, et faut-il un compte pour miser ?
              argent: Boolean(pont),
              // Même règle que `refusDEntree` : seule une politique qui EXIGE l'identité
              // ferme le banc. Une politique écrite à la main dans un harnais n'en dit
              // rien, et le client doit alors se voir offrir son portefeuille imaginaire.
              identite: politiqueObjet?.identite === 'requise' ? 'requise' : 'facultative',
            });
            // La présence tout de suite, sans attendre le battement : le lobby s'ouvre sur
            // l'état des files, pas sur une seconde de cases vides.
            envoyer(nom, mm.presence());
            // Et ce qui attendait pendant la vérification passe maintenant, dans l'ordre.
            const differes = enAttente;
            enAttente = null;
            for (const [d, b] of differes) recevoir(d, b);
          }).catch(() => { enAttente = null; try { ws.close(4002, 'identite invalide'); } catch {} });
          break;
        }

        case 'rejoindre': {
          if (!nom) return;
          /*
           * LE PERSONNAGE CHOISI n'est qu'une étiquette, et le serveur la traite comme
           * telle : il ne la comprend pas, il la relaie aux autres joueurs. Aucune règle
           * de jeu n'en dépend — c'est le principe de ce fichier.
           *
           * Il la BORNE quand même. Un client peut envoyer ce qu'il veut, et cette chaîne
           * finit dans l'annonce de manche de tous les autres : sans garde-fou, un joueur
           * pourrait leur expédier un mégaoctet. Le client, lui, vérifie de son côté que
           * l'identifiant existe vraiment dans son catalogue.
           */
          const modele = typeof msg.modele === 'string' && /^[a-z0-9-]{1,40}$/i.test(msg.modele)
            ? msg.modele
            : null;
          /*
           * LE MODE, en revanche, change tout : effectif, nombre de manches, barème. Il
           * vient du client, donc il n'est pas digne de confiance — `mm.rejoindre` le
           * confronte au catalogue et refuse l'inconnu plutôt que d'ouvrir une file
           * fantôme. On se contente ici de le borner en longueur avant de le transmettre.
           */
          const mode = typeof msg.mode === 'string' && /^[a-z]{1,16}$/.test(msg.mode)
            ? msg.mode
            : 'arena';
          const r = mm.rejoindre(
            { nom, modele, compte, faire: () => pilotageAutomatique() },
            Number(msg.mise ?? 0),
            mode,
          );
          if (!r.accepte) envoyer(nom, { type: 'refus', raison: r.raison });
          break;
        }

        case 'basculer': {
          /*
           * Le joueur accepte une suggestion. Mode et mise viennent du client, et sont
           * bornés ici EXACTEMENT comme dans `rejoindre` : une suggestion n'est pas un
           * laissez-passer, c'est une entrée en file comme une autre.
           */
          if (!nom) return;
          const mode = typeof msg.mode === 'string' && /^[a-z]{1,16}$/.test(msg.mode)
            ? msg.mode
            : 'arena';
          const r = mm.basculer(nom, Number(msg.mise ?? 0), mode);
          if (!r.accepte) envoyer(nom, { type: 'refus', raison: r.raison });
          break;
        }

        case 'quitter':
          if (nom) mm.quitter(nom);
          break;

        default:
          break;
      }
    }

    ws.on('close', () => {
      if (!nom) return;
      mm.quitter(nom);
      liens.delete(nom);
    });

    // Une socket qui casse ne doit pas remonter jusqu'à faire tomber le processus.
    ws.on('error', () => {});
  });

  const battement = setInterval(() => mm.battre(), BATTEMENT);

  // `0.0.0.0` et non `127.0.0.1` : une seconde machine doit pouvoir se connecter, ce qui
  // est tout l'objet de l'exercice.
  await new Promise((resoudre) => http.listen(port, '0.0.0.0', resoudre));

  return {
    port: http.address().port,
    adresses: adressesLocales(),
    matchmaking: mm,
    get joueurs() { return liens.size; },
    async arreter() {
      clearInterval(battement);
      mm.arreter();
      for (const ws of liens.values()) { try { ws.close(); } catch {} }
      liens.clear();
      wss.close();
      await new Promise((r) => http.close(r));
    },
  };
}

/**
 * Relaie une requête `/api/…` au backend, en flux.
 *
 * L'en-tête `authorization` passe tel quel : c'est le jeton du joueur, et c'est le backend
 * qui le vérifie. Rien n'est ajouté, rien n'est retiré — ce serveur n'a pas d'avis sur
 * l'argent, il tient le tuyau.
 */
async function relayer(req, res, base) {
  const cible = `${base}${req.url.slice(4) || '/'}`;
  const morceaux = [];
  for await (const c of req) morceaux.push(c);
  let r;
  try {
    r = await fetch(cible, {
      method: req.method,
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
        accept: req.headers.accept ?? '*/*',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux),
    });
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ erreur: 'BACKEND_INJOIGNABLE', message: e.message }));
    return;
  }
  const entetes = {};
  for (const [k, v] of r.headers) if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) entetes[k] = v;
  res.writeHead(r.status, entetes);
  if (!r.body) { res.end(); return; }
  const lecteur = r.body.getReader();
  req.on('close', () => lecteur.cancel().catch(() => {}));
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      res.write(value);
    }
  } catch { /* le client est parti */ }
  res.end();
}

/**
 * Le pilote d'un joueur HUMAIN.
 *
 * Il ne décide rien : ses entrées viennent du réseau, et `manche.js` les lui passe. Ce
 * pilote n'est consulté que si aucune entrée n'est arrivée — au tout début d'une manche,
 * ou quand le joueur s'est déconnecté. Il rend alors une entrée neutre : le personnage
 * reste sur place au lieu de partir droit devant sur la foi d'une touche qu'on ne presse
 * plus.
 */
function pilotageAutomatique() {
  return { entree: () => ({ x: 0, z: 0, jump: false, dive: false }) };
}
