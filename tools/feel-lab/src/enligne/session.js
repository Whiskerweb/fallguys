/**
 * LA SESSION EN LIGNE — ce que le jeu appelle, et rien de plus.
 *
 * Elle assemble les trois pièces : le lien (`lien.js`), la correction de position
 * (`reconciliation.js`) et les autres joueurs (`figurants.js`). Le reste du jeu n'a que
 * quatre choses à faire, et c'est délibéré — `main.js` est édité par plusieurs mains, il
 * ne doit pas devenir le lieu où vit le netcode :
 *
 *   1. `sur('manche', …)`  construire l'arène annoncée par le serveur ;
 *   2. `attacher(...)`     donner le personnage local et la scène ;
 *   3. `envoyer(entree)`   à chaque image, au lieu de simuler dans le vide ;
 *   4. `avancer(dt)`       à chaque image, après la physique.
 *
 * ─── LA GRAINE VIENT DU SERVEUR ─────────────────────────────────────────────
 *
 * En solo, le client tire la carte et sa graine. En ligne, il ne tire PLUS RIEN : le
 * serveur annonce l'épreuve et la graine, et le client construit exactement le même monde.
 * C'est ce qui rend la prédiction possible — deux mondes différents ne se corrigent pas,
 * ils divergent.
 */

import { creerLien } from './lien.js';
import { creerReconciliation } from './reconciliation.js';
import { creerFigurants } from './figurants.js';

export function creerSession({ url, nom }) {
  const lien = creerLien({ url, nom });
  const recon = creerReconciliation();

  let figurants = null;
  let perso = null;
  let monIndex = -1;
  let manche = null;              // la dernière annonce reçue
  let dernierInstantane = null;
  let latence = 0;                // aller-retour estimé, en ms
  let dernierSeq = 0;             // le numéro de la dernière entrée envoyée

  const ecouteurs = new Map();
  const emettre = (type, d) => { for (const fn of ecouteurs.get(type) ?? []) fn(d); };

  // On relaie les messages du serveur tels quels : le jeu s'abonne à ce qui l'intéresse.
  for (const type of ['bienvenue', 'salon', 'manche', 'fin-manche', 'fin-partie', 'refus', 'etat']) {
    lien.sur(type, (msg) => {
      if (type === 'manche') {
        manche = msg;
        /*
         * ABSENT DE LA LISTE = SPECTATEUR.
         *
         * L'annonce part à TOUS les joueurs de la partie, éliminés compris — c'est ce qui
         * leur permet de regarder la suite au lieu d'attendre devant un écran noir. Un
         * éliminé ne figure simplement plus dans `joueurs`, et c'est ainsi qu'il apprend
         * qu'il regarde.
         *
         * Le client doit alors NE PAS créer de personnage local : le serveur n'en simule
         * plus pour lui, aucun instantané ne le concerne, et en fabriquer un donnerait un
         * fantôme jouable que personne d'autre ne voit. C'est le trou qu'a révélé le
         * premier essai de partie complète — la manche 2 plantait le client de l'éliminé.
         */
        monIndex = msg.joueurs.find((j) => j.nom === nom)?.index ?? -1;
        perso = null;
        recon.reinitialiser();
      }
      emettre(type, msg);
    });
  }

  lien.sur('instantane', (instantane) => {
    dernierInstantane = instantane;
    if (figurants) figurants.encaisser(instantane);

    /*
     * LA CORRECTION, ici et nulle part ailleurs.
     *
     * On ne corrige que si l'arène locale est bien celle de la manche annoncée — sinon on
     * appliquerait des coordonnées d'une carte à une autre, et le personnage partirait
     * dans le décor. Le cas se produit vraiment : un instantané de la manche précédente
     * peut arriver après l'annonce de la suivante.
     */
    if (perso && monIndex >= 0) {
      const moi = instantane.joueurs.find((j) => j.index === monIndex);
      if (moi) {
        const effet = recon.corriger(perso, moi, instantane.posAccusee);
        emettre('correction', { effet, moi, reference: instantane.posAccusee });
      }
    }
  });

  return {
    lien,
    get nom() { return nom; },
    get etat() { return lien.etat; },
    get manche() { return manche; },
    get monIndex() { return monIndex; },
    /** `true` quand on a été éliminé : on regarde la suite, on n'y joue plus. */
    get estSpectateur() { return monIndex < 0; },
    /** Les avatars des autres joueurs — pour les diagnostics, et rien d'autre. */
    get figurants() { return figurants; },
    get latence() { return latence; },
    get statistiques() {
      return {
        ...recon.statistiques,
        latence: Math.round(latence),
        enAttente: lien.enAttente.length,
        figurants: figurants?.avatars.length ?? 0,
      };
    },

    sur(type, fn) {
      if (!ecouteurs.has(type)) ecouteurs.set(type, new Set());
      ecouteurs.get(type).add(fn);
      return () => ecouteurs.get(type).delete(fn);
    },

    connecter() { lien.ouvrir(); return this; },
    rejoindre(mise = 0) { lien.rejoindre(mise); },
    accepter() { lien.accepter(); },

    /**
     * Le jeu vient de construire l'arène : on lui donne le personnage local et la scène.
     *
     * C'est ici que les figurants naissent — pas avant, puisqu'il faut une scène où les
     * poser, et pas après, sinon les premiers instantanés arrivent sans personne à animer.
     */
    attacher({ personnage, scene, assets }) {
      perso = personnage;

      /*
       * SANS SCÈNE, PAS DE FIGURANTS — et c'est un mode légitime, pas un cas dégradé.
       *
       * Le harnais `tools/test-harness/client.mjs` fait tourner exactement ce code pour
       * mesurer l'écart entre prédiction et autorité, sans rien afficher. La prédiction
       * n'est que de la simulation : elle n'a besoin d'aucun rendu. On le dit ici plutôt
       * que de laisser `scene.add()` échouer trois appels plus loin.
       */
      figurants = scene ? creerFigurants({ scene, assets }) : null;
      if (figurants && manche) figurants.definir(manche.joueurs, nom);
      return figurants;
    },

    /** Détache — fin de manche, retour au lobby. */
    detacher() {
      figurants?.vider();
      figurants = null;
      perso = null;
      recon.reinitialiser();
    },

    /**
     * TOUTES les positions à passer au décor — la nôtre, prédite, et celles des autres,
     * interpolées.
     *
     * C'est ce qui fait que le monde évolue pareil chez tout le monde. Le serveur passe
     * déjà toutes les positions à `arena.update` ; le client n'y passait que la sienne, et
     * ne voyait donc céder que le sol qu'il usait lui-même. Une porte enfoncée par un
     * adversaire restait fermée sur notre écran, et on le voyait la traverser.
     *
     * La nôtre est la position PRÉDITE, pas celle du serveur : notre propre porte doit
     * s'ouvrir sans attendre l'aller-retour. Celles des autres arrivent avec les cent
     * millisecondes de l'interpolation — leur porte s'ouvre donc un dixième de seconde
     * après leur passage, ce que personne ne remarque.
     */
    positions(locale) {
      /*
       * DES COPIES, jamais les objets vivants.
       *
       * `character.position` rend un `Vector3` TEMPORAIRE PARTAGÉ, réutilisé à chaque
       * appel — et les positions des figurants sont celles de leurs groupes THREE, qu'on
       * réécrit à chaque image. Les passer telles quelles à une scène qui les parcourt,
       * casse des portes et retire des colliders au passage, revient à lui donner des
       * références qui changent sous ses pieds pendant qu'elle travaille.
       *
       * Une copie coûte trois nombres par joueur et par image. C'est le prix le moins
       * cher de ce fichier.
       */
      const out = locale ? [{ x: locale.x, y: locale.y, z: locale.z }] : [];
      for (const p of figurants?.positions() ?? []) out.push({ x: p.x, y: p.y, z: p.z });
      return out;
    },

    /**
     * Envoie l'entrée de cette image.
     *
     * À appeler AVANT de simuler localement : le numéro rendu identifie l'entrée que le
     * serveur accusera, et c'est ce numéro qui permettra de savoir ce qu'il a déjà vu.
     */
    envoyer(entree) {
      dernierSeq = lien.envoyerEntree(entree);
      return dernierSeq;
    },

    /**
     * Une image de plus. À appeler APRÈS la physique.
     *
     * Deux choses : absorber la fraction d'écart qui reste, et déplacer les autres joueurs
     * à l'instant qu'ils doivent occuper à l'écran.
     */
    avancer(dt) {
      if (perso) {
        /*
         * On NOTE d'abord où l'entrée qu'on vient d'envoyer nous a menés.
         *
         * C'est le point de comparaison que le serveur nous renverra dans son accusé. Le
         * noter avant d'appliquer la correction est essentiel : sinon on enregistrerait
         * une position déjà corrigée, et la correction suivante se comparerait à
         * elle-même — l'écart mesuré tomberait à zéro alors que rien n'aurait convergé.
         */
        const p = perso.body.translation();
        lien.noterPosition(dernierSeq, { x: p.x, y: p.y, z: p.z });
        recon.appliquer(perso, dt);
      }
      figurants?.update(dt);
    },

    /**
     * Mesure de latence.
     *
     * Le serveur accuse la dernière entrée qu'il a appliquée ; le nombre d'entrées encore
     * en attente dit donc combien d'images se sont écoulées depuis. À 60 Hz, cinq entrées
     * en attente valent environ 83 ms d'aller-retour. C'est une estimation, pas un ping —
     * mais elle mesure exactement ce qui compte : le retard entre une touche pressée et sa
     * prise en compte, ce qu'un ping ne dit pas.
     */
    mesurerLatence(hz = 60) {
      // Moins un : l'historique garde l'entrée ACCUSÉE comme point de comparaison, et
      // celle-là n'est pas « en attente » — le serveur l'a justement déjà appliquée.
      const attente = Math.max(0, lien.enAttente.length - 1);
      const brut = (attente / hz) * 1000;
      // Moyenne glissante : la valeur brute saute d'une image à l'autre et serait
      // illisible affichée telle quelle.
      latence += (brut - latence) * 0.1;
      return latence;
    },

    fermer() {
      this.detacher();
      lien.fermer();
    },
  };
}
