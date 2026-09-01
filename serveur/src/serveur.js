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
import { WebSocketServer } from 'ws';
import { preparer } from './monde.js';
import { creerMatchmaking } from './matchmaking.js';
import { POLITIQUES } from './politique.js';
import { typeDe, decoderEntree, TYPE } from './reseau/protocole.js';

/** Cadence du matchmaking. Une fois par seconde suffit : il ne simule rien. */
const BATTEMENT = 1000;

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

  const http = createServer((req, res) => {
    // Un point de contrôle, pour savoir d'un coup d'œil ce que le serveur fait.
    if (req.url === '/etat') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ joueurs: liens.size, ...mm.etat() }));
      return;
    }
    res.writeHead(404).end();
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

  await new Promise((resoudre) => http.listen(port, resoudre));

  return {
    port: http.address().port,
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
