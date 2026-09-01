/**
 * Économie d'une partie : mise, pot, gains par rang, progression.
 *
 * Le portefeuille, lui, vit dans `caisse.js` — voir plus bas pourquoi.
 *
 * PORT FIDÈLE de `src/Fallguys.Rules` (C#). Les mêmes chiffres doivent sortir des deux
 * côtés : le lobby annonce au joueur ce que le serveur de règlement paiera réellement, et
 * un écart entre les deux serait un mensonge affiché à l'écran dans un jeu où l'on mise
 * de l'argent. `diag/economie.mjs` vérifie la table ligne à ligne.
 *
 * Comme `Money.cs`, tout est en MICRO-UNITÉS ENTIÈRES — jamais de flottant. 0,1 + 0,2 ne
 * fait pas 0,3 en binaire, et un centième d'USDC perdu par arrondi à chaque partie est un
 * bug comptable qu'on ne retrouve plus six mois plus tard.
 */

export const MICROS = 1_000_000;

/**
 * Recopie de `MatchConfiguration.Default` : 16 joueurs, 3 manches, rake 10 %.
 *
 * Les poids valent [40, 15, 7, 2] et non [35, 15, 5, 1] : ces derniers tombaient sur des
 * chiffres ronds A 15 % DE RAKE. A 10 %, la meme formule paie 2,714285 au deuxieme — un
 * montant qu'on ne peut ni afficher ni defendre dans un jeu ou l'on engage de l'argent.
 * Le rake et les poids forment un couple ; reviser l'un sans l'autre donne des gains justes
 * au centieme et illisibles a l'ecran.
 */
export const CONFIG = {
  joueurs: 16,
  survivants: [8, 4, 1],
  rakeBp: 1000,
  poidsFinalistes: [40, 15, 7, 2],
};

/** Les trois tables ouvertes, en USDC. */
export const PALIERS = [1, 2, 5];

/** Rang au-delà duquel le joueur ne récupère plus sa mise (`RefundThreshold`). */
export const SEUIL_REMBOURSEMENT = CONFIG.survivants[0];
/** Nombre de joueurs qui entrent dans la dernière manche (`FinalistCount`). */
export const NB_FINALISTES = CONFIG.survivants[CONFIG.survivants.length - 2];

/**
 * Combien de manches pour un effectif donné.
 *
 * Chaque manche élimine environ la moitié, jusqu'au vainqueur. Plafonné à trois : au-delà
 * une partie s'allonge sans devenir plus intéressante, et le spec en retient trois.
 */
export function manchesPour(joueurs) {
  return Math.min(3, Math.max(1, Math.ceil(Math.log2(Math.max(2, joueurs)))));
}

/**
 * La configuration d'une partie à N joueurs — port de `MatchConfiguration.ForPlayers`.
 *
 * Le démarrage à froid (risque n°1 du spec) impose d'ouvrir des salons plus petits que
 * seize : il faut seize joueurs vivants, prêts à miser le même montant, au même instant,
 * et au premier jour il n'y en a aucun. Un salon réduit doit donc être payé selon SON
 * effectif — le payer au barème de seize promettrait un pot qui n'existe pas.
 *
 * DEUX JOUEURS SONT REFUSÉS, et ce n'est pas un oubli. Il faut au moins deux manches, donc
 * la manche 1 laisse moins de deux joueurs, donc la manche 2 devrait en laisser moins d'un.
 * C'est structurellement impossible. Un duel n'est pas une compétition à places : s'il faut
 * en autoriser un, c'est une partie d'exhibition, hors table de gains.
 */
export function configPour(joueurs, rakeBp = 1000) {
  if (!Number.isInteger(joueurs) || joueurs < 3) {
    throw new Error(`une partie payante demande au moins 3 joueurs ; ${joueurs} demandé(s). `
      + 'Un duel se joue hors table de gains.');
  }
  const manches = Math.max(2, manchesPour(joueurs));
  const survivants = new Array(manches);
  for (let i = 1; i < manches; i++) {
    // Le plancher `manches - i + 1` garantit qu'il reste toujours assez de joueurs pour
    // tenir les manches suivantes ; sans lui, un petit effectif produirait une suite non
    // strictement décroissante, qu'aucun des deux noyaux n'accepte.
    survivants[i - 1] = Math.max(manches - i + 1, joueurs >> i);
  }
  survivants[manches - 1] = 1;

  const finalistes = survivants[manches - 2];
  const REFERENCE = [40, 15, 7, 2];
  const poidsFinalistes = Array.from(
    { length: Math.max(finalistes, REFERENCE.length) },
    (_, i) => (i < REFERENCE.length ? REFERENCE[i] : 1),
  );
  return { joueurs, survivants, rakeBp, poidsFinalistes };
}

/**
 * Table des gains — `PayoutPolicy.Compute`, repris pas à pas.
 *
 * Règle unique : les survivants de la manche 1 récupèrent leur mise, et ce qui reste après
 * le rake est réparti en bonus entre les finalistes. Le seuil de non-perte tombe donc
 * exactement à la fin de la première manche.
 *
 * @param {number} mise mise d'entrée en micro-USDC
 * @param {number} [joueurs] effectif réel de la partie. 16 par défaut — mais un salon
 *   réduit DOIT passer le sien, sans quoi il serait payé au barème de seize.
 * @returns {{pot: number, rake: number, parRang: number[]}} tout en micro-USDC
 */
export function table(mise, joueurs = CONFIG.joueurs) {
  const c = joueurs === CONFIG.joueurs ? CONFIG : configPour(joueurs, CONFIG.rakeBp);
  const seuil = c.survivants[0];
  const nbFinalistes = c.survivants[c.survivants.length - 2];

  const pot = mise * c.joueurs;
  const rake = Math.floor((pot * c.rakeBp) / 10_000);
  const distribuable = pot - rake;

  const parRang = new Array(c.joueurs).fill(0);

  // 1. Remboursement de la mise aux survivants de la manche 1.
  for (let rang = 1; rang <= seuil; rang++) parRang[rang - 1] = mise;
  const bonus = distribuable - mise * seuil;

  // 2. Répartition du bonus entre finalistes, au prorata des poids.
  const poids = c.poidsFinalistes.slice(0, nbFinalistes);
  const sommePoids = poids.reduce((s, p) => s + p, 0);
  let alloue = 0;
  for (let i = 0; i < nbFinalistes; i++) {
    const part = Math.floor((bonus * poids[i]) / sommePoids);
    parRang[i] += part;
    alloue += part;
  }

  // 3. Le reste de division entière revient au vainqueur : aucune unité ne se perd.
  parRang[0] += bonus - alloue;

  return { pot, rake, parRang };
}

/**
 * L'échelle affichée dans le ticket : une ligne par PALIER DE RANG, pas par rang.
 *
 * Seize lignes seraient illisibles alors que douze d'entre elles portent la même valeur.
 * On regroupe donc les rangs consécutifs qui paient pareil — ce qui fait apparaître de
 * lui-même le vrai découpage : quatre finalistes payés à part, la bande remboursée, le
 * reste à zéro.
 */
export function echelle(mise) {
  const { parRang } = table(mise);
  const lignes = [];
  for (let i = 0; i < parRang.length; i++) {
    const derniere = lignes[lignes.length - 1];
    if (derniere && derniere.gain === parRang[i]) { derniere.jusqu = i + 1; continue; }
    lignes.push({ depuis: i + 1, jusqu: i + 1, gain: parRang[i] });
  }
  return lignes.map((l) => ({
    ...l,
    rembourse: l.gain === mise,
    // Le multiplicateur est ce que le joueur compare d'un palier à l'autre.
    facteur: mise > 0 ? l.gain / mise : 0,
  }));
}

/**
 * « 16.00 » — deux décimales, POINT décimal, jamais d'arrondi flottant.
 *
 * Point et non virgule : l'interface est en anglais, et l'USDC se cote au point partout.
 * Un « 16,00 » dans une interface anglaise se lit comme un séparateur de milliers, donc
 * comme mille six cents — l'ambiguïté la plus chère qu'on puisse afficher sur un pot.
 */
export function montant(micros) {
  const negatif = micros < 0;
  const abs = Math.abs(micros);
  const unites = Math.floor(abs / MICROS);
  const cents = Math.round((abs % MICROS) / 10_000);
  return `${negatif ? '-' : ''}${unites}.${String(cents).padStart(2, '0')}`;
}

/**
 * Ordinal anglais : 1st, 2nd, 3rd, 4th…
 *
 * Onze, douze et treize prennent « th » malgré leur dernier chiffre — la règle du dernier
 * chiffre seul écrirait « 11st », et c'est la faute que fait tout le monde. Défini ici
 * parce que le ticket et l'écran de fin l'écrivent tous les deux, et qu'une deuxième
 * implémentation finit toujours par diverger de la première.
 */
export function ordinal(n) {
  const d = n % 10, c = n % 100;
  if (c >= 11 && c <= 13) return `${n}th`;
  return `${n}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
}

/** « ×4.5 » — une décimale, et pas de décimale quand elle vaut zéro. */
export function facteur(x) {
  return `×${Math.round(x * 10) / 10}`;
}

/**
 * Table choisie par le joueur, en micro-USDC.
 *
 * Memorisee : on rejoue le plus souvent a la meme table, et repartir a 1 USDC a chaque
 * lancement du jeu obligerait a la rechoisir sans arret. Une valeur memorisee qui ne
 * figure plus au catalogue retombe sur la plus basse plutot que de bloquer le lobby.
 */
const CLE_MISE = 'tumble-mise';

export function miseChoisie() {
  const memo = Number(localStorage.getItem(CLE_MISE));
  return (PALIERS.includes(memo) ? memo : PALIERS[0]) * MICROS;
}

export function choisirMise(usdc) {
  if (!PALIERS.includes(usdc)) return;
  localStorage.setItem(CLE_MISE, String(usdc));
  prevenir();
}

// ---------- notifications ----------

/*
 * Le portefeuille a demenage dans `caisse.js`.
 *
 * Tant qu'il n'etait qu'une cle de `localStorage`, sa place etait ici, aux cotes de la
 * table des gains. Il tient desormais deux choses tres differentes — un solde local de
 * prototype et un solde distant tenu par le grand livre du backend — et l'une d'elles est
 * ASYNCHRONE. Les melanger a un module de calcul pur, importe jusque dans un test qui
 * tourne sous Node, ne tenait plus.
 *
 * Ce fichier ne garde que ce qui se CALCULE : la table, l'echelle, les formats, la mise
 * choisie et la progression. Rien qui touche a de l'argent reel.
 */

const auditeurs = new Set();

/**
 * Previent tout ce qui affiche de l'argent, de l'XP ou une mise.
 *
 * Exporte parce que `caisse.js` doit pouvoir le declencher : le solde a demenage la-bas
 * quand il a cesse d'etre une simple cle de `localStorage`, mais il n'existe toujours
 * qu'UN SEUL chemin de rafraichissement de l'interface. Deux en feraient diverger.
 */
export const prevenir = () => { for (const fn of auditeurs) fn(); };

/*
 * Absence et zero ne sont pas la meme chose.
 *
 * `Number(null)` vaut 0, pas NaN : une cle jamais ecrite se lisait donc comme un solde
 * nul, et le joueur arrivait dans un lobby ou aucune table n'etait jouable, bouton
 * RECHARGER affiche des la premiere seconde. On teste l'absence AVANT de convertir.
 */
export function lireEntier(cle, defaut) {
  const brut = localStorage.getItem(cle);
  if (brut === null || brut === '') return defaut;
  const n = Number(brut);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaut;
}

// ---------- progression ----------

const CLE_XP = 'tumble-xp';

/**
 * Coût du passage au niveau suivant. Croissance linéaire douce : les premiers niveaux
 * tombent vite — c'est le seul retour que le joueur a d'une partie perdue — et l'écart
 * se creuse ensuite sans jamais devenir un mur.
 */
const coutNiveau = (n) => 240 + (n - 1) * 80;

export const XP_MANCHE = 45;   // par manche qualifiée
export const XP_VICTOIRE = 160; // en plus, pour la couronne

export const progression = {
  get xp() { return lireEntier(CLE_XP, 0); },

  /** Décompose l'XP totale en niveau courant et avancement dans ce niveau. */
  get etat() {
    let reste = this.xp;
    let niveau = 1;
    while (reste >= coutNiveau(niveau)) { reste -= coutNiveau(niveau); niveau++; }
    return { niveau, dans: reste, pour: coutNiveau(niveau) };
  },

  gagner(n) {
    localStorage.setItem(CLE_XP, String(this.xp + n));
    prevenir();
  },
};

/** S'abonne aux mouvements du portefeuille et de la progression. */
export function surChangement(fn) { auditeurs.add(fn); return () => auditeurs.delete(fn); }
