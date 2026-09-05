/**
 * Engager les mises d'une partie, et la regler — au grand livre ET sur la chaine.
 *
 * Ce sont les deux seuls moments ou l'argent d'un joueur bouge a cause du JEU. Tout le
 * reste (depot, retrait) touche a la chaine d'une autre facon.
 *
 * Principe repris de la spec section 6.3 — la separation jeu / argent : le serveur de jeu
 * ne connait aucun solde et ne declenche aucun paiement. Il produit un resultat de partie
 * SIGNE ; c'est ce module, et lui seul, qui le convertit en mouvements.
 *
 * ─── CHAQUE PARTIE SE VOIT SUR ROBINHOOD CHAIN ──────────────────────────────
 *
 *   1. ENGAGER : la mise de chaque joueur quitte SON wallet pour le wallet du POT de la
 *      partie — UNE transaction pour tout le salon, chaque virement autorise par la cle
 *      derivee de son joueur (EIP-3009), gaz paye par la caisse, tout ou rien. Si UNE
 *      mise ne passe pas, AUCUNE n'est partie et la partie est ANNULEE : personne ne joue
 *      pour rien, personne ne joue contre un fantome, et il n'y a rien a rendre sur la
 *      chaine.
 *   2. REGLER : le pot est vide vers les gagnants et vers le wallet des frais, dans une
 *      seule transaction. Le grand livre est ecrit D'ABORD ; la chaine SUIT, et
 *      `payerSurChaine` est idempotent — un reglement dont la chaine a trebuche se
 *      rejoue tel quel, sans jamais payer deux fois.
 *
 * L'ordre « livre puis chaine » n'est pas indifferent. Le livre est une transaction
 * Postgres : atomique, verrouillee, verifiable. La chaine est lente et peut couper. Ecrire
 * le livre d'abord donne un etat de reference ; la chaine n'a plus qu'a le rejoindre, et
 * `verifierChaine()` (reconciliation.js) dit quand elle ne l'a pas encore fait.
 */

import { poster, compte, solde, verrouillerJoueur, mouvementExistant } from '../livre.js';
import { table, tableEffectif, mode, tirerIssue } from '../gains.js';
import { micros } from '../argent.js';
import { tresorerie } from '../robinhood/tresorerie.js';
import { ChaineEchouee, ChaineIncertaine, OPERATIONS_PAR_TRANSACTION } from '../robinhood/chaine.js';

/** L'adresse du pot, ou `null` sans graine — les tests du bareme n'en ont pas besoin. */
function adressePotDe(matchId) {
  try { return tresorerie.pot(matchId).address; } catch { return null; }
}

/**
 * Engage la mise d'UN joueur au grand livre : elle quitte son solde et entre dans le pot.
 *
 * La mise est debitee AU LANCEMENT, pas a l'arrivee — c'est ce qui fait la difference
 * entre un bouton et un engagement. Abandonner en cours de partie perd la mise.
 *
 * @returns {Promise<{tx: string, deja: boolean, solde: number}>}
 */
export async function engager(db, { matchId, userId, mise }) {
  const montant = micros(mise, 'mise');
  if (montant <= 0) throw new Error('engager : la mise doit etre strictement positive');

  return db.transaction(async (tx) => {
    /*
     * Verrou sur le joueur AVANT de lire son solde.
     *
     * Sans lui, deux requetes simultanees — deux salons qui partent au meme battement,
     * une relance reseau — lisent toutes les deux un solde suffisant, et toutes les deux
     * debitent. C'est le bug de concurrence le plus banal du genre, et le seul de ce
     * fichier qui coute reellement de l'argent.
     */
    await verrouillerJoueur(tx, userId);

    /*
     * IDEMPOTENCE AVANT VALIDATION. Si le mouvement est deja pose, on repart avec : son
     * solde a DEJA ete debite, donc le controle « a-t-il de quoi ? » echouerait sur une
     * requete pourtant legitime.
     */
    const deja = await mouvementExistant(tx, 'mise', `${matchId}:${userId}`);
    if (deja) return { tx: deja, deja: true, solde: await solde(tx, compte.joueur(userId)) };

    const disponible = await solde(tx, compte.joueur(userId));
    if (disponible < montant) {
      const e = new Error('solde insuffisant');
      e.code = 'SOLDE_INSUFFISANT';
      e.disponible = disponible;
      e.requis = montant;
      throw e;
    }

    const r = await poster(tx, {
      genre: 'mise',
      ref: `${matchId}:${userId}`,
      metadata: { matchId, userId },
      lignes: [
        { compte: compte.joueur(userId), montant: -montant },
        { compte: compte.pot(matchId), montant: +montant },
      ],
    });
    return { tx: r.id, deja: r.deja, solde: disponible - montant };
  });
}

/**
 * Rend une mise au joueur : le mouvement INVERSE, jamais une suppression.
 *
 * Deux raisons d'y passer : la chaine a refuse le virement (la mise n'est jamais partie),
 * ou la partie est annulee (elle est partie, et revient). `ref` distingue les deux.
 */
export async function rendreMise(db, { matchId, userId, mise, raison }) {
  const montant = micros(mise, 'mise');
  return db.transaction(async (tx) => {
    const posee = await mouvementExistant(tx, 'mise', `${matchId}:${userId}`);
    if (!posee) return { deja: true, rien: true };
    return poster(tx, {
      genre: 'mise_rendue',
      ref: `${matchId}:${userId}`,
      metadata: { matchId, userId, raison },
      lignes: [
        { compte: compte.pot(matchId), montant: -montant },
        { compte: compte.joueur(userId), montant: +montant },
      ],
    });
  });
}

/**
 * Engage TOUTES les mises d'une partie, au livre puis sur la chaine.
 *
 * Appele par le serveur de jeu (message signe) quand un salon est compose, AVANT que la
 * premiere manche ne s'annonce. Ce qu'il rend decide si la partie a lieu :
 *
 *   - `annulee: false` — chaque mise est dans le pot, sur la chaine, confirmee ;
 *   - `annulee: true`  — au moins une mise n'est pas partie (solde insuffisant, chaine
 *     muette) ; toutes celles qui etaient parties sont deja revenues. Le serveur renvoie
 *     tout le monde au lobby, avec la raison pour ceux que ca concerne.
 *
 * @param {object} p
 * @param {string} p.partie identifiant de la partie, donne par le serveur de jeu
 * @param {string} p.mode
 * @param {number} p.mise en micros
 * @param {Array<{userId: string, nom: string}>} p.joueurs
 */
export async function engagerPartie(db, chaine, { partie, mode: modeId, mise, joueurs }) {
  const montant = micros(mise, 'mise');
  const m = mode(modeId);
  if (!chaine) throw new Error('engagerPartie : pas de chaine — un pot ne se remplit pas en l\'air');
  if (!Array.isArray(joueurs) || joueurs.length < 2) throw new Error('engagerPartie : il faut au moins deux joueurs');
  if (joueurs.length > m.joueurs) throw new Error(`engagerPartie : ${joueurs.length} joueurs pour un ${m.id} de ${m.joueurs}`);
  const ids = new Set(joueurs.map((j) => j.userId));
  if (ids.size !== joueurs.length) throw new Error('engagerPartie : un joueur figure deux fois');

  const pot = tresorerie.pot(partie);
  const adressePot = pot.address;

  // La partie est connue AVANT la premiere mise : c'est ce qui permet a la reprise de
  // savoir, pour une mise laissee en suspens, si sa partie a ete annulee entre-temps.
  await db.query(
    `insert into public.matches (id, mise_micros, mode, effectif, statut, engagee_le, adresse_pot, classement)
     values ($1, $2, $3, $4, 'engagee', now(), $5, '[]')
     on conflict (id) do nothing`,
    [partie, montant, m.id, joueurs.length, adressePot],
  );
  const existante = (await db.query(`select statut from public.matches where id = $1`, [partie])).rows[0];
  if (existante.statut !== 'engagee') {
    throw Object.assign(new Error(`la partie ${partie} est deja ${existante.statut}`), { code: 'PARTIE_CLOSE' });
  }

  const refuses = [];
  const signatures = {};

  // 1. LE LIVRE, joueur par joueur : c'est la qu'un solde insuffisant se voit.
  const aVirer = [];
  for (const { userId, nom } of joueurs) {
    try {
      await engager(db, { matchId: partie, userId, mise: montant });
      aVirer.push({ userId, nom });
    } catch (e) {
      refuses.push({ userId, nom, raison: e.code ?? 'LIVRE', detail: e.message });
    }
  }
  /*
   * Un seul refus au livre, et la partie n'aura pas lieu : inutile de faire partir les
   * autres mises pour les rendre aussitot. On rend au livre, on annule, on repond.
   */
  if (refuses.length) {
    for (const { userId } of aVirer) await rendreMise(db, { matchId: partie, userId, mise: montant, raison: 'partie annulee avant le depart' });
    await annulerPartie(db, chaine, { partie, raison: `mise refusee : ${refuses.map((r) => r.raison).join(', ')}` });
    return { partie, annulee: true, engages: [], refuses, signatures };
  }

  // 2. LA CHAINE, en UN lot : toutes les mises, ou aucune.
  try {
    const r = await chaine.executer({
      operations: aVirer.map(({ userId }) => ({
        type: 'virement', de: tresorerie.joueur(userId), vers: adressePot, mint: 'usdc', montant,
        objet: 'mise', ref: `${partie}:${userId}`, partie, userId,
      })),
    });
    for (const { userId } of aVirer) signatures[userId] = r.signature;
  } catch (e) {
    if (e instanceof ChaineEchouee) {
      // Rien n'est parti, c'est certain : chaque mise revient au livre tout de suite. Le
      // lot dit QUEL appel a echoue : c'est ce joueur-la qui est refuse, les autres sont
      // renvoyes en file par le serveur de jeu.
      for (const { userId } of aVirer) await rendreMise(db, { matchId: partie, userId, mise: montant, raison: `chaine : ${e.message}` });
      const fautif = Number.isInteger(e.index) ? aVirer[e.index] : null;
      for (const { userId, nom } of (fautif ? [fautif] : aVirer)) refuses.push({ userId, nom, raison: 'CHAINE_REFUS', detail: e.message });
    } else if (e instanceof ChaineIncertaine) {
      // Peut-etre partie. On ne rend RIEN : `reprendre()` tranchera et rendra s'il le faut.
      for (const { userId, nom } of aVirer) refuses.push({ userId, nom, raison: 'CHAINE_INCERTAINE', detail: e.message });
    } else {
      for (const { userId } of aVirer) await rendreMise(db, { matchId: partie, userId, mise: montant, raison: `erreur : ${e.message}` });
      for (const { userId, nom } of aVirer) refuses.push({ userId, nom, raison: 'ERREUR', detail: e.message });
    }
    await annulerPartie(db, chaine, { partie, raison: `mise refusee : ${refuses.map((r) => r.raison).join(', ')}` });
    return { partie, annulee: true, engages: [], refuses, signatures };
  }

  return { partie, annulee: false, engages: aVirer.map((j) => j.userId), refuses, signatures, adressePot };
}

/**
 * Annule une partie engagee : chaque mise CONFIRMEE sur la chaine revient a son joueur,
 * au livre puis sur la chaine. Idempotent — une annulation rejouee ne rend rien de plus.
 */
export async function annulerPartie(db, chaine, { partie, raison }) {
  const m = (await db.query(`select * from public.matches where id = $1`, [partie])).rows[0];
  if (!m) throw Object.assign(new Error('partie inconnue'), { code: 'PARTIE_INCONNUE' });
  if (m.statut === 'reglee') throw Object.assign(new Error('une partie reglee ne s\'annule pas'), { code: 'PARTIE_REGLEE' });
  await db.query(`update public.matches set statut = 'annulee' where id = $1`, [partie]);

  const mise = Number(m.mise_micros);
  const pot = tresorerie.pot(partie);
  const confirmees = (await db.query(
    `select user_id from public.chain_tx where objet = 'mise' and partie = $1 and statut = 'confirme'`, [partie],
  )).rows.map((r) => r.user_id);

  const rendus = [];
  for (const userId of confirmees) {
    await rendreMise(db, { matchId: partie, userId, mise, raison });
    rendus.push(userId);
  }
  // Les retours partent groupes : un lot, atomique.
  const signatures = [];
  for (let i = 0; i < rendus.length; i += OPERATIONS_PAR_TRANSACTION) {
    const lot = rendus.slice(i, i + OPERATIONS_PAR_TRANSACTION);
    try {
      const r = await chaine.executer({
        operations: lot.map((userId) => ({
          type: 'virement', de: pot, vers: tresorerie.joueur(userId).address, mint: 'usdc', montant: mise,
          objet: 'annulation', ref: `${partie}:${userId}`, partie, userId,
        })),
      });
      signatures.push(r.signature);
    } catch (e) {
      // Le livre a deja rendu : la chaine rattrapera par `rattraperChaine`. On ne perd rien.
      console.error(`annulation ${partie} : retour sur chaine differe (${e.message})`);
    }
  }
  return { partie, rendus, signatures };
}

/**
 * Regle une partie au grand livre : preleve le rake, verse les gains, solde le pot. Puis,
 * si une chaine est fournie, paie sur la chaine (`payerSurChaine`).
 *
 * Le MODE et LA GRAINE DE ROUE font partie du resultat, au meme titre que le classement :
 * ce sont eux qui disent quelle ligne du tableau paie. La graine vient du serveur de jeu,
 * tiree au hasard cryptographique au classement final ; on en DERIVE l'issue ici, avec le
 * meme melangeur que le lobby et le noyau C#, et on l'ecrit au grand livre avec la graine.
 *
 * L'EFFECTIF REEL compte autant que le mode : un salon reduit N'A PAS DE ROUE et se paie
 * au bareme de son effectif, sans graine.
 *
 * @param {object} resultat
 * @param {string} resultat.matchId
 * @param {number} resultat.mise mise d'entree en micros
 * @param {string} [resultat.mode]
 * @param {number} [resultat.graineRoue]
 * @param {number} [resultat.effectif]
 * @param {Array<{userId: string, rang: number}>} resultat.classement
 * @param {object|null} [chaine] la chaine ou payer. `null` : livre seul (tests du bareme).
 */
export async function regler(db, {
  matchId, mise, mode: modeId = 'arena', graineRoue = 0, effectif = null, classement,
}, chaine = null) {
  const montant = micros(mise, 'mise');
  const m = mode(modeId);
  if (!Number.isInteger(graineRoue) || graineRoue < 0 || graineRoue > 0xFFFFFFFF) {
    throw new Error(`regler : graine de roue ${graineRoue} hors de 32 bits`);
  }
  const joueurs = effectif ?? m.joueurs;
  if (!Number.isInteger(joueurs) || joueurs < 2 || joueurs > m.joueurs) {
    throw new Error(`regler : effectif ${joueurs} impossible en ${m.id} (2..${m.joueurs})`);
  }
  const complet = joueurs === m.joueurs;
  if (!complet && joueurs < 3) {
    throw new Error(`regler : un salon reduit demande au moins 3 joueurs ; ${joueurs} declare(s)`);
  }
  const issue = complet ? tirerIssue(modeId, graineRoue).id : null;
  const { pot, rake, parRang } = complet ? table(montant, modeId, issue) : tableEffectif(montant, joueurs);

  const rangs = new Set();
  for (const { userId, rang } of classement) {
    if (!userId) throw new Error('regler : joueur sans identifiant dans le classement');
    if (!Number.isInteger(rang) || rang < 1 || rang > joueurs) {
      throw new Error(`regler : rang ${rang} hors bornes (1..${joueurs}) pour le mode ${m.id}`);
    }
    if (rangs.has(rang)) throw new Error(`regler : rang ${rang} attribue deux fois`);
    rangs.add(rang);
  }

  const livre = await db.transaction(async (tx) => {
    const deja = await mouvementExistant(tx, 'gain', matchId);
    if (deja) return { tx: deja, deja: true, pot, rake, verse: 0 };

    const etat = (await tx.query(`select statut from public.matches where id = $1`, [matchId])).rows[0];
    if (etat?.statut === 'annulee') throw Object.assign(new Error('partie annulee'), { code: 'PARTIE_ANNULEE' });

    const potReel = await solde(tx, compte.pot(matchId));
    const lignes = [];
    let verse = 0;
    const gains = {};
    for (const { userId, rang } of classement) {
      const gain = parRang[rang - 1] ?? 0;
      gains[userId] = gain;
      if (gain > 0) { lignes.push({ compte: compte.joueur(userId), montant: +gain }); verse += gain; }
    }
    if (rake > 0) lignes.push({ compte: compte.rake, montant: +rake });

    const sorties = verse + rake;
    /*
     * Sur la chaine, le pot ne contient que ce qui y est entre. S'il en sort plus que ca,
     * c'est que le bareme suppose des mises qui n'existent pas (un solo, un effectif
     * mensonger) : la caisse le comblerait au livre, mais aucune transaction ne peut le
     * faire sur la chaine. On refuse AVANT d'ecrire, plutot que de laisser un reglement
     * a moitie fait.
     */
    if (chaine && sorties !== potReel) {
      throw Object.assign(new Error(`le pot contient ${potReel}, le bareme en sort ${sorties}`), { code: 'POT_INCOHERENT' });
    }
    lignes.push({ compte: compte.pot(matchId), montant: -potReel });
    if (sorties !== potReel) lignes.push({ compte: compte.caisse, montant: potReel - sorties });

    const r = await poster(tx, {
      genre: 'gain',
      ref: matchId,
      metadata: {
        matchId, mise: montant, mode: m.id, effectif: joueurs,
        issue, graineRoue: complet ? graineRoue : null,
        pot, rake, classement,
      },
      lignes,
    });

    await tx.query(
      `insert into public.matches (id, mise_micros, pot_micros, rake_micros, classement, tx_id, mode, effectif, graine_roue, issue, statut, adresse_pot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'reglee', $11)
       on conflict (id) do update
         set pot_micros = excluded.pot_micros, rake_micros = excluded.rake_micros,
             classement = excluded.classement, tx_id = excluded.tx_id, effectif = excluded.effectif,
             graine_roue = excluded.graine_roue, issue = excluded.issue, statut = 'reglee',
             regle_le = now()`,
      [matchId, montant, pot, rake, JSON.stringify(classement), r.id, m.id, joueurs,
        complet ? graineRoue : null, issue, adressePotDe(matchId)],
    );
    return { tx: r.id, deja: r.deja, pot, rake, verse, gains, issue };
  });

  if (!chaine) return livre;
  const chaineBilan = await payerSurChaine(db, chaine, matchId);
  return { ...livre, ...chaineBilan };
}

/**
 * Paie sur la chaine ce que le livre a decide pour une partie REGLEE.
 *
 * IDEMPOTENT : chaque virement a sa ligne de journal, et une ligne confirmee n'est pas
 * rejouee. On peut donc l'appeler autant de fois qu'il faut — au reglement, puis a chaque
 * tour de fond tant que `paye_sur_chaine_le` est vide.
 */
export async function payerSurChaine(db, chaine, matchId) {
  const m = (await db.query(`select * from public.matches where id = $1`, [matchId])).rows[0];
  if (!m || m.statut !== 'reglee') return { signatures: [], soldee: false };
  if (m.paye_sur_chaine_le) return { signatures: [], soldee: true, deja: true };

  const meta = (await db.query(`select metadata from public.ledger_tx where genre = 'gain' and ref = $1`, [matchId])).rows[0]?.metadata;
  if (!meta) return { signatures: [], soldee: false };
  const complet = meta.effectif === mode(meta.mode).joueurs;
  const { parRang, rake } = complet ? table(meta.mise, meta.mode, meta.issue) : tableEffectif(meta.mise, meta.effectif);

  const pot = tresorerie.pot(matchId);
  const virements = [];
  for (const { userId, rang } of meta.classement) {
    const gain = parRang[rang - 1] ?? 0;
    if (gain <= 0) continue;
    virements.push({
      type: 'virement', de: pot, vers: tresorerie.joueur(userId).address, mint: 'usdc', montant: gain,
      objet: 'gain', ref: `${matchId}:${userId}`, partie: matchId, userId,
    });
  }
  if (rake > 0) {
    virements.push({
      type: 'virement', de: pot, vers: tresorerie.frais().address, mint: 'usdc', montant: rake,
      objet: 'rake', ref: matchId, partie: matchId,
    });
  }

  // Quinze gains et un rake tiennent dans un lot : un reglement d'arene est UNE transaction.
  const signatures = [];
  for (let i = 0; i < virements.length; i += OPERATIONS_PAR_TRANSACTION) {
    const r = await chaine.executer({ operations: virements.slice(i, i + OPERATIONS_PAR_TRANSACTION) });
    signatures.push(r.signature);
  }
  await db.query(`update public.matches set paye_sur_chaine_le = now() where id = $1`, [matchId]);
  return { signatures, soldee: true };
}

/**
 * Le tour de fond : rejoue ce que la chaine n'a pas encore fait.
 *
 *   - les parties reglees dont les gains ne sont pas tous partis ;
 *   - les parties annulees dont les retours ne sont pas tous partis ;
 *   - les lignes de journal en suspens, tranchees en relisant la chaine — et leurs
 *     consequences au livre (une mise qui n'est jamais partie est rendue).
 */
export async function rattraperChaine(db, chaine) {
  const bilan = { reglees: 0, annulees: 0, reprise: null, erreurs: [] };

  const reprise = await chaine.reprendre({
    echoue: async (l) => {
      if (l.objet === 'mise') {
        const m = (await db.query(`select mise_micros from public.matches where id = $1`, [l.partie])).rows[0];
        if (m) await rendreMise(db, { matchId: l.partie, userId: l.user_id, mise: Number(m.mise_micros), raison: 'virement jamais passe' });
      }
      if (l.objet === 'retrait') {
        const { rembourserRetrait } = await import('../robinhood/retraits.js');
        await rembourserRetrait(db, l.ref, `transaction jamais passee (${l.raison_echec ?? ''})`);
      }
      if (l.objet === 'rachat') {
        const { annulerRachat } = await import('../robinhood/brulage.js');
        await annulerRachat(db, l.ref.split(':')[0], 'transaction jamais passee');
      }
    },
    confirme: async (l) => {
      if (l.objet === 'mise') {
        // La mise est arrivee dans le pot… d'une partie peut-etre annulee entre-temps.
        const m = (await db.query(`select statut, mise_micros from public.matches where id = $1`, [l.partie])).rows[0];
        if (m?.statut === 'annulee') await annulerPartie(db, chaine, { partie: l.partie, raison: 'mise arrivee apres annulation' });
      }
      if (l.objet === 'retrait') {
        const { clore } = await import('../robinhood/retraits.js');
        await clore(db, l.ref, 'confirme');
      }
      if (l.objet === 'rachat') {
        const { consignerRachat } = await import('../robinhood/brulage.js');
        await consignerRachat(db, chaine, l.ref.split(':')[0], l.signature);
      }
    },
  });
  bilan.reprise = reprise;

  const reglees = await db.query(
    `select id from public.matches where statut = 'reglee' and paye_sur_chaine_le is null and mise_micros > 0 order by regle_le limit 20`,
  );
  for (const { id } of reglees.rows) {
    try { await payerSurChaine(db, chaine, id); bilan.reglees++; } catch (e) { bilan.erreurs.push(`${id} : ${e.message}`); }
  }

  const annulees = await db.query(
    `select m.id from public.matches m
      where m.statut = 'annulee'
        and exists (select 1 from public.chain_tx c where c.partie = m.id and c.objet = 'mise' and c.statut = 'confirme')
        and exists (select 1 from public.chain_tx c where c.partie = m.id and c.objet = 'mise' and c.statut = 'confirme'
                      and not exists (select 1 from public.chain_tx a where a.partie = m.id and a.objet = 'annulation' and a.user_id = c.user_id and a.statut = 'confirme'))
      limit 20`,
  );
  for (const { id } of annulees.rows) {
    try { await annulerPartie(db, chaine, { partie: id, raison: 'rattrapage' }); bilan.annulees++; } catch (e) { bilan.erreurs.push(`${id} : ${e.message}`); }
  }
  return bilan;
}
