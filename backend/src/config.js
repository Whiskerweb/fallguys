/**
 * La configuration, lue dans l'environnement — jamais ecrite dans le depot.
 *
 * Deux categories de valeurs, et la distinction compte :
 *
 *   - les SECRETS (`GRAINE_DEPOTS`, `CAISSE_CLE`, `SUPABASE_SERVICE_ROLE`) : ils ne
 *     doivent apparaitre ni dans git, ni dans un journal, ni dans une reponse HTTP.
 *     Sur devnet ils ne gardent rien ; en mainnet, `CAISSE_CLE` EST le systeme. On les
 *     traite des maintenant comme s'ils valaient quelque chose, pour que l'habitude soit
 *     prise avant que ce soit vrai ;
 *
 *   - les REGLAGES (mint USDC, reseau, minimums) : dans l'environnement eux aussi, pour
 *     que le passage devnet -> mainnet soit un changement de configuration et non une
 *     chasse aux valeurs ecrites en dur dans le code.
 *
 * Le fichier `.env` de la racine est deja ignore par git, avec une exception pour
 * `.env.example`. Les nouvelles variables y sont declarees a vide.
 */

import { MICROS } from './argent.js';

const lire = (nom, defaut = undefined) => {
  const v = process.env[nom];
  if (v === undefined || v === '') {
    if (defaut === undefined) return null;
    return defaut;
  }
  return v;
};

export const config = {
  // ---- chaine ----
  reseau: lire('SOLANA_RESEAU', 'devnet'),
  rpc: lire('SOLANA_RPC', 'https://api.devnet.solana.com'),

  /**
   * Le mint USDC. Devnet par defaut, alimentable au faucet Circle.
   * En variable et non en constante : le mainnet ne doit demander qu'un changement ici.
   */
  mintUsdc: lire('USDC_MINT', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),

  /** Cle de la caisse, en base58. Le seul secret qui signe des paiements. */
  caisseCle: lire('CAISSE_CLE'),

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
   * Depot minimum ANNONCE : 20 USDC.
   *
   * Annonce, et non impose. On ne peut pas refuser un virement deja arrive sur la chaine :
   * les seules options seraient de le garder (c'est du vol) ou de le renvoyer (ce qui
   * coute des frais et peut echouer). Un depot plus petit est donc CREDITE quand meme ;
   * le minimum vit dans l'interface, la ou il sert a orienter le joueur.
   */
  depotMinimum: 20 * MICROS,

  /**
   * Retrait minimum, et delai sur le premier retrait d'un compte.
   *
   * C'est la doctrine anti-bot de la spec section 2 : la friction est a la SORTIE, pas a
   * l'entree. Un bot qui doit d'abord gagner 25 USDC puis attendre un jour coute plus
   * cher a fabriquer qu'il ne rapporte — et pendant ce temps le web reste ouvert en
   * grand a l'inscription, ce qui est exactement ce qu'on veut pour l'acquisition.
   */
  retraitMinimum: 25 * MICROS,
  delaiPremierRetraitHeures: 24,

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
