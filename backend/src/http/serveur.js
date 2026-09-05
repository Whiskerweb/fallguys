/**
 * L'API — la seule porte entre le navigateur et l'argent, et la porte du serveur de jeu.
 *
 * Node nu, sans cadre applicatif : une quinzaine de routes ne justifient pas une
 * dependance de plus, et sur un service qui garde une cle de caisse, chaque dependance est
 * une surface a surveiller.
 *
 * Deux familles de routes, et elles ne se ressemblent pas :
 *
 *   - LES ROUTES DU JOUEUR (`/moi`, `/retrait`…) : identifie par son jeton Supabase, il ne
 *     peut agir que sur lui-meme. AUCUNE ne prend un identifiant de joueur en parametre.
 *     Et depuis le 2 septembre 2026, AUCUNE NE PARLE DE PARTIE : le navigateur ne peut
 *     plus engager une mise ni declarer un rang. Il consulte, il depose, il retire — et
 *     sur le testnet, il demande des USDC d'essai au robinet ;
 *
 *   - LES ROUTES INTERNES (`/interne/…`) : le serveur de jeu, qui a simule la partie et
 *     sait qui a fini ou, signe chaque message avec sa cle Ed25519. Le backend verifie la
 *     signature et la fraicheur avant d'ecrire une ligne. C'etait le trou n° 1 de la liste
 *     d'avant-mainnet ; il est ferme ici.
 *
 *   - et les ROUTES PUBLIQUES (`/bareme`, `/stats`, `/suivi`) : sans jeton, deliberement.
 *     Un bareme qu'on ne peut pas lire avant de miser n'est pas un bareme publie, et un
 *     brulage qu'on ne peut pas verifier n'est pas un brulage.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { verifyMessage, getAddress, isAddress } from 'ethers';
import { config, exiger } from '../config.js';
import { solde, compte } from '../livre.js';
import { engagerPartie, regler, annulerPartie } from '../match/regler.js';
import { demander } from '../robinhood/retraits.js';
import { adresseDepot } from '../robinhood/adresses.js';
import { releverDepots } from '../robinhood/guetteur.js';
import { lienExplorateur, lienAdresse, ChaineEchouee, ChaineIncertaine } from '../robinhood/chaine.js';
import { verifierChaine } from '../robinhood/reconciliation.js';
import { RESEAUX } from '../robinhood/reseaux.js';
import { tresorerie } from '../robinhood/tresorerie.js';
import { acheter, possessions, catalogue, LIEN_SUIVI } from '../boutique.js';
import { ouvrir } from '../signature.js';
import { statistiques, invaliderStats, poserVerification } from '../stats.js';
import { publier, souscrire } from '../evenements.js';
import { table, tableEffectif, esperance, roueDe, grade, PALIERS, MODES, ORDRE_MODES, ISSUES, mode, tirerIssue } from '../gains.js';
import { MICROS } from '../argent.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const entetes = (type = 'application/json; charset=utf-8') => ({
  'content-type': type,
  'access-control-allow-origin': config.origine ?? '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
});

const json = (res, code, corps) => {
  res.writeHead(code, entetes());
  res.end(JSON.stringify(corps));
};

async function corps(req) {
  const morceaux = [];
  let taille = 0;
  for await (const c of req) {
    taille += c.length;
    // Un resultat d'arene a seize joueurs tient en deux kilo-octets. Plafonner evite qu'un
    // corps interminable occupe la memoire du seul processus qui signe les paiements.
    if (taille > 32_768) throw refus(413, 'CORPS_TROP_GROS', 'requete trop volumineuse');
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

/**
 * @param {object} db
 * @param {object} p
 * @param {object} p.chaine la chaine (reelle ou factice). Sans elle, les routes internes
 *   refusent : un pot ne se remplit pas en l'air.
 */
export function creerServeur(db, { chaine = null } = {}) {
  exiger('supabaseUrl', 'supabaseAnon');
  const supabase = createClient(config.supabaseUrl, config.supabaseAnon);

  /**
   * Identifie l'appelant par son jeton Supabase.
   *
   * Le jeton est verifie par Supabase, pas par nous : c'est lui qui detient la cle de
   * signature. On ne decode jamais le JWT nous-memes.
   */
  async function joueurDe(req) {
    const entete = req.headers.authorization ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
    if (!jeton) throw refus(401, 'NON_AUTHENTIFIE', 'jeton absent');

    const { data, error } = await supabase.auth.getUser(jeton);
    if (error || !data?.user) throw refus(401, 'JETON_INVALIDE', 'session expiree ou invalide');

    const id = data.user.id;
    /*
     * L'adresse de depot est DERIVEE, donc recalculable : si celle en base n'est pas celle
     * de la chaine courante (un profil ne de l'ancienne chaine), on la remplace. Un profil
     * qui garderait une adresse d'une autre chaine enverrait le joueur deposer dans le vide.
     */
    await db.query(
      `insert into public.profiles (id, pseudo, adresse_depot)
       values ($1, $2, $3)
       on conflict (id) do update set adresse_depot = excluded.adresse_depot
       where public.profiles.adresse_depot is distinct from excluded.adresse_depot`,
      [id, data.user.user_metadata?.name ?? null, adresseDepot(id)],
    );
    return id;
  }

  /**
   * Une route INTERNE : le message doit etre scelle par la cle du serveur de jeu.
   *
   * `quoi` est verifie aussi : un message « soldes » signe ne doit pas pouvoir etre
   * presente a la route « regler ». Chaque route n'accepte que son propre verbe.
   */
  const interne = (quoi, fn) => async (req) => {
    if (!config.serveurPublique) throw refus(503, 'SERVEUR_NON_CONFIGURE', 'SERVEUR_PUBLIQUE absente');
    if (!chaine) throw refus(503, 'CHAINE_ABSENTE', 'aucune chaine configuree');
    const message = await corps(req);
    const o = ouvrir(message, config.serveurPublique);
    if (!o.ok) throw refus(401, o.raison, 'message refuse');
    if (o.corps.quoi !== quoi) throw refus(400, 'QUOI_INATTENDU', `attendu « ${quoi} », recu « ${o.corps.quoi} »`);
    return fn(o.corps);
  };

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const idPartie = /^[a-z0-9-]{4,64}$/i;

  const routes = {

    /** Tout ce que le lobby a besoin de savoir en une requete. */
    'GET /moi': async (req) => {
      const userId = await joueurDe(req);
      const p = (await db.query(
        'select pseudo, wallet, adresse_depot, wallet_lie_le from public.profiles where id = $1', [userId],
      )).rows[0];
      const enAttente = (await db.query(
        `select coalesce(sum(amount_micros), 0)::text as t from public.withdrawals where user_id = $1 and statut in ('demande', 'soumis')`, [userId],
      )).rows[0].t;
      return {
        userId,
        pseudo: p.pseudo,
        wallet: p.wallet,
        walletLieLe: p.wallet_lie_le,
        adresseDepot: p.adresse_depot,
        solde: await solde(db, compte.joueur(userId)),
        retraitsEnAttente: Number(enAttente),
        // Les skins achetes : c'est le backend qui dit ce qu'on possede, jamais le navigateur.
        possessions: await possessions(db, userId),
        reseau: config.reseau,
        /*
         * La CHAINE, telle que le navigateur doit la connaitre : de quoi ajouter le reseau
         * au wallet du joueur (`wallet_addEthereumChain`), le contrat USDC a appeler pour
         * deposer depuis son propre wallet, et si le robinet d'essai est ouvert.
         */
        chaine: {
          ...RESEAUX[config.reseau], rpc: config.rpc, chainId: config.chainId,
          usdc: config.usdcAdresse, bg: config.bgAdresse,
          robinet: config.reseau !== 'mainnet' && Boolean(config.usdcAdresse) && config.robinetMicros > 0,
          robinetMicros: config.robinetMicros,
          /*
           * Les autres portes d'entree : USDG et le swap depuis l'ETH, changes DANS le
           * wallet du joueur par un routeur de DEX, destination = adresse de depot
           * (`config.js`). `null` tant que le reseau n'a ni l'un ni l'autre — le guide
           * de depot ne montre alors pas ces chemins, il dit pourquoi.
           */
          usdg: config.usdgAdresse ?? null,
          swap: (config.swapRouteur && config.swapWeth) ? { routeur: config.swapRouteur, weth: config.swapWeth } : null,
        },
        liens: { wallet: lienAdresse(p.adresse_depot), explorateur: RESEAUX[config.reseau]?.explorateur ?? null },
        paliers: PALIERS,
        modes: ORDRE_MODES,
        depotMinimum: config.depotMinimum,
        retraitMinimum: config.retraitMinimum,
        delaiPremierRetraitHeures: config.delaiPremierRetraitHeures,
      };
    },

    /**
     * Lie un wallet Robinhood Chain (une adresse EVM) au compte, par PREUVE DE SIGNATURE.
     *
     * Le joueur signe un message avec sa cle privee (`personal_sign`) ; on verifie que la
     * signature correspond a l'adresse annoncee. Sans cette verification, n'importe qui
     * declarerait l'adresse de n'importe qui — et comme c'est la destination imposee des
     * retraits, ce serait un detournement en une requete.
     */
    'POST /wallet/lier': async (req) => {
      const userId = await joueurDe(req);
      const { adresse, message, signature } = await corps(req);
      if (!adresse || !message || !signature) {
        throw refus(400, 'CHAMPS_MANQUANTS', 'adresse, message et signature sont requis');
      }
      if (!isAddress(adresse)) throw refus(400, 'ADRESSE_INVALIDE', 'adresse Robinhood Chain attendue (0x…)');
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
        valide = verifyMessage(String(message), String(signature)) === getAddress(adresse);
      } catch { valide = false; }
      if (!valide) throw refus(400, 'SIGNATURE_INVALIDE', 'la signature ne correspond pas a l\'adresse');

      // Relier un wallet REMET LE COMPTEUR A ZERO : le delai du premier retrait repart.
      const wallet = getAddress(adresse);
      await db.query(
        `update public.profiles set wallet = $2, wallet_lie_le = now() where id = $1`, [userId, wallet],
      );
      return { wallet, delaiPremierRetraitHeures: config.delaiPremierRetraitHeures };
    },

    /**
     * LE ROBINET — des USDC d'essai sur le wallet de jeu du joueur. TESTNET SEULEMENT.
     *
     * Sur le testnet, personne ne vend d'USDC : le jeu frappe le sien (`USDCTest`), et
     * c'est le seul moyen pour un joueur d'en avoir. Un par heure et par joueur, pour que
     * la caisse ne paie pas le gaz d'un robot. Sur mainnet, la route repond 404 : le vrai
     * USDC n'a pas de fonction de frappe, et il n'y a rien a ouvrir.
     */
    'POST /robinet': async (req) => {
      if (config.reseau === 'mainnet' || !config.robinetMicros) throw refus(404, 'ROBINET_FERME', 'pas de robinet sur ce reseau');
      if (!chaine) throw refus(503, 'CHAINE_ABSENTE', 'aucune chaine configuree');
      const userId = await joueurDe(req);
      const p = (await db.query(
        `select adresse_depot, dernier_robinet_le from public.profiles where id = $1`, [userId],
      )).rows[0];
      const depuis = p.dernier_robinet_le ? Date.now() - new Date(p.dernier_robinet_le).getTime() : Infinity;
      if (depuis < config.robinetDelaiMinutes * 60_000) {
        const reste = Math.ceil((config.robinetDelaiMinutes * 60_000 - depuis) / 60_000);
        throw refus(429, 'ROBINET_TROP_TOT', `le robinet rouvre dans ${reste} min`);
      }
      await db.query(`update public.profiles set dernier_robinet_le = now() where id = $1`, [userId]);
      const ref = `${userId}:${Date.now()}`;
      try {
        // Aucun `userId` sur l'operation : le guetteur doit la voir comme un DEPOT.
        const r = await chaine.executer({
          operations: [{ type: 'frappe', vers: p.adresse_depot, mint: 'usdc', montant: config.robinetMicros, objet: 'robinet', ref, metadata: { userId } }],
        });
        const vus = await releverDepots(db, { userId, adresse: p.adresse_depot });
        if (vus.some((v) => !v.deja)) { publier('depot', { n: 1 }); invaliderStats(); }
        return { signature: r.signature, montant: config.robinetMicros, lien: lienExplorateur(r.signature), solde: await solde(db, compte.joueur(userId)) };
      } catch (e) {
        await db.query(`update public.profiles set dernier_robinet_le = null where id = $1`, [userId]);
        if (e instanceof ChaineEchouee || e instanceof ChaineIncertaine) throw refus(502, e.code, e.message);
        throw e;
      }
    },

    /** Le catalogue de la boutique, sans jeton : les prix se lisent avant de se connecter. */
    'GET /boutique': async () => ({ articles: catalogue(), suivi: LIEN_SUIVI, destination: 'burn' }),

    /**
     * Achete un skin. Le navigateur dit UN ARTICLE, jamais un prix : le prix est ici.
     * L'argent va du wallet de jeu du joueur au wallet des FRAIS, et brule du BG au tour
     * suivant — c'est la promesse de la boutique, tenue par la destination du virement.
     */
    'POST /boutique/acheter': async (req) => {
      const userId = await joueurDe(req);
      const { article } = await corps(req);
      if (typeof article !== 'string' || !/^[a-z0-9-]{1,40}$/.test(article)) throw refus(400, 'ARTICLE_INVALIDE', 'identifiant d\'article attendu');
      let r;
      try { r = await acheter(db, chaine, { userId, article }); }
      catch (e) {
        if (e.code === 'ARTICLE_INCONNU') throw refus(404, e.code, e.message);
        if (e.code === 'SOLDE_INSUFFISANT' || e.code === 'CHAINE_REFUS') throw refus(402, e.code, e.message);
        throw e;
      }
      publier('boutique', { article, prix: r.prix, statut: r.statut });
      invaliderStats();
      return { ...r, possessions: await possessions(db, userId), lien: r.signature ? lienExplorateur(r.signature) : null };
    },

    /** Ce qu'un joueur possede, pour le serveur de jeu : un skin paye se porte, les autres non. */
    'POST /interne/possessions': interne('possessions', async ({ userId }) => {
      if (!uuid.test(userId ?? '')) throw refus(400, 'ID_INVALIDE', 'identifiant de joueur invalide');
      return { possessions: await possessions(db, userId) };
    }),

    /** Releve les depots arrives. Appele par le lobby quand le joueur regarde. */
    'POST /depots/relever': async (req) => {
      const userId = await joueurDe(req);
      const p = (await db.query('select adresse_depot from public.profiles where id = $1', [userId])).rows[0];
      const vus = await releverDepots(db, { userId, adresse: p.adresse_depot });
      const nouveaux = vus.filter((v) => !v.deja);
      if (nouveaux.length) { publier('depot', { n: nouveaux.length }); invaliderStats(); }
      return { nouveaux, solde: await solde(db, compte.joueur(userId)) };
    },

    /** Demande un retrait vers le wallet lie. La destination n'est jamais un parametre. */
    'POST /retrait': async (req) => {
      const userId = await joueurDe(req);
      const { montant } = await corps(req);
      if (!Number.isInteger(montant) || montant <= 0) throw refus(400, 'MONTANT_INVALIDE', 'montant en micros attendu');
      const r = await demander(db, { userId, montant });
      publier('retrait', { statut: 'demande' });
      return { id: r.id, montant: r.montant, destination: r.destination, solde: r.solde };
    },

    /** Les retraits du joueur, avec leur signature quand elle existe. */
    'GET /retraits': async (req) => {
      const userId = await joueurDe(req);
      const r = await db.query(
        `select id, amount_micros::text as montant, destination, statut, signature, demande_le, clos_le, raison_echec
           from public.withdrawals where user_id = $1 order by demande_le desc limit 50`, [userId],
      );
      return { retraits: r.rows.map((l) => ({ ...l, montant: Number(l.montant), lien: l.signature ? lienExplorateur(l.signature) : null })) };
    },

    /**
     * L'historique du joueur : chaque ligne du livre, et la transaction qui la prouve
     * quand il y en a une. Un depot EST son hache ; une mise, un gain, une mise rendue,
     * un retrait ont leur ligne dans `chain_tx`.
     */
    'GET /historique': async (req) => {
      const userId = await joueurDe(req);
      const r = await db.query(
        `select e.cree_le, t.genre, e.amount_micros::text as montant, t.metadata, t.ref
           from public.ledger_entries e join public.ledger_tx t on t.id = e.tx_id
          where e.compte = $1 order by e.id desc limit 60`,
        [compte.joueur(userId)],
      );
      const chaine_ = (await db.query(
        `select objet, ref, signature, statut from public.chain_tx where user_id = $1 and signature is not null`, [userId],
      )).rows;
      const parCle = new Map(chaine_.map((c) => [`${c.objet}:${c.ref}`, c]));
      const OBJET = { mise: 'mise', gain: 'gain', mise_rendue: 'annulation', retrait: 'retrait', achat: 'achat' };
      const lignes = r.rows.map((l) => {
        let signature = null;
        if (l.genre === 'depot' && !l.ref?.startsWith('test:')) signature = l.ref;
        else if (OBJET[l.genre]) {
          const ref = l.genre === 'retrait' || l.genre === 'achat' ? l.ref : `${l.metadata?.matchId}:${userId}`;
          const c = parCle.get(`${OBJET[l.genre]}:${ref}`);
          if (c?.statut === 'confirme') signature = c.signature;
        }
        return {
          cree_le: l.cree_le, genre: l.genre, montant: Number(l.montant),
          partie: l.metadata?.matchId ?? null, mode: l.metadata?.mode ?? null, issue: l.metadata?.issue ?? null, article: l.metadata?.article ?? null,
          signature, lien: signature ? lienExplorateur(signature) : null,
        };
      });
      return { lignes };
    },

    /** Sans authentification : TOUT le bareme, pour que le lobby puisse l'afficher. */
    'GET /bareme': async () => ({
      modes: ORDRE_MODES.map((id) => ({
        ...MODES[id],
        issues: ISSUES[id].map((v) => ({
          id: v.id, nom: v.nom, poids: v.poids,
          tables: Object.fromEntries(PALIERS.map((u) => [u, table(u * MICROS, id, v.id)])),
        })),
        esperance: Object.fromEntries(PALIERS.map((u) => [u, esperance(u * MICROS, id)])),
        roues: Object.fromEntries(PALIERS.map((u) => [u,
          Array.from({ length: MODES[id].joueurs }, (_, r) => roueDe(id, r + 1, u * MICROS))])),
        grades: Array.from({ length: MODES[id].joueurs }, (_, r) => grade(id, r + 1)),
      })),
      paliers: PALIERS,
    }),

    /** Les statistiques publiques du jeu et du jeton. */
    'GET /stats': async () => statistiques(db, chaine),

    /** La derniere verification livre ↔ chaine ; `?maintenant=1` en relance une. */
    'GET /verification': async (req) => {
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('maintenant') === '1' && chaine) {
        const v = await verifierChaine(db, chaine);
        poserVerification(v);
        invaliderStats();
        return v;
      }
      return (await statistiques(db, chaine)).verification ?? { ok: null, message: 'pas encore verifie' };
    },

    'GET /sante': async () => ({
      ok: true, reseau: config.reseau, chainId: config.chainId, chaine: chaine ? (chaine.reelle ? 'reelle' : 'factice') : 'absente',
      serveurDeJeu: Boolean(config.serveurPublique), jeton: Boolean(config.bgAdresse), lot: Boolean(config.lotAdresse),
      caisse: tresorerie.adresses().caisse,
    }),

    // ------------------------------------------------------------ le serveur de jeu

    /** Le serveur de jeu verifie au demarrage que sa cle est bien celle qu'on attend. */
    'POST /interne/ping': interne('ping', async () => ({ ok: true, reseau: config.reseau })),

    /** Les soldes de plusieurs joueurs : pour refuser une file a qui ne peut pas la payer. */
    'POST /interne/soldes': interne('soldes', async ({ userIds }) => {
      if (!Array.isArray(userIds) || userIds.length > 64) throw refus(400, 'LISTE_INVALIDE', 'au plus 64 identifiants');
      const soldes = {};
      for (const id of userIds) {
        if (!uuid.test(id)) throw refus(400, 'ID_INVALIDE', 'identifiant de joueur invalide');
        soldes[id] = await solde(db, compte.joueur(id));
      }
      return { soldes };
    }),

    /**
     * Engage les mises d'une partie qui va partir. Rend qui est engage, ou l'annulation.
     *
     * Le mode et la mise viennent du salon du serveur de jeu : c'est LUI qui sera regle,
     * quoi que le client ait cru demander.
     */
    'POST /interne/partie/engager': interne('engager', async ({ partie, mode: modeId, mise, joueurs }) => {
      if (!idPartie.test(String(partie ?? ''))) throw refus(400, 'PARTIE_INVALIDE', 'identifiant de partie invalide');
      if (!PALIERS.includes(mise / MICROS)) throw refus(400, 'MISE_HORS_CATALOGUE', `tables ouvertes : ${PALIERS.join(', ')} USDC`);
      try { mode(modeId); } catch (e) { throw refus(400, 'TABLE_INCONNUE', e.message); }
      if (!Array.isArray(joueurs) || !joueurs.every((j) => uuid.test(j.userId ?? ''))) {
        throw refus(400, 'JOUEURS_INVALIDES', 'chaque joueur porte un userId');
      }
      let r;
      try {
        r = await engagerPartie(db, chaine, { partie, mode: modeId, mise, joueurs });
      } catch (e) {
        if (e.code === 'PARTIE_CLOSE') throw refus(409, e.code, e.message);
        throw e;
      }
      publier('partie', { partie, statut: r.annulee ? 'annulee' : 'engagee', mode: modeId, mise, effectif: joueurs.length });
      invaliderStats();
      return r;
    }),

    /**
     * Regle la partie : le rang, LE MODE, LA GRAINE ET L'EFFECTIF viennent du serveur de
     * jeu, signes. Rien ne vient plus du navigateur.
     */
    'POST /interne/partie/regler': interne('regler', async ({ partie, mode: modeId, mise, effectif, graineRoue, classement }) => {
      if (!idPartie.test(String(partie ?? ''))) throw refus(400, 'PARTIE_INVALIDE', 'identifiant de partie invalide');
      if (!PALIERS.includes(mise / MICROS)) throw refus(400, 'MISE_HORS_CATALOGUE', `tables ouvertes : ${PALIERS.join(', ')} USDC`);
      let m;
      try { m = mode(modeId); } catch (e) { throw refus(400, 'TABLE_INCONNUE', e.message); }
      if (!Number.isInteger(graineRoue) || graineRoue < 0 || graineRoue > 0xFFFFFFFF) {
        throw refus(400, 'GRAINE_IMPOSSIBLE', 'la graine de roue tient sur 32 bits');
      }
      const joueurs = effectif ?? classement?.length;
      const plancher = m.joueurs === 2 ? 2 : 3;
      if (!Number.isInteger(joueurs) || joueurs < plancher || joueurs > m.joueurs) {
        throw refus(400, 'EFFECTIF_IMPOSSIBLE', `effectif attendu entre ${plancher} et ${m.joueurs} en ${m.id}`);
      }
      if (!Array.isArray(classement) || !classement.every((c) => uuid.test(c.userId ?? '') && Number.isInteger(c.rang))) {
        throw refus(400, 'CLASSEMENT_INVALIDE', 'chaque ligne porte un userId et un rang');
      }
      let r;
      try {
        r = await regler(db, {
          matchId: partie, mise, mode: modeId, graineRoue, effectif: joueurs,
          classement: classement.map((c) => ({ userId: c.userId, rang: c.rang })),
        }, chaine);
      } catch (e) {
        if (e.code === 'PARTIE_ANNULEE' || e.code === 'POT_INCOHERENT') throw refus(409, e.code, e.message);
        throw e;
      }
      const complet = joueurs === m.joueurs;
      const issue = complet ? tirerIssue(modeId, graineRoue).id : null;
      const bareme = complet ? table(mise, modeId, issue) : tableEffectif(mise, joueurs);
      const gains = {};
      const xp = {};
      for (const c of classement) {
        gains[c.userId] = bareme.parRang[c.rang - 1] ?? 0;
        xp[c.userId] = complet ? (bareme.xp?.[c.rang - 1] ?? 0) : 0;
      }
      publier('partie', { partie, statut: 'reglee', mode: modeId, mise, effectif: joueurs, issue, pot: bareme.pot, rake: bareme.rake });
      invaliderStats();
      return { partie, deja: r.deja, issue, pot: bareme.pot, rake: bareme.rake, gains, xp, signatures: r.signatures ?? [] };
    }),

    /** Une partie qui n'aura pas lieu : chaque mise revient. */
    'POST /interne/partie/annuler': interne('annuler', async ({ partie, raison }) => {
      if (!idPartie.test(String(partie ?? ''))) throw refus(400, 'PARTIE_INVALIDE', 'identifiant de partie invalide');
      let r;
      try { r = await annulerPartie(db, chaine, { partie, raison: String(raison ?? 'annulee par le serveur de jeu').slice(0, 200) }); }
      catch (e) { if (e.code) throw refus(409, e.code, e.message); throw e; }
      publier('partie', { partie, statut: 'annulee' });
      invaliderStats();
      return r;
    }),
  };

  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, entetes()); res.end(); return; }
    const cle = `${req.method} ${new URL(req.url, 'http://x').pathname}`;

    // La page de suivi, servie telle quelle. Relue a chaque requete : c'est un fichier
    // statique de quelques kilo-octets, et un rechargement doit montrer la version a jour.
    if (cle === 'GET /suivi' || cle === 'GET /suivi/') {
      // Lire AVANT d'ecrire l'en-tete : une lecture qui echoue apres `writeHead` ne peut
      // plus repondre autre chose, et le processus tombe sur ERR_HTTP_HEADERS_SENT.
      let page = null;
      try { page = readFileSync(path.join(PUBLIC, 'suivi.html')); } catch { page = null; }
      if (!page) return json(res, 404, { erreur: 'PAGE_ABSENTE' });
      res.writeHead(200, entetes('text/html; charset=utf-8'));
      res.end(page);
      return;
    }

    // Le flux en direct : un evenement par ligne, et un signe de vie toutes les 25 s pour
    // que les proxys ne ferment pas une connexion qu'ils croient morte.
    if (cle === 'GET /stats/flux') {
      res.writeHead(200, { ...entetes('text/event-stream'), 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': bonjour\n\n');
      const arreter = souscrire((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      const vie = setInterval(() => res.write(': vie\n\n'), 25_000);
      req.on('close', () => { arreter(); clearInterval(vie); });
      return;
    }

    const route = routes[cle];
    if (!route) return json(res, 404, { erreur: 'ROUTE_INCONNUE', message: cle });

    try {
      json(res, 200, await route(req));
    } catch (e) {
      // On rend le code d'erreur, jamais la pile ni le detail interne.
      const statut = e.statut ?? (e.code ? 400 : 500);
      if (statut >= 500) console.error(`${cle} :`, e);
      json(res, statut, { erreur: e.code ?? 'ERREUR', message: e.code ? e.message : 'erreur interne' });
    }
  });
}
