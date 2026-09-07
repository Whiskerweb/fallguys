/**
 * LE LIEN AVEC ROBINHOOD CHAIN — et le JOURNAL de tout ce qu'on y envoie.
 *
 * Ce module ne connait aucune regle du jeu : il sait ouvrir une connexion, lire un solde
 * ERC-20, construire UNE transaction a partir d'une liste d'OPERATIONS (virement,
 * brulage, frappe d'essai), la signer, la diffuser, et surtout se souvenir de ce qu'il a
 * fait — parce que c'est la seule chose qui distingue « payer » de « payer deux fois ».
 *
 * ─── COMMENT UN WALLET SANS ETH PAIE ─────────────────────────────────────────
 *
 * Sur une chaine EVM, l'expediteur paie le gaz. Les wallets des joueurs et des pots sont
 * derives et n'ont pas d'ETH. Chaque virement est donc une AUTORISATION EIP-3009 : le
 * proprietaire signe hors chaine (`transferWithAuthorization`), et la CAISSE soumet la
 * transaction et paie. Le `nonce` de l'autorisation est le hache de la cle du journal
 * (objet:ref) : rejouer la meme operation est refuse par le contrat lui-meme.
 *
 * ─── UNE TRANSACTION, PLUSIEURS OPERATIONS, TOUT OU RIEN ─────────────────────
 *
 * Les operations d'un appel a `executer` passent par le contrat `Lot`, qui les enchaine
 * et annule tout si l'une echoue. Un reglement a seize joueurs tient dans une seule
 * transaction ; les mises d'une partie aussi — si une seule ne passe pas, aucune n'est
 * partie. L'index de l'appel fautif remonte dans l'erreur (`AppelRate`).
 *
 * ─── LE JOURNAL (`chain_tx`) ────────────────────────────────────────────────
 *
 * Chaque operation a une ligne, clee par `(objet, ref)`, qui passe par quatre etats :
 *
 *   prevu ──► signe ──► confirme
 *                 └────► echoue
 *
 * La ligne est ecrite en `prevu` AVANT de construire quoi que ce soit ; le hache de la
 * transaction — connu des la signature, avant la diffusion — y est ecrit AVANT d'envoyer,
 * avec le nonce de la caisse et la transaction brute. C'est le seul moyen de savoir,
 * apres un arret brutal, quelle transaction est peut-etre partie. `reprendre()` relit
 * ces lignes-la et tranche en interrogeant la chaine, jamais en re-signant a l'aveugle.
 *
 * ─── UNE OPERATION PEUT ECHOUER DE DEUX FACONS, ET CE N'EST PAS LA MEME ───
 *
 *   - `ChaineEchouee` : la simulation a echoue, le RPC a refuse a l'envoi (fonds de gaz
 *     insuffisants), ou la transaction a ete minee et a REVERT. Rien n'a bouge, c'est
 *     certain ; l'appelant peut defaire ce qu'il avait ecrit au grand livre ;
 *   - `ChaineIncertaine` : le reseau a coupe pendant la diffusion ou l'attente. La
 *     transaction est PEUT-ETRE minee. L'appelant ne doit RIEN defaire — c'est
 *     `reprendre()` qui le saura, plus tard, en relisant la chaine.
 *
 * Confondre les deux, c'est rembourser une mise qui est bel et bien partie.
 *
 * La doublure de test, `factice.js`, offre la meme interface sur une chaine en memoire :
 * les tests du grand livre exercent les MEMES chemins de code, journal compris.
 */

import { randomUUID } from 'node:crypto';
import {
  JsonRpcProvider, Contract, Interface, AbiCoder, Signature, TypedDataEncoder, keccak256, toUtf8Bytes, getAddress, isAddress,
} from 'ethers';
import { config } from '../config.js';
import { tresorerie } from './tresorerie.js';
import { RESEAUX } from './reseaux.js';

/** USDC et BG ont six decimales : la meme echelle que nos micros. */
export const DECIMALES = { usdc: 6, bg: 6 };

/**
 * Au-dela, une transaction devient longue a simuler et chere a soumettre. Un reglement
 * d'arene (quinze gains, un rake) tient dans un seul lot ; une annulation aussi.
 */
export const OPERATIONS_PAR_TRANSACTION = 20;

/** Passe ce delai sans recu, on ne sait plus : `ChaineIncertaine`, et la reprise tranchera. */
const DELAI_CONFIRMATION_MS = 90_000;
/** Une autorisation signee vaut une heure : assez pour une reprise, pas pour un rejeu lointain. */
const VALIDITE_AUTORISATION_S = 3600;
/** Une transaction signee et jamais minee depuis ce delai est REMPLACEE (voir `reprendre`). */
const DELAI_REMPLACEMENT_MS = 10 * 60_000;

export class ChaineEchouee extends Error {
  constructor(message, detail = {}) { super(message); this.code = 'CHAINE_ECHOUEE'; Object.assign(this, detail); }
}
export class ChaineIncertaine extends Error {
  constructor(message, detail = {}) { super(message); this.code = 'CHAINE_INCERTAINE'; Object.assign(this, detail); }
}

export const ABI_JETON = [
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function burnWithAuthorization(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function frapper(address to, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
export const ABI_LOT = [
  'function executer((address cible, bytes donnees)[] appels)',
  'function proprietaire() view returns (address)',
  'error AppelRate(uint256 index, bytes raison)',
];
export const SUJET_TRANSFERT = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'));

let _connexion = null;
export function connexion() {
  if (!_connexion) {
    if (!config.rpc) throw new Error(`aucun RPC pour le reseau « ${config.reseau} »`);
    /*
     * `cacheTimeout: -1` : ethers met en cache 250 ms les reponses identiques, dont le
     * nonce de la caisse. Deux transactions signees a la suite recevaient le MEME nonce,
     * et la seconde etait refusee (« nonce too low »). Vu sur anvil, au premier cycle.
     */
    _connexion = new JsonRpcProvider(config.rpc, config.chainId || undefined, { staticNetwork: Boolean(config.chainId), cacheTimeout: -1 });
  }
  return _connexion;
}

/** L'adresse du contrat d'une devise, par son nom court. `bg` peut ne pas exister encore. */
export function contratDe(quoi) {
  if (quoi === 'usdc') {
    if (!config.usdcAdresse) throw new Error('USDC_ADRESSE absente : lancez « node outils/contrats.mjs »');
    return getAddress(config.usdcAdresse);
  }
  if (quoi === 'bg') {
    if (!config.bgAdresse) throw new Error('BG_ADRESSE absente : lancez « node outils/contrats.mjs »');
    return getAddress(config.bgAdresse);
  }
  throw new Error(`devise inconnue « ${quoi} »`);
}

const jetons = new Map();
export function jeton(quoi) {
  if (!jetons.has(quoi)) jetons.set(quoi, new Contract(contratDe(quoi), ABI_JETON, connexion()));
  return jetons.get(quoi);
}

/*
 * Le domaine EIP-712 d'un jeton se LIT sur le contrat, et se VERIFIE : le nom vient de
 * `name()`, la version de `version()` quand elle existe (le notre repond « 1 », l'USDC de
 * Circle « 2 ») — mais l'USDG de Paxos n'a pas de `version()`. On calcule donc le
 * separateur de domaine pour chaque version plausible et on garde celle qui redonne
 * `DOMAIN_SEPARATOR()` tel que le contrat le publie. Signer avec un domaine devine
 * donnerait une autorisation que le contrat refuse, et l'erreur ne dirait pas pourquoi.
 */
const domaines = new Map();
async function domaineDe(quoi) {
  if (domaines.has(quoi)) return domaines.get(quoi);
  const j = jeton(quoi);
  const adresse = contratDe(quoi);
  const [name, versionLue, separateur] = await Promise.all([
    j.name(), j.version().catch(() => null), j.DOMAIN_SEPARATOR().catch(() => null),
  ]);
  const candidates = [versionLue, '1', '2', '3'].filter((v, i, t) => v && t.indexOf(v) === i);
  let d = null;
  for (const version of candidates) {
    const essai = { name, version, chainId: config.chainId, verifyingContract: adresse };
    if (!separateur || TypedDataEncoder.hashDomain(essai) === separateur) { d = essai; break; }
  }
  if (!d) throw new Error(`domaine EIP-712 de ${quoi} introuvable : aucune version ne redonne DOMAIN_SEPARATOR ${separateur}`);
  domaines.set(quoi, d);
  return d;
}

/** Solde en micros. Un compte neuf vaut 0 : c'est l'etat normal, pas une erreur. */
export async function soldeJetons(proprietaire, quoi = 'usdc') {
  if (!isAddress(proprietaire)) return 0;
  return Number(await jeton(quoi).balanceOf(proprietaire));
}

/** L'offre en circulation d'un jeton, en micros. */
export async function offreDe(quoi) {
  const j = jeton(quoi);
  const [offre, decimales] = await Promise.all([j.totalSupply(), j.decimals()]);
  return { offre: Number(offre), decimales: Number(decimales), frappable: quoi === 'usdc' && config.reseau !== 'mainnet' };
}

/** Un lien vers l'explorateur, pour les journaux et la page de suivi. `null` sans explorateur (anvil). */
export function lienExplorateur(hache, reseau = config.reseau) {
  const base = RESEAUX[reseau]?.explorateur;
  if (!base || !hache) return null;
  return `${base}/tx/${String(hache).split('#')[0]}`;
}
export function lienAdresse(adresse, reseau = config.reseau) {
  const base = RESEAUX[reseau]?.explorateur;
  if (!base || !adresse) return null;
  return `${base}/address/${adresse}`;
}

/** Le nonce d'une autorisation : la cle du journal, hachee. Le contrat refuse un nonce deja vu. */
export const nonceDe = (objet, ref) => keccak256(toUtf8Bytes(`${objet}:${ref}`));

// ---------------------------------------------------------------- le journal

/**
 * Ouvre (ou retrouve) la ligne de journal de chaque operation.
 *
 * @returns {Promise<Array<{id: string, statut: string, signature: string|null}>>} dans
 *   l'ordre des operations
 */
export async function ouvrirJournal(db, operations) {
  const lignes = [];
  for (const op of operations) {
    if (!op.objet || !op.ref) throw new Error('operation sans objet ou sans ref : pas de journal, pas de transaction');
    await db.query(
      `insert into public.chain_tx (id, objet, ref, de, vers, mint, montant, partie, user_id, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (objet, ref) do nothing`,
      [randomUUID(), op.objet, op.ref,
        op.de?.address ?? null,
        op.vers ?? null,
        op.mint ?? null, op.montant ?? 0, op.partie ?? null, op.userId ?? null,
        JSON.stringify(op.metadata ?? {})],
    );
    const r = await db.query(
      `select id, statut, signature from public.chain_tx where objet = $1 and ref = $2`, [op.objet, op.ref],
    );
    lignes.push(r.rows[0]);
  }
  return lignes;
}

export async function marquer(db, ids, statut, { signature = null, nonce = null, brute = null, raison = null } = {}) {
  if (!ids.length) return;
  await db.query(
    `update public.chain_tx
        set statut = $2,
            signature = coalesce($3, signature),
            nonce = coalesce($4, nonce),
            tx_brute = coalesce($5, tx_brute),
            raison_echec = coalesce($6, raison_echec),
            soumis_le = case when $2 = 'signe' then now() else soumis_le end,
            clos_le = case when $2 in ('confirme', 'echoue', 'inutile') then now() else clos_le end
      where id = any($1::uuid[])`,
    [ids, statut, signature, nonce, brute, raison],
  );
}

/**
 * Ouvre le journal et ne garde que ce qui reste a faire.
 *
 * Un lot peut melanger des operations deja confirmees (une annulation rejouee apres un
 * premier retour reussi) et des neuves : on n'envoie que les neuves. Rejouer une operation
 * confirmee, c'est payer deux fois — c'est exactement ce que le journal existe pour empecher.
 * Une operation en suspens (« signe ») bloque le lot : on ne re-signe pas par-dessus.
 */
export async function trier(db, operations) {
  const lignes = await ouvrirJournal(db, operations);
  const suspendues = lignes.filter((l) => l.statut === 'signe');
  if (suspendues.length) {
    throw new ChaineIncertaine('une transaction precedente est peut-etre partie ; reprise necessaire',
      { signature: suspendues[0].signature });
  }
  const restantes = operations.filter((_, i) => lignes[i].statut !== 'confirme');
  return { lignes, restantes };
}

/** Un verrou : une transaction de la caisse a la fois, pour que les nonces se suivent. */
function verrou() {
  let file = Promise.resolve();
  return (travail) => {
    const tour = file.then(travail, travail);
    file = tour.catch(() => {});
    return tour;
  };
}

/** Le texte d'une raison de revert (Error(string)), ou son hexadecimal brut. */
export function raisonDe(donnees) {
  if (!donnees || donnees === '0x') return 'sans raison';
  try {
    if (donnees.startsWith('0x08c379a0')) return AbiCoder.defaultAbiCoder().decode(['string'], '0x' + donnees.slice(10))[0];
  } catch { /* pas un Error(string) */ }
  return donnees.slice(0, 80);
}

// ---------------------------------------------------------------- la chaine

/**
 * La chaine REELLE.
 *
 * @param {object} p
 * @param {{query: Function}} p.db  pour le journal
 * @param {(evenement: object) => void} [p.surEvenement] prevenu a chaque confirmation —
 *   c'est par la que la page de suivi apprend qu'une transaction vient de passer
 */
export function creerChaine({ db, surEvenement = null }) {
  const co = connexion();
  const unParUn = verrou();
  const interfaceLot = new Interface(ABI_LOT);
  const interfaceJeton = new Interface(ABI_JETON);
  const TYPES_VIREMENT = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ],
  };
  const TYPES_BRULAGE = {
    BurnWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ],
  };

  function lot() {
    if (!config.lotAdresse) throw new Error('LOT_ADRESSE absente : lancez « node outils/contrats.mjs »');
    return new Contract(getAddress(config.lotAdresse), ABI_LOT, tresorerie.caisse().connect(co));
  }

  /** L'appel (cible, donnees) qui realise une operation — signe par son proprietaire s'il le faut. */
  async function appelDe(op) {
    const quoi = op.mint ?? 'usdc';
    const cible = contratDe(quoi);
    const montant = BigInt(op.montant);
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + VALIDITE_AUTORISATION_S);
    const nonce = nonceDe(op.objet, op.ref);

    if (op.type === 'virement') {
      if (!isAddress(op.vers)) throw new ChaineEchouee(`destination invalide « ${op.vers} »`);
      const valeurs = { from: op.de.address, to: getAddress(op.vers), value: montant, validAfter, validBefore, nonce };
      const sig = Signature.from(await op.de.signTypedData(await domaineDe(quoi), TYPES_VIREMENT, valeurs));
      return { cible, donnees: interfaceJeton.encodeFunctionData('transferWithAuthorization', [
        valeurs.from, valeurs.to, montant, validAfter, validBefore, nonce, sig.v, sig.r, sig.s]) };
    }
    if (op.type === 'brulage') {
      const valeurs = { from: op.de.address, value: montant, validAfter, validBefore, nonce };
      const sig = Signature.from(await op.de.signTypedData(await domaineDe(quoi), TYPES_BRULAGE, valeurs));
      return { cible, donnees: interfaceJeton.encodeFunctionData('burnWithAuthorization', [
        valeurs.from, montant, validAfter, validBefore, nonce, sig.v, sig.r, sig.s]) };
    }
    if (op.type === 'frappe') {
      // USDC d'essai seulement : le proprietaire du contrat est le Lot, donc la caisse.
      if (config.reseau === 'mainnet') throw new ChaineEchouee('on ne frappe pas de vrai USDC');
      return { cible, donnees: interfaceJeton.encodeFunctionData('frapper', [getAddress(op.vers), montant]) };
    }
    throw new Error(`operation inconnue « ${op.type} »`);
  }

  /** Un echec a l'ENVOI est-il definitif (rien n'est parti) ? Sinon, on ne sait pas. */
  const definitif = (e) => ['INSUFFICIENT_FUNDS', 'CALL_EXCEPTION', 'UNPREDICTABLE_GAS_LIMIT', 'INVALID_ARGUMENT'].includes(e?.code)
    || /insufficient funds|intrinsic gas|exceeds block gas limit|invalid sender/i.test(String(e?.message ?? ''));

  /** L'erreur d'une simulation ratee, lisible : quel appel, et pourquoi. */
  function echecDeSimulation(e) {
    const donnees = e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? null;
    if (typeof donnees === 'string') {
      try {
        const err = interfaceLot.parseError(donnees);
        if (err?.name === 'AppelRate') {
          const index = Number(err.args[0]);
          return new ChaineEchouee(`appel ${index} refuse : ${raisonDe(err.args[1])}`, { index });
        }
      } catch { /* pas une erreur du Lot */ }
      return new ChaineEchouee(`simulation refusee : ${raisonDe(donnees)}`);
    }
    return new ChaineEchouee(`simulation refusee : ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}`);
  }

  return {
    reelle: true,
    reseau: config.reseau,

    solde: (proprietaire, quoi = 'usdc') => soldeJetons(proprietaire, quoi),
    offre: (quoi) => offreDe(quoi),

    /**
     * Execute une liste d'operations dans UNE transaction — atomique, donc.
     *
     * @returns {Promise<{signature: string, deja: boolean}>}
     */
    async executer({ operations }) {
      if (!operations.length) throw new Error('executer : aucune operation');
      if (operations.length > OPERATIONS_PAR_TRANSACTION) throw new Error(`executer : ${operations.length} operations, au plus ${OPERATIONS_PAR_TRANSACTION} par transaction`);
      const { lignes, restantes } = await trier(db, operations);
      if (!restantes.length) return { signature: lignes[0].signature, deja: true };
      operations = restantes;
      const ids = lignes.filter((l) => l.statut !== 'confirme').map((l) => l.id);

      const appels = [];
      for (const op of operations) appels.push(await appelDe(op));

      return unParUn(async () => {
        const contrat = lot();
        const caisse = tresorerie.caisse().connect(co);

        // 1. LA SIMULATION. Un lot qui echoue ici n'a rien coute et rien deplace.
        let requete;
        try {
          const gas = await contrat.executer.estimateGas(appels);
          const { to, data } = await contrat.executer.populateTransaction(appels);
          requete = await caisse.populateTransaction({ to, data, gasLimit: (gas * 13n) / 10n });
        } catch (e) {
          const echec = definitif(e) || e?.code === 'CALL_EXCEPTION' || typeof (e?.data ?? e?.info?.error?.data) === 'string'
            ? echecDeSimulation(e)
            : null;
          if (!echec) throw new ChaineIncertaine(`RPC muet a la simulation : ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`);
          await marquer(db, ids, 'echoue', { raison: echec.message.slice(0, 500) });
          throw echec;
        }

        // 2. LA SIGNATURE D'ABORD, LA DIFFUSION ENSUITE.
        const brute = await caisse.signTransaction(requete);
        const signature = keccak256(brute);
        await marquer(db, ids, 'signe', { signature, nonce: Number(requete.nonce), brute });

        try {
          await co.broadcastTransaction(brute);
        } catch (e) {
          if (definitif(e)) {
            await marquer(db, ids, 'echoue', { raison: String(e?.shortMessage ?? e?.message).slice(0, 500) });
            throw new ChaineEchouee(`refusee a l'envoi : ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`, { signature });
          }
          // Reseau coupe pendant la diffusion : on ne SAIT PAS. On laisse en « signe ».
          throw new ChaineIncertaine(`diffusion interrompue : ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`, { signature });
        }

        // 3. LE RECU.
        let recu;
        try {
          recu = await co.waitForTransaction(signature, 1, DELAI_CONFIRMATION_MS);
        } catch (e) {
          throw new ChaineIncertaine(`confirmation interrompue : ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`, { signature });
        }
        if (!recu) throw new ChaineIncertaine('pas de recu dans le delai', { signature });
        if (recu.status !== 1) {
          await marquer(db, ids, 'echoue', { raison: 'minee et annulee par la chaine (revert)' });
          throw new ChaineEchouee('rejetee par la chaine : la transaction a revert', { signature });
        }

        await marquer(db, ids, 'confirme');
        surEvenement?.({ signature, operations: operations.map((o) => ({ objet: o.objet, ref: o.ref, montant: o.montant, mint: o.mint ?? 'usdc' })) });
        return { signature, deja: false };
      });
    },

    /**
     * Tranche les lignes laissees en suspens par un arret, EN RELISANT LA CHAINE.
     *
     * Un recu dit tout : minee et reussie, ou minee et annulee. Sans recu, la transaction
     * est encore en attente — ou ne sera jamais minee. Ce qui le dit, c'est le NONCE de la
     * caisse : si son compteur a depasse celui de la transaction, une autre l'a consomme
     * et celle-ci ne passera plus jamais. Sinon, on la rediffuse ; et passe dix minutes,
     * on la REMPLACE par une transaction vide au meme nonce, plus chere, pour la rendre
     * impossible — c'est la seule facon de pouvoir dire « echoue » sans mentir.
     *
     * @param {{echoue?: (ligne: object) => Promise<void>, confirme?: (ligne: object) => Promise<void>}} gestionnaires
     */
    async reprendre(gestionnaires = {}) {
      const bilan = { confirmees: 0, echouees: 0, enAttente: 0 };
      const signees = await db.query(`select * from public.chain_tx where statut = 'signe' order by soumis_le`);
      const parSignature = new Map();
      for (const l of signees.rows) {
        if (!parSignature.has(l.signature)) parSignature.set(l.signature, []);
        parSignature.get(l.signature).push(l);
      }
      for (const [signature, lignes] of parSignature) {
        const ids = lignes.map((l) => l.id);
        const recu = await co.getTransactionReceipt(signature).catch(() => null);
        if (recu?.status === 1) {
          await marquer(db, ids, 'confirme');
          bilan.confirmees += lignes.length;
          for (const l of lignes) await gestionnaires.confirme?.(l);
          continue;
        }
        if (recu && recu.status !== 1) {
          await marquer(db, ids, 'echoue', { raison: 'minee et annulee par la chaine (revert)' });
          bilan.echouees += lignes.length;
          for (const l of lignes) await gestionnaires.echoue?.(l);
          continue;
        }
        // Pas de recu. Le nonce dit si elle peut encore passer.
        const nonce = lignes[0].nonce === null ? null : Number(lignes[0].nonce);
        const caisse = tresorerie.caisse().connect(co);
        const compteur = await co.getTransactionCount(caisse.address, 'latest').catch(() => null);
        if (nonce !== null && compteur !== null && compteur > nonce) {
          await marquer(db, ids, 'echoue', { raison: 'jamais minee : son nonce a ete consomme par une autre transaction' });
          bilan.echouees += lignes.length;
          for (const l of lignes) await gestionnaires.echoue?.(l);
          continue;
        }
        const age = Date.now() - new Date(lignes[0].soumis_le ?? lignes[0].cree_le).getTime();
        if (nonce !== null && age > DELAI_REMPLACEMENT_MS) {
          // On la rend impossible : une transaction vide, meme nonce, frais doubles.
          try {
            await unParUn(async () => {
              const frais = await co.getFeeData();
              const r = await caisse.sendTransaction({
                to: caisse.address, value: 0n, nonce, gasLimit: 21_000n,
                maxFeePerGas: frais.maxFeePerGas ? frais.maxFeePerGas * 3n : undefined,
                maxPriorityFeePerGas: frais.maxPriorityFeePerGas ? frais.maxPriorityFeePerGas * 3n : undefined,
              });
              await r.wait(1, DELAI_CONFIRMATION_MS);
            });
          } catch { /* on retentera au tour suivant */ }
          bilan.enAttente += lignes.length;
          continue;
        }
        // Peut-etre jamais arrivee au RPC : on la rediffuse telle quelle (meme hache).
        if (lignes[0].tx_brute) await co.broadcastTransaction(lignes[0].tx_brute).catch(() => {});
        bilan.enAttente += lignes.length;
      }

      // Prevues et jamais signees : le processus est tombe avant de construire quoi que ce
      // soit. Rien n'est parti ; on le dit au domaine, qui rend ce qu'il avait reserve.
      const orphelines = await db.query(
        `select * from public.chain_tx where statut = 'prevu' and cree_le < now() - interval '2 minutes'`,
      );
      for (const l of orphelines.rows) {
        await marquer(db, [l.id], 'echoue', { raison: 'jamais signee' });
        bilan.echouees++;
        await gestionnaires.echoue?.(l);
      }
      return bilan;
    },
  };
}
