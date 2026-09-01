/**
 * LE SERVEUR DE JEU — une WebSocket, un matchmaking, des parties en parallèle.
 *
 * WebSocket et pas autre chose, parce que c'est ce qui marche partout dans un navigateur,
 * sans installation. WebTransport donnerait des datagrammes non fiables — plus proche
 * d'UDP, donc mieux pour un jeu — mais c'est une optimisation de second temps : à 20 Hz
 * et 138 octets par instantané, TCP tient très bien. `envoyer()` est isolé pour que
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
 */
export async function demarrerServeur({
  port = 8080,
  politique = POLITIQUES.PRODUCTION,
  graine = Date.now() >>> 0,
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

  const mm = creerMatchmaking({ politique, envoyer, graine });

  const http = createServer(async (req, res) => {
    // Un point de contrôle, pour savoir d'un coup d'œil ce que le serveur fait.
    if (req.url === '/etat') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ joueurs: liens.size, ...mm.etat() }));
      return;
    }
    if (await servirFichier(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Introuvable. Le jeu compile manque ? `cd tools/feel-lab && npm run build`');
  });

  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (ws) => {
    let nom = null;

    ws.on('message', (donnees, estBinaire) => {
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
           * L'identité est DÉCLARÉE, et c'est temporaire.
           *
           * En production, ce nom viendra du jeton Supabase vérifié — sinon n'importe qui
           * se présente sous le nom de n'importe qui, et le règlement paierait le mauvais
           * joueur. Le raccord se fait ici, en une vérification de jeton, quand le
           * `MatchResult` signé arrivera.
           */
          const voulu = String(msg.nom ?? '').slice(0, 32) || `joueur-${liens.size + 1}`;
          if (liens.has(voulu)) { envoyer(voulu, null); ws.close(4001, 'nom deja pris'); return; }
          nom = voulu;
          liens.set(nom, ws);
          envoyer(nom, { type: 'bienvenue', nom, politique: mm.etat().politique });
          break;
        }

        case 'rejoindre': {
          if (!nom) return;
          const r = mm.rejoindre({ nom, faire: () => pilotageAutomatique() }, Number(msg.mise ?? 0));
          if (!r.accepte) envoyer(nom, { type: 'refus', raison: r.raison });
          break;
        }

        case 'accepter':
          if (nom) mm.accepter(nom);
          break;

        case 'quitter':
          if (nom) mm.quitter(nom);
          break;

        default:
          break;
      }
    });

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
