/**
 * LA SESSION EN LIGNE — ce que le jeu appelle, et rien de plus.
 *
 * Elle assemble les trois pièces : le lien (`lien.js`), la correction de position
 * (`reconciliation.js`) et les autres joueurs (`figurants.js`). Le reste du jeu n'a que
 * cinq choses à faire, et c'est délibéré — `main.js` est édité par plusieurs mains, il
 * ne doit pas devenir le lieu où vit le netcode :
 *
 *   1. `sur('manche', …)`  construire l'arène annoncée par le serveur ;
 *   2. `attacher(...)`     donner le personnage local et la scène ;
 *   3. `envoyer(entree)`   avant CHAQUE PAS DE PHYSIQUE, au lieu de simuler dans le vide ;
 *   4. `noterPas()`        après ce pas — où l'entrée nous a menés ;
 *   5. `avancer(dt)`       à chaque image, après la physique.
 *
 * ─── UNE ENTRÉE PAR PAS, PAS PAR IMAGE ──────────────────────────────────────
 *
 * Le numéro d'une entrée compte les PAS de 1/60 s, pas les images rendues. Un écran à
 * 120 Hz envoyait deux entrées par pas, une page à 30 images par seconde une entrée pour
 * deux pas, et le serveur — qui rejouait la dernière reçue à chaque tick — n'avait aucun
 * moyen de jouer les mêmes pas que le client. Depuis le tampon d'entrées du serveur
 * (`serveur/src/tampon.js`), chaque numéro est joué UNE fois, par UN sous-pas, dans
 * l'ordre : la position accusée pour l'entrée N est comparable à celle qu'on a notée
 * après le pas N, et l'écart ne porte plus la latence.
 *
 * ─── LA GRAINE VIENT DU SERVEUR ─────────────────────────────────────────────
 *
 * En solo, le client tire la carte et sa graine. En ligne, il ne tire PLUS RIEN : le
 * serveur annonce l'épreuve et la graine, et le client construit exactement le même monde.
 * C'est ce qui rend la prédiction possible — deux mondes différents ne se corrigent pas,
 * ils divergent.
 */

import { creerLien, PLAFOND_HISTORIQUE } from './lien.js';
import { HZ } from './protocole.js';
import { creerReconciliation } from './reconciliation.js';
import { creerFigurants } from './figurants.js';

export function creerSession({ url, nom, jeton = null }) {
  const lien = creerLien({ url, nom, jeton });
  const recon = creerReconciliation();

  let figurants = null;
  let perso = null;
  let monIndex = -1;
  /** Sorti de la manche en cours — éliminé OU qualifié. Remis à faux à chaque manche. */
  let sorti = false;
  /** Sorti PAR ÉLIMINATION : on regarde la suite, on n'y joue plus. */
  let elimine = false;
  let manche = null;              // la dernière annonce reçue
  let dernierInstantane = null;
  /** Quand le dernier instantané est arrivé, pour faire avancer l'horloge du monde entre deux. */
  let instantaneRecuA = 0;
  let latence = 0;                // aller-retour estimé, en ms
  let dernierSeq = 0;             // le numéro de la dernière entrée envoyée
  let dernierAccuse = -1;         // le dernier numéro que le serveur a accusé ET qu'on a comparé

  const ecouteurs = new Map();
  const emettre = (type, d) => { for (const fn of ecouteurs.get(type) ?? []) fn(d); };

  // On relaie les messages du serveur tels quels : le jeu s'abonne à ce qui l'intéresse.
  // `files` et `suggestion` sont le lobby vu du serveur : qui attend où, et où l'on
  // ferait mieux d'aller. `engagement` et `reglement` sont l'ARGENT vu du serveur : les
  // mises qui partent avant la manche 1, le gain payé après le classement. Un type absent
  // de cette liste n'atteint JAMAIS le jeu — c'est ainsi que le solde restait figé après
  // une partie payée : le règlement arrivait, personne ne l'écoutait.
  for (const type of ['bienvenue', 'salon', 'manche', 'fin-manche', 'fin-partie', 'refus', 'etat', 'sorti', 'files', 'suggestion', 'engagement', 'reglement']) {
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
        sorti = false;        // manche neuve, on repart en course
        elimine = false;
        dernierAccuse = -1;
        recon.reinitialiser();
      }
      /*
       * SORTI DE LA MANCHE, ANNONCÉ EN COURS DE ROUTE.
       *
       * Avant, rien ne le disait : le seul événement était la fin de manche. Un joueur
       * tombé sur Les Hexagones continuait donc de piloter un personnage que le serveur ne
       * simulait plus, et se regardait chuter sans comprendre qu'il était déjà dehors.
       */
      /*
       * ET UN QUALIFIÉ EST SORTI AUSSI. Le serveur fige le corps d'un joueur qui vient de
       * franchir la ligne exactement comme celui d'un éliminé (`manche.js:finir`) ; le
       * client doit cesser de le piloter de la même façon, sinon il pousse un corps sans
       * gravité que la correction rappelle à chaque image. Ce verrou ne retenait que
       * l'élimination : un vainqueur croyait piloter encore.
       */
      if (type === 'sorti' && msg.nom === nom) { sorti = true; elimine = msg.etat === 'elimine'; }
      emettre(type, msg);
    });
  }

  lien.sur('instantane', (instantane) => {
    dernierInstantane = instantane;
    instantaneRecuA = performance.now() / 1000;
    if (figurants) figurants.encaisser(instantane);

    /*
     * LA CORRECTION, ici et nulle part ailleurs.
     *
     * On ne corrige que si l'arène locale est bien celle de la manche annoncée — sinon on
     * appliquerait des coordonnées d'une carte à une autre, et le personnage partirait
     * dans le décor. Le cas se produit vraiment : un instantané de la manche précédente
     * peut arriver après l'annonce de la suivante.
     */
    /*
     * ET SEULEMENT SI LE SERVEUR A JOUÉ QUELQUE CHOSE DE NEUF.
     *
     * Quand son tampon est vide — nos entrées sont en route, ou coincées derrière une
     * perte — le serveur EXTRAPOLE et accuse toujours le même numéro. Sa position n'est
     * alors plus celle de l'entrée N : il a continué sans nous, et la comparer à ce qu'on
     * avait noté à N mesurerait le retard du réseau, pas un désaccord. C'était exactement
     * l'ancien défaut, et il téléportait le joueur. On attend le prochain numéro neuf.
     */
    /*
     * ET PAS PENDANT LE DÉCOMPTE.
     *
     * Le serveur simule dès qu'il annonce la manche ; nous, dès que l'arène est construite,
     * un aller simple plus tard. Pendant ce temps le personnage TOMBE de sa place de
     * départ (2,4 m) sur le sol (0,8 m) — et à notre premier pas, le serveur a déjà
     * atterri. Comparer nos premiers pas aux siens mesurait cette chute : 1,6 m vers le
     * bas, appliqués d'un coup à un corps déjà posé, qui passait alors SOUS le sol et
     * tombait sans fin. Vu au banc `gigue.mjs`, une fois sur deux. Pendant le décompte
     * (`tick` nul), tout le monde est immobile une fois posé : il n'y a rien à corriger.
     */
    if (perso && monIndex >= 0 && instantane.tick > 0 && instantane.accuse !== dernierAccuse) {
      const moi = instantane.joueurs.find((j) => j.index === monIndex);
      if (moi) {
        dernierAccuse = instantane.accuse;
        const effet = recon.corriger(perso, moi, instantane.posAccusee);
        // Ce qu'on vient de corriger vaut aussi pour tout ce qu'on a noté depuis : voir
        // `lien.decaler` — sans lui, la même correction se réappliquait à chaque accusé.
        if (effet !== 'ignore') lien.decaler(instantane.accuse, recon.derniereCorrection);
        emettre('correction', { effet, moi, reference: instantane.posAccusee, accuse: instantane.accuse });
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

    /**
     * L'HORLOGE DU DÉCOR — celle du serveur, pas celle de la page.
     *
     * Le décor s'anime en fonction du temps écoulé, et cette animation déplace de VRAIS
     * colliders : sur Le Rondin, l'angle d'un tronc est une fonction pure de ce nombre, et
     * il pilote le visuel comme la physique.
     *
     * Le client comptait ce temps depuis l'ouverture de la page — plusieurs minutes, en
     * général — tandis que le serveur repart de zéro à chaque manche. Les troncs n'étaient
     * donc pas au même angle des deux côtés : le joueur heurtait un obstacle absent de son
     * écran, et se faisait corriger par un monde qu'il ne voyait pas. Pire, chaque page
     * ayant son propre décalage, deux joueurs ne partageaient même pas le même décor.
     *
     * On repart donc du tick AUTORITAIRE, et on le prolonge du temps écoulé depuis son
     * arrivée — sans quoi le décor avancerait par à-coups de vingt images par seconde
     * entre deux instantanés.
     *
     * Vaut zéro tant qu'aucun instantané n'est arrivé : c'est exactement ce que le serveur
     * passe au premier tick de jeu.
     */
    get tempsMonde() {
      if (!dernierInstantane) return 0;
      return dernierInstantane.tick / HZ + Math.max(0, performance.now() / 1000 - instantaneRecuA);
    },
    /** Vrai tant que le serveur n'a pas joué son premier tick de jeu : le décompte, vu de lui. */
    get enDecompte() { return !dernierInstantane || dernierInstantane.tick === 0; },
    /** Éliminé pendant la manche en cours : le serveur ne pilote plus ce personnage. */
    get estElimine() { return elimine; },
    /** Sorti de la manche, éliminé ou qualifié : le serveur a figé ce personnage. */
    get estSorti() { return sorti; },
    /** Les avatars des autres joueurs — pour les diagnostics, et rien d'autre. */
    get figurants() { return figurants; },
    get latence() { return latence; },
    get statistiques() {
      return {
        ...recon.statistiques,
        latence: latence === null ? null : Math.round(latence),
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
    rejoindre(mise = 0, modele = null, mode = 'arena') { lien.rejoindre(mise, modele, mode); },
    basculer(mise = 0, mode = 'arena') { lien.basculer(mise, mode); },
    quitter() { lien.quitter(); },

    /**
     * Le jeu vient de construire l'arène : on lui donne le personnage local et la scène.
     *
     * C'est ici que les figurants naissent — pas avant, puisqu'il faut une scène où les
     * poser, et pas après, sinon les premiers instantanés arrivent sans personne à animer.
     */
    attacher({ personnage, scene, assets, placeDe = null }) {
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
      // Chacun sur SA place, avant tout instantané : voir `figurants.poser`.
      if (figurants && placeDe) figurants.poser(placeDe);
      return figurants;
    },

    /** Détache — fin de manche, retour au lobby. */
    detacher() {
      figurants?.vider();
      figurants = null;
      perso = null;
      recon.reinitialiser();
      /*
       * ET ON OUBLIE LES ENTRÉES EN ATTENTE.
       *
       * Elles appartenaient à la manche qui vient de finir. Les garder laisse un
       * historique plein que plus rien n'accusera jamais, et la latence qu'on en déduit se
       * fige alors à sa valeur de saturation. Vu sur deux machines à la fois, affichant
       * 1983 ms exactement — soit 119 images à 60 Hz, c'est-à-dire le plafond.
       */
      lien.oublier();
      latence = 0;
      dernierAccuse = -1;
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
     * Envoie l'entrée d'UN PAS DE PHYSIQUE.
     *
     * À appeler AVANT chaque `world.step()`, jamais une fois par image : le numéro rendu
     * identifie le pas que le serveur jouera et accusera. Une image qui fait deux pas
     * envoie deux entrées ; une image qui n'en fait aucun n'envoie rien.
     */
    envoyer(entree) {
      dernierSeq = lien.envoyerEntree(entree);
      return dernierSeq;
    },

    /**
     * Le pas est joué : on note où il nous a menés.
     *
     * C'est le point de comparaison que le serveur nous renverra dans son accusé. Le
     * noter AVANT toute correction est essentiel : sinon on enregistrerait une position
     * déjà corrigée, et la correction suivante se comparerait à elle-même — l'écart
     * mesuré tomberait à zéro alors que rien n'aurait convergé.
     *
     * @param {number} [seq] le pas qu'on note — le dernier envoyé, sauf à en avoir envoyé
     *   plusieurs avant de simuler, comme le client sans navigateur des tests.
     */
    noterPas(seq = dernierSeq) {
      if (!perso) return;
      const p = perso.body.translation();
      lien.noterPosition(seq, { x: p.x, y: p.y, z: p.z });
    },

    /**
     * Une image de plus. À appeler APRÈS la physique.
     *
     * Deux choses : absorber la fraction d'écart qui reste, et déplacer les autres joueurs
     * à l'instant qu'ils doivent occuper à l'écran.
     */
    avancer(dt) {
      if (perso) recon.appliquer(perso, dt);
      figurants?.update(dt);
    },

    /**
     * Mesure de latence.
     *
     * Le serveur accuse la dernière entrée qu'il a appliquée ; le nombre d'entrées encore
     * en attente dit donc combien de PAS se sont écoulés depuis. À 60 pas par seconde,
     * cinq entrées en attente valent environ 83 ms. C'est une estimation, pas un ping —
     * mais elle mesure exactement ce qui compte : le retard entre une touche pressée et sa
     * prise en compte, tampon du serveur compris, ce qu'un ping ne dit pas. Et comme une
     * entrée est un pas, la mesure ne dépend plus de la cadence d'affichage — avant, un
     * écran à 120 Hz la doublait.
     */
    mesurerLatence(hz = 60) {
      // Moins un : l'historique garde l'entrée ACCUSÉE comme point de comparaison, et
      // celle-là n'est pas « en attente » — le serveur l'a justement déjà appliquée.
      const attente = Math.max(0, lien.enAttente.length - 1);

      /*
       * SATURÉ : on ne sait pas, et on le dit.
       *
       * L'historique bute sur son plafond exactement quand le serveur n'accuse plus rien.
       * Le nombre d'entrées en attente ne mesure alors plus un retard, il mesure la taille
       * du tampon — une constante. La rendre comme une latence affichait 1983 ms, la même
       * sur toutes les machines, ce qui est le symptôme et non la mesure.
       */
      if (attente >= PLAFOND_HISTORIQUE - 1) { latence = null; return null; }

      const brut = (attente / hz) * 1000;
      if (latence === null) latence = brut;   // on repart de la mesure, pas de zéro
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
