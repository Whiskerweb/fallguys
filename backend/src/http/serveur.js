/**
 * L'API — la seule porte entre le navigateur et l'argent.
 *
 * Node nu, sans cadre applicatif : une dizaine de routes ne justifient pas une dependance
 * de plus, et sur un service qui garde une cle de caisse, chaque dependance est une
 * surface a surveiller.
 *
 * Regle du fichier : AUCUNE route ne prend un identifiant de joueur en parametre. Le
 * joueur est toujours celui du jeton, jamais celui de la requete. C'est ce qui rend
 * inutile la moitie des controles qu'il faudrait sinon ecrire — et ne pas oublier.
 */

import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { config, exiger } from '../config.js';
import { solde, compte } from '../livre.js';
import { engager, regler } from '../match/regler.js';
import { demander } from '../solana/retraits.js';
import { adresseDepot } from '../solana/adresses.js';
import { releverDepots, balayer } from '../solana/guetteur.js';
import { table, PALIERS, CONFIG } from '../gains.js';
import { MICROS } from '../argent.js';

const json = (res, code, corps) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': config.origine ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(corps));
};

async function corps(req) {
  const morceaux = [];
  let taille = 0;
  for await (const c of req) {
    taille += c.length;
    // Une requete de ce service ne depasse jamais quelques centaines d'octets. Plafonner
    // evite qu'un corps interminable occupe la memoire du seul processus qui signe les
    // retraits.
    if (taille > 16_384) throw refus(413, 'CORPS_TROP_GROS', 'requete trop volumineuse');
    morceaux.push(c);
  }
  if (!morceaux.length) return {};
  try {
    return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
  } catch {
    throw refus(400, 'JSON_INVALIDE', 'corps de requete illisible');
  }
}

const refus = (statut, code, message) => Object.assign(new Error(message), { statut, code });

export function creerServeur(db) {
  exiger('supabaseUrl', 'supabaseAnon');
  const supabase = createClient(config.supabaseUrl, config.supabaseAnon);

  /**
   * Identifie l'appelant par son jeton Supabase.
   *
   * Le jeton est verifie par Supabase, pas par nous : c'est lui qui detient la cle de
   * signature. On ne decode donc jamais le JWT nous-memes — un decodage sans verification
   * est la faille la plus repandue de ce genre de service, et elle se lit « n'importe qui
   * peut se declarer n'importe qui ».
   */
  async function joueurDe(req) {
    const entete = req.headers.authorization ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
    if (!jeton) throw refus(401, 'NON_AUTHENTIFIE', 'jeton absent');

    const { data, error } = await supabase.auth.getUser(jeton);
    if (error || !data?.user) throw refus(401, 'JETON_INVALIDE', 'session expiree ou invalide');

    // Le profil est cree a la premiere visite, avec son adresse de depot derivee.
    const id = data.user.id;
    await db.query(
      `insert into public.profiles (id, pseudo, adresse_depot)
       values ($1, $2, $3) on conflict (id) do nothing`,
      [id, data.user.user_metadata?.name ?? null, adresseDepot(id)],
    );
    return id;
  }

  const routes = {

    /** Tout ce que le lobby a besoin de savoir en une requete. */
    'GET /moi': async (req) => {
      const userId = await joueurDe(req);
      const p = (await db.query(
        'select pseudo, wallet, adresse_depot from public.profiles where id = $1', [userId],
      )).rows[0];
      return {
        userId,
        pseudo: p.pseudo,
        wallet: p.wallet,
        adresseDepot: p.adresse_depot,
        solde: await solde(db, compte.joueur(userId)),
        reseau: config.reseau,
        paliers: PALIERS,
        depotMinimum: config.depotMinimum,
        retraitMinimum: config.retraitMinimum,
        delaiPremierRetraitHeures: config.delaiPremierRetraitHeures,
      };
    },

    /**
     * Lie un wallet Solana au compte, par PREUVE DE SIGNATURE.
     *
     * Le joueur signe un message avec sa cle privee ; on verifie que la signature
     * correspond a l'adresse annoncee. Sans cette verification, n'importe qui declarerait
     * l'adresse de n'importe qui — et comme c'est la destination imposee des retraits,
     * ce serait un detournement en une requete.
     */
    'POST /wallet/lier': async (req) => {
      const userId = await joueurDe(req);
      const { adresse, message, signature } = await corps(req);
      if (!adresse || !message || !signature) {
        throw refus(400, 'CHAMPS_MANQUANTS', 'adresse, message et signature sont requis');
      }

      /*
       * Le message doit porter l'identifiant du joueur ET une date recente.
       *
       * L'identifiant empeche de rejouer devant un autre compte une signature obtenue
       * ailleurs ; la date empeche de rejouer indefiniment la meme. Une signature valide
       * mais recyclee est le piege classique de ce genre de liaison.
       */
      if (!String(message).includes(userId)) {
        throw refus(400, 'MESSAGE_ETRANGER', 'le message signe ne designe pas ce compte');
      }
      const horodatage = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(message)?.[1];
      const age = horodatage ? Date.now() - Date.parse(horodatage) : Infinity;
      if (!(age >= 0 && age < 10 * 60 * 1000)) {
        throw refus(400, 'MESSAGE_PERIME', 'le message signe doit dater de moins de dix minutes');
      }

      let valide = false;
      try {
        valide = nacl.sign.detached.verify(
          new TextEncoder().encode(message),
          bs58.decode(signature),
          bs58.decode(adresse),
        );
      } catch {
        valide = false;
      }
      if (!valide) throw refus(400, 'SIGNATURE_INVALIDE', 'la signature ne correspond pas a l\'adresse');

      /*
       * Relier un wallet REMET LE COMPTEUR A ZERO : `wallet_lie_le` est reecrit, donc le
       * delai du premier retrait repart. Un compte vole dont l'attaquant relie sa propre
       * adresse doit attendre un jour avant de sortir quoi que ce soit.
       */
      await db.query(
        `update public.profiles set wallet = $2, wallet_lie_le = now() where id = $1`,
        [userId, adresse],
      );
      return { wallet: adresse, delaiPremierRetraitHeures: config.delaiPremierRetraitHeures };
    },

    /** Releve les depots arrives, et balaie. Appele par le lobby quand le joueur regarde. */
    'POST /depots/relever': async (req) => {
      const userId = await joueurDe(req);
      const p = (await db.query(
        'select adresse_depot from public.profiles where id = $1', [userId],
      )).rows[0];
      const vus = await releverDepots(db, { userId, adresse: p.adresse_depot });
      if (vus.some((v) => !v.deja)) {
        // Un balayage rate n'empeche pas de repondre : le joueur est deja credite.
        balayer(userId).catch((e) => console.error(`balayage ${userId} : ${e.message}`));
      }
      return { nouveaux: vus.filter((v) => !v.deja), solde: await solde(db, compte.joueur(userId)) };
    },

    /** Engage la mise : l'argent quitte le solde et entre dans le pot. */
    'POST /partie/engager': async (req) => {
      const userId = await joueurDe(req);
      const { matchId, mise } = await corps(req);
      if (!matchId) throw refus(400, 'MATCH_MANQUANT', 'matchId requis');
      if (!PALIERS.includes(mise / MICROS)) {
        throw refus(400, 'MISE_HORS_CATALOGUE', `tables ouvertes : ${PALIERS.join(', ')} USDC`);
      }
      // `matchId` est prefixe du joueur : un identifiant de partie choisi par le client ne
      // doit pas pouvoir designer le pot d'un autre.
      const r = await engager(db, { matchId: `${userId}:${matchId}`, userId, mise });
      return { engagee: !r.deja, solde: r.solde };
    },

    /**
     * Regle la partie et verse le gain du rang atteint.
     *
     *   LIMITE ASSUMEE DU LOT DEVNET : le rang est DECLARE par le navigateur. Rien ici ne
     *   peut en etablir la veracite tant que le serveur de jeu autoritatif n'existe pas.
     *   Sans consequence sur devnet ; redhibitoire en mainnet. Voir README.md.
     */
    'POST /partie/regler': async (req) => {
      const userId = await joueurDe(req);
      const { matchId, rang, mise } = await corps(req);
      if (!matchId) throw refus(400, 'MATCH_MANQUANT', 'matchId requis');
      const r = await regler(db, {
        matchId: `${userId}:${matchId}`,
        mise,
        classement: [{ userId, rang }],
      });
      return {
        regle: !r.deja,
        gain: table(mise).parRang[rang - 1] ?? 0,
        solde: await solde(db, compte.joueur(userId)),
      };
    },

    /** Demande un retrait vers le wallet lie. La destination n'est jamais un parametre. */
    'POST /retrait': async (req) => {
      const userId = await joueurDe(req);
      const { montant } = await corps(req);
      const r = await demander(db, { userId, montant });
      return { id: r.id, montant: r.montant, destination: r.destination, solde: r.solde };
    },

    'GET /historique': async (req) => {
      const userId = await joueurDe(req);
      const r = await db.query(
        `select e.cree_le, t.genre, e.amount_micros, t.metadata
           from public.ledger_entries e join public.ledger_tx t on t.id = e.tx_id
          where e.compte = $1 order by e.id desc limit 50`,
        [compte.joueur(userId)],
      );
      return { lignes: r.rows };
    },

    /** Sans authentification : la table des gains, pour que le lobby puisse l'afficher. */
    'GET /bareme': async () => ({ config: CONFIG, paliers: PALIERS,
      tables: Object.fromEntries(PALIERS.map((u) => [u, table(u * MICROS)])) }),
  };

  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const cle = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
    const route = routes[cle];
    if (!route) return json(res, 404, { erreur: 'ROUTE_INCONNUE', message: cle });

    try {
      json(res, 200, await route(req));
    } catch (e) {
      /*
       * On rend le code d'erreur, jamais la pile ni le detail interne. Un message
       * d'erreur bavard sur un service qui garde une cle de caisse renseigne surtout
       * celui qui cherche a le sonder.
       */
      const statut = e.statut ?? (e.code ? 400 : 500);
      if (statut >= 500) console.error(`${cle} :`, e);
      json(res, statut, { erreur: e.code ?? 'ERREUR', message: e.code ? e.message : 'erreur interne' });
    }
  });
}
