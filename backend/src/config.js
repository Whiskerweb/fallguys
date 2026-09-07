/**
 * La configuration, lue dans l'environnement — jamais ecrite dans le depot.
 *
 * Deux categories de valeurs, et la distinction compte :
 *
 *   - les SECRETS (`GRAINE_DEPOTS`, `CAISSE_CLE`, `SUPABASE_SERVICE_ROLE`) : ils ne
 *     doivent apparaitre ni dans git, ni dans un journal, ni dans une reponse HTTP.
 *     Sur le testnet ils ne gardent rien ; en mainnet, `CAISSE_CLE` EST le systeme. On
 *     les traite des maintenant comme s'ils valaient quelque chose, pour que l'habitude
 *     soit prise avant que ce soit vrai ;
 *
 *   - les REGLAGES (adresses des contrats, reseau, minimums) : dans l'environnement eux
 *     aussi, pour que le passage testnet -> mainnet soit un changement de configuration
 *     et non une chasse aux valeurs ecrites en dur dans le code.
 *
 * Le fichier `.env` de la racine est deja ignore par git, avec une exception pour
 * `.env.example`. Les nouvelles variables y sont declarees a vide.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MICROS } from './argent.js';
import { RESEAUX } from './robinhood/reseaux.js';

/*
 * Le `.env` de la racine est charge ICI, sans rien ecraser : une variable deja posee dans
 * l'environnement gagne. « set -a && source ../.env » reste possible, mais plus
 * obligatoire — c'est l'etape qu'on oublie, et l'oubli se paie en « configuration
 * incomplete » au demarrage.
 */
const ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(ENV)) {
  for (const ligne of readFileSync(ENV, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = /^(["']).*\1$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
  }
}

const lire = (nom, defaut = undefined) => {
  const v = process.env[nom];
  if (v === undefined || v === '') {
    if (defaut === undefined) return null;
    return defaut;
  }
  return v;
};

const reseau = lire('ROBINHOOD_RESEAU', 'testnet');
const parametres = RESEAUX[reseau] ?? RESEAUX.testnet;

export const config = {
  // ---- chaine ----
  /** `testnet` par defaut. `mainnet` un jour ; `local` (anvil) et `factice` pour les bancs. */
  reseau,
  rpc: lire('ROBINHOOD_RPC', parametres.rpc ?? ''),
  chainId: Number(lire('ROBINHOOD_CHAIN_ID', String(parametres.chainId))),

  /**
   * Les CONTRATS. Trois adresses, toutes en variables et jamais en constantes : le
   * mainnet ne doit demander qu'un changement ici.
   *
   *   - USDG_ADRESSE : le jeton dans lequel on mise. Sur le testnet, c'est NOTRE jeton
   *     d'essai (`USDGTest`, frappable) ; sur mainnet, le vrai ;
   *   - BG_ADRESSE   : Baby Guy, cree par `outils/contrats.mjs` : 1 milliard, sans frappe ;
   *   - LOT_ADRESSE  : l'executeur de lot, qui rend un reglement atomique.
   */
  usdgAdresse: lire('USDG_ADRESSE'),
  bgAdresse: lire('BG_ADRESSE'),
  lotAdresse: lire('LOT_ADRESSE'),

  /**
   * LE NOM DU DOLLAR. Le jeu est ecrit en « USDG » ; sur Robinhood Chain mainnet, le dollar
   * natif est l'USDG de Paxos (« Global Dollar », six decimales, EIP-3009 — on l'a
   * verifie sur son contrat), et c'est lui que `USDG_ADRESSE` designe alors. Le symbole
   * part vers le navigateur, qui renomme ce qu'il affiche : on ne fait pas miser des
   * USDG a quelqu'un en lui ecrivant USDG.
   */
  stableSymbole: lire('STABLE_SYMBOLE', 'USDG'),

  /**
   * LES AUTRES PORTES D'ENTREE DE L'ARGENT (5 septembre 2026) : USDG, et l'ETH du wallet.
   *
   * Demande du directeur produit : un joueur qui n'a que de l'ETH ne doit pas aller
   * chercher des USDG ailleurs avant de jouer. Le grand livre, lui, reste en USDG et rien
   * d'autre : le wallet de jeu doit detenir des USDG pour que la mise parte (EIP-3009
   * sur le contrat USDG). Le CHANGE se fait donc dans le wallet DU JOUEUR, avant que
   * l'argent arrive :
   * le navigateur appelle un routeur de DEX (interface Uniswap V2) avec l'adresse de
   * depot comme DESTINATION du swap, et le guetteur voit arriver des USDG ordinaires.
   * Aucun chemin nouveau ici, aucune reserve a tenir, aucun risque de change pour la
   * maison. Voir `tools/feel-lab/src/compte.js:deposerParSwap`.
   *
   * Deux adresses, publiees au navigateur par `GET /moi` → `chaine.swap`. VIDES sur le
   * testnet : il n'y a pas de marche ETH/USDG sur Robinhood Chain testnet, et le guide
   * de depot le dit au lieu de proposer un bouton qui echouerait. Sur mainnet, les
   * renseigner suffit (un routeur a l'interface Uniswap V2 et son WETH).
   */
  swapRouteur: lire('SWAP_ROUTEUR_ADRESSE'),
  swapWeth: lire('SWAP_WETH_ADRESSE'),

  /**
   * Cle de la CAISSE, en hexadecimal (0x…, 32 octets) : le payeur de GAZ de toutes les
   * transactions du service, et le proprietaire des contrats. Elle ne detient pas les
   * USDG des joueurs — chacun les garde sur son propre wallet derive — mais elle soumet
   * chaque transaction et paie chaque frais : elle reste LE secret.
   */
  caisseCle: lire('CAISSE_CLE'),

  /**
   * Les wallets de TRESORERIE, generes par `outils/tresorerie.mjs` et notes dans
   * `wallets/<reseau>.json` (ignore par git) :
   *
   *   - FRAIS : recoit le rake de chaque partie, sur la chaine. C'est le wallet que la
   *     page de suivi montre comme « frais », et celui que le brulage vide ;
   *   - POOL  : la liquidite BG/USDG. Sur le testnet il n'existe aucun marche pour un
   *     jeton neuf, donc le service tient lui-meme une reserve a produit constant, dont
   *     les soldes ON-CHAIN fixent le prix. Sur mainnet, ce wallet s'efface derriere un
   *     routeur de DEX et une vraie paire : voir `robinhood/brulage.js`.
   */
  fraisCle: lire('FRAIS_CLE'),
  poolCle: lire('POOL_CLE'),

  /**
   * La cle PUBLIQUE du serveur de jeu. Un resultat de partie n'est accepte que signe par
   * la cle secrete correspondante (`SERVEUR_CLE`, cote serveur de jeu). Sans elle, le
   * backend refuse tout reglement : il n'y a plus de chemin non signe.
   */
  serveurPublique: lire('SERVEUR_PUBLIQUE'),

  /**
   * Le brulage : des que le wallet des frais detient au moins `brulageSeuil` USDG, on
   * achete des BG avec et on les brule. Le seuil evite de payer une transaction pour
   * quelques centimes ; l'intervalle est celui de la boucle de fond.
   */
  brulageSeuil: Number(lire('BRULAGE_SEUIL_MICROS', String(1 * MICROS))),
  brulageActif: lire('BRULAGE', '1') !== '0',

  /**
   * LE ROBINET — testnet seulement. `POST /robinet` frappe des USDG d'essai sur le wallet
   * de jeu du joueur, parce que personne ne vend d'USDG de test et que le directeur
   * produit doit pouvoir jouer sans un tiers. Interdit sur mainnet par construction : le
   * vrai USDG n'a pas de fonction de frappe.
   */
  robinetMicros: Number(lire('ROBINET_MICROS', String(20 * MICROS))),
  robinetDelaiMinutes: Number(lire('ROBINET_DELAI_MINUTES', '60')),

  /**
   * Graine maitresse des adresses de depot.
   *
   * Chaque joueur a une adresse dediee, DERIVEE de cette graine et de son identifiant.
   * Aucune cle privee de depot n'est donc stockee nulle part : elles se recalculent.
   * Perdre cette graine, c'est perdre l'acces a tous les depots en transit — elle se
   * sauvegarde comme la cle de la caisse, ni plus ni moins.
   */
  graineDepots: lire('GRAINE_DEPOTS'),

  // ---- Supabase ----
  supabaseUrl: lire('SUPABASE_URL'),
  supabaseAnon: lire('SUPABASE_ANON_KEY'),
  supabaseService: lire('SUPABASE_SERVICE_ROLE'),
  databaseUrl: lire('DATABASE_URL'),

  // ---- reglages economiques ----
  /**
   * Depot minimum ANNONCE : 20 USDG.
   *
   * Annonce, et non impose. On ne peut pas refuser un virement deja arrive sur la chaine :
   * les seules options seraient de le garder (c'est du vol) ou de le renvoyer (ce qui
   * coute des frais et peut echouer). Un depot plus petit est donc CREDITE quand meme ;
   * le minimum vit dans l'interface, la ou il sert a orienter le joueur.
   */
  depotMinimum: Number(lire('DEPOT_MINIMUM_MICROS', String(20 * MICROS))),

  /**
   * Retrait minimum, et delai sur le premier retrait d'un compte.
   *
   * C'est la doctrine anti-bot de la spec section 2 : la friction est a la SORTIE, pas a
   * l'entree. Un bot qui doit d'abord gagner 25 USDG puis attendre un jour coute plus
   * cher a fabriquer qu'il ne rapporte — et pendant ce temps le web reste ouvert en
   * grand a l'inscription, ce qui est exactement ce qu'on veut pour l'acquisition.
   */
  retraitMinimum: Number(lire('RETRAIT_MINIMUM_MICROS', String(25 * MICROS))),
  delaiPremierRetraitHeures: Number(lire('DELAI_PREMIER_RETRAIT_HEURES', '24')),

  // ---- serveur ----
  port: Number(lire('PORT', '8787')),

  /**
   * Origine autorisee a appeler l'API.
   *
   * `*` en developpement, l'adresse du jeu en production. Ce n'est pas la barriere
   * principale — l'authentification l'est — mais laisser `*` en production revient a
   * offrir a n'importe quel site le droit d'appeler l'API avec le jeton du joueur.
   */
  origine: lire('ORIGINE_AUTORISEE', '*'),
};

/**
 * Verifie que tout ce dont un chemin donne a besoin est present, et le dit clairement.
 *
 * Le contraire — decouvrir une variable manquante au moment de signer un retrait — est
 * la facon la plus desagreable d'apprendre qu'un environnement est incomplet.
 */
export function exiger(...noms) {
  const manquants = noms.filter((n) => !config[n]);
  if (manquants.length) {
    throw new Error(
      `configuration incomplete : ${manquants.join(', ')}. `
      + `Renseignez-les dans le .env de la racine, puis « set -a && source .env && set +a ».`,
    );
  }
}
