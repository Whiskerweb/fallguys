/**
 * UNE PARTIE QUI TOURNE — l'horloge, les entrées, les instantanés.
 *
 * C'est l'objet que le serveur crée quand un salon part. Il simule à 30 Hz, diffuse à
 * 20 Hz, et n'a aucune idée de ce qu'est une WebSocket : on lui donne une fonction
 * `envoyer(nom, message)`, et il s'en sert. C'est ce qui permet de l'éprouver sans réseau,
 * dans un harnais, en lui passant une fonction qui empile dans un tableau.
 *
 * ─── LES DEUX CADENCES ──────────────────────────────────────────────────────
 *
 * La SIMULATION avance à 30 Hz, et c'est une règle : la physique doit avancer du même pas
 * partout, sinon deux serveurs de puissance différente ne produisent pas la même partie.
 *
 * La DIFFUSION se fait à 20 Hz — deux ticks sur trois. Envoyer à chaque tick coûterait
 * 50 % de bande passante pour un gain que personne ne voit : le client interpole de toute
 * façon entre deux instantanés, et l'œil ne distingue pas 20 de 30 corrections par seconde
 * sur un personnage qui se déplace de façon continue.
 *
 * ─── LE RATTRAPAGE ──────────────────────────────────────────────────────────
 *
 * `setInterval` dérive : Node ne garantit pas le réveil à l'heure, et une pause du
 * ramasse-miettes décale tout ce qui suit. On accumule donc le temps réellement écoulé et
 * on avance d'autant de ticks qu'il en faut — mais **jamais plus de quatre d'affilée**.
 * Sans ce plafond, un serveur qui prend du retard essaie de le rattraper en simulant plus
 * vite, ce qui le met encore plus en retard : c'est la spirale classique, et elle se
 * termine par un serveur qui ne répond plus. Passé quatre ticks, on abandonne le retard.
 */

import { randomInt } from 'node:crypto';
import { creerPartie } from './partie.js';
import { HZ } from './manche.js';
import { encoderInstantane } from './reseau.js';
import { creerTampon, resumer } from './tampon.js';
import { SOUS_PAS } from './tick.js';

const MS_PAR_TICK = 1000 / HZ;

/**
 * Deux ticks sur trois : exactement 20 Hz à partir d'une simulation à 30 Hz.
 *
 * Le compteur est celui de l'INSTANCE, pas celui de la manche. La distinction m'a coûté un
 * verdict : pendant le décompte, `manche.tick` reste à zéro — seul `tickDecompte` avance —
 * donc `0 % 3 !== 2` était vrai à chaque pas et l'on diffusait à 30 Hz au lieu de 20,
 * précisément dans les trois secondes où le joueur regarde le plus attentivement.
 */
const DIFFUSE = (pas) => pas % 3 !== 2;

/** Au-delà, on abandonne le retard plutôt que d'essayer de le rattraper. */
const RATTRAPAGE_MAX = 4;

/**
 * @param {object} p
 * @param {string} p.id
 * @param {number} p.graine
 * @param {Array}  p.inscrits    la grille de `salon.composer()`
 * @param {(nom: string, message: object|ArrayBuffer) => void} p.envoyer
 * @param {(resultat: object) => void} [p.surFin]
 * @param {() => number} [p.horloge] pour les tests
 */
export function creerInstance({ id, graine, inscrits, envoyer, surFin, dureeMax = 180, horloge = Date.now }) {
  const partie = creerPartie({ graine, inscrits, dureeMax });

  /*
   * Les entrées, une par joueur : la PLUS RÉCENTE reçue, et rien d'autre.
   *
   * Pas de file d'attente indexée par tick. Un client envoie à 60 Hz, le serveur consomme
   * à 30 : une file se viderait deux fois moins vite qu'elle ne se remplit, et le serveur
   * jouerait des entrées de plus en plus vieilles — un joueur verrait son personnage
   * réagir avec un retard croissant, ce qui est bien pire qu'une frame perdue.
   *
   * On garde donc la dernière connue, et on la RÉPÈTE si rien de neuf n'est arrivé. C'est
   * le comportement standard, et il a une propriété utile : un joueur dont la connexion
   * hoquette continue de courir droit plutôt que de s'arrêter net.
   */
  /*
   * L'ENTRÉE EN ATTENTE de chaque joueur — un accumulateur, pas un instantané.
   *
   * `nom -> { seq, x, z, jump, dive }`. Les axes se remplacent, les boutons s'accumulent ;
   * voir `entree()` plus bas, c'est là que se joue tout l'intérêt de cette structure.
   */
  /** Le dernier état connu de chaque coureur, pour n'annoncer que les CHANGEMENTS. */
  const sorties = new Map();

  /** Le personnage choisi par chacun, annoncé aux autres au début de chaque manche. */
  const modeles = new Map(inscrits.map((i) => [i.nom, i.modele ?? null]));

  /**
   * Un tampon d'entrées PAR JOUEUR (`tampon.js`) : les images arrivent numérotées par pas
   * de physique, et chaque sous-pas du tick en tire une. Créé au premier paquet ; un
   * joueur qui n'a jamais rien envoyé reste sous son pilote.
   */
  const tampons = new Map();
  const humains = new Set(inscrits.filter((i) => !i.estBot).map((i) => i.nom));
  const connectes = new Set(humains);

  let minuteur = null;
  let dernierReveil = 0;
  let reste = 0;
  let arretee = false;
  let pasTotal = 0;          // ticks depuis le début de l'instance, décompte compris

  /*
   * AUX CONNECTÉS, pas à tous les humains inscrits.
   *
   * Un joueur qui a QUITTÉ la partie (menu de pause) garde sa socket ouverte : il est au
   * lobby, peut-être déjà dans une autre file. Lui envoyer l'annonce de la manche suivante
   * ferait construire l'arène chez lui et le ramènerait de force dans une partie qu'il a
   * abandonnée. Un joueur dont la socket est tombée, lui, ne reçoit rien de toute façon.
   */
  const diffuser = (message) => {
    for (const nom of connectes) envoyer(nom, message);
  };

  /** Annonce la manche qui commence : le client a besoin de construire le même monde. */
  function annoncerManche() {
    const m = partie.manche;
    if (!m) return;
    // Une manche neuve : les états de la précédente ne disent plus rien, et les mêmes noms
    // reviennent. Sans cet oubli, une élimination identique à celle d'avant passerait pour
    // « inchangée » et ne serait jamais annoncée.
    sorties.clear();
    diffuser({
      type: 'manche',
      partie: id,
      numero: partie.numeroManche,
      sur: partie.paliers.length,
      epreuve: m.epreuve,
      graine: m.graine,
      decompte: m.resteDecompte(),
      // Combien de places sont en jeu. Le client l'affichait depuis sa table à seize
      // joueurs : un duel annonçait « 0/8 » alors qu'une seule place existait.
      qualifies: partie.paliers[partie.numeroManche - 1] ?? 1,
      // La correspondance index → nom, une seule fois. Les instantanés n'envoient ensuite
      // que l'index : un octet au lieu d'une chaîne, trente fois par seconde.
      /*
       * … et le PERSONNAGE de chacun, une seule fois par manche.
       *
       * Sans lui, `figurants.js` choisissait l'apparence d'un adversaire d'après sa PLACE
       * dans la partie — une fonction du numéro de siège, sans aucun rapport avec ce que
       * l'intéressé a choisi. Chacun se voyait donc correctement et voyait tous les autres
       * de travers, chaque écran montrant une distribution différente. Vu en jouant à
       * deux : le même joueur apparaissait en Trump sur une machine et en Musk sur l'autre.
       */
      joueurs: m.etatCoureurs().map((c) => ({
        index: c.index, nom: c.nom, modele: modeles.get(c.nom) ?? null,
      })),
    });
  }

  function envoyerInstantanes() {
    const m = partie.manche;
    if (!m) return;
    const etats = m.etatCoureurs();

    /*
     * QUI VIENT DE SORTIR — annoncé pendant la manche, pas à la fin.
     *
     * Le seul événement existant était `fin-manche`, diffusé quand la manche ENTIÈRE
     * s'achève. Un joueur éliminé en cours de route n'apprenait donc rien : il continuait
     * de jouer un personnage que le serveur ne pilotait plus, et sur Les Hexagones il se
     * regardait tomber sans comprendre qu'il était déjà dehors.
     *
     * On compare l'état de chacun à ce qu'il était au dernier envoi. C'est gratuit :
     * `etatCoureurs()` est déjà calculé ici pour les instantanés, on ne le refait pas.
     *
     * L'annonce part à TOUT LE MONDE : savoir qui reste est une information de jeu, pas un
     * message privé.
     */
    for (const c of etats) {
      if (sorties.get(c.nom) === c.etat) continue;
      sorties.set(c.nom, c.etat);
      if (c.etat === 'court') continue;   // état initial, rien à annoncer
      // `abandon` : parti de lui-même, pas tombé. Les autres doivent pouvoir le lire.
      diffuser({ type: 'sorti', nom: c.nom, etat: c.etat, abandon: Boolean(c.abandon), restants: etats.filter((x) => x.etat === 'court').length });
    }

    for (const nom of humains) {
      // L'accusé est propre à chaque destinataire : c'est le numéro de SA dernière entrée
      // appliquée, sans quoi il ne peut pas réconcilier sa prédiction.
      const accuse = tampons.get(nom)?.accuse ?? 0;
      envoyer(nom, encoderInstantane(m.tick, etats, accuse));
    }
  }

  /**
   * Les entrées à jouer ce tick, par joueur : UNE IMAGE PAR SOUS-PAS, tirée du tampon.
   *
   * La valeur rendue est le résumé du tick (`resumer`) — axes de la dernière image,
   * boutons de toutes — augmenté de `pas`, les images elles-mêmes. `avancerJeu` joue
   * `pas` ; les espions des tests lisent le résumé. Les images sont des objets NEUFS à
   * chaque tick : `avancerTick` peut y effacer les fronts sans toucher au tampon.
   */
  function consommerEntrees() {
    const carte = new Map();
    for (const [nom, tampon] of tampons) carte.set(nom, resumer(tampon.tirer(SOUS_PAS, pasTotal)));
    return carte;
  }

  /**
   * LA ROUE TIRE ICI, AU CLASSEMENT FINAL — décision du directeur produit, 2 septembre 2026.
   *
   * Une graine de 32 bits, au hasard CRYPTOGRAPHIQUE et non de la graine de partie : la
   * graine de partie est publiée à l'annonce de la manche 1, et tout ce qui en dérive est
   * prévisible avant le départ. Celle-ci n'existe qu'à la fin, et voyage dans `fin-partie`
   * puis jusqu'au grand livre. Client et backend en DÉRIVENT la ligne du tableau avec le
   * même mélangeur ; personne ne déclare une issue, tout le monde recalcule la même.
   *
   * C'est le SEUL générateur aléatoire du serveur, et il n'est pas dans le monde du jeu :
   * la règle « aucun aléa dans la simulation » tient toujours. Ce qu'il fait au § 5 de la
   * spec est consigné dans l'amendement du 2 septembre ; ce n'est pas ce fichier qui
   * l'a décidé.
   */
  function tirerLaRoue(resultat) {
    if (!resultat.roue) resultat.roue = { graine: randomInt(0, 0x1_0000_0000) };
    return resultat.roue;
  }

  function unTick() {
    const evenements = partie.avancer(consommerEntrees());

    if (evenements.finManche) {
      diffuser({
        type: 'fin-manche',
        numero: evenements.finManche.manche ?? partie.numeroManche - 1,
        epreuve: evenements.finManche.epreuve,
        classement: evenements.finManche.classement,
        qualifies: evenements.finManche.qualifies,
      });
    }

    if (evenements.finPartie) {
      const roue = tirerLaRoue(evenements.finPartie);
      diffuser({ type: 'fin-partie', partie: id, classement: evenements.finPartie.classement, roue });
      arreter();
      surFin?.(evenements.finPartie);
      return true;
    }

    // Une nouvelle manche vient de s'ouvrir : le client doit reconstruire son monde.
    if (evenements.finManche && partie.manche) annoncerManche();
    return false;
  }

  function boucle() {
    if (arretee) return;

    const maintenant = horloge();
    reste += maintenant - dernierReveil;
    dernierReveil = maintenant;

    let pas = 0;
    while (reste >= MS_PAR_TICK && pas < RATTRAPAGE_MAX) {
      reste -= MS_PAR_TICK;
      pas++;
      pasTotal++;
      if (unTick()) return;
      if (partie.manche && DIFFUSE(pasTotal)) envoyerInstantanes();
    }

    /*
     * Retard abandonné. On le SIGNALE plutôt que de l'absorber en silence : un serveur qui
     * saute des ticks régulièrement est un serveur surchargé, et c'est exactement ce qu'on
     * veut voir dans un journal avant que les joueurs s'en plaignent.
     */
    if (reste >= MS_PAR_TICK) {
      const perdus = Math.floor(reste / MS_PAR_TICK);
      reste = 0;
      console.warn(`[${id}] retard : ${perdus} tick(s) abandonné(s)`);
    }
  }

  function arreter() {
    if (arretee) return;
    arretee = true;
    clearInterval(minuteur);
    minuteur = null;
    partie.interrompre();
  }

  return {
    id,
    graine,
    get partie() { return partie; },
    get arretee() { return arretee; },
    get joueurs() { return inscrits.map((i) => i.nom); },
    get connectes() { return [...connectes]; },

    demarrer() {
      partie.demarrer();
      annoncerManche();
      dernierReveil = horloge();
      // On réveille plus souvent que le tick : la boucle décide elle-même combien de pas
      // avancer, donc un réveil trop précoce ne coûte rien, alors qu'un réveil trop tardif
      // se paie en latence pour tout le monde.
      minuteur = setInterval(boucle, MS_PAR_TICK / 2);
      return this;
    },

    /**
     * Une entrée arrive du réseau : on la range dans le tampon du joueur.
     *
     * ─── UN AXE EST UN ÉTAT, UN BOUTON EST UN ÉVÉNEMENT — ET DÉSORMAIS, UNE IMAGE EST
     * UN PAS ────────────────────────────────────────────────────────────────
     *
     * L'ancienne version ne gardait que la dernière entrée reçue, en accumulant les
     * boutons par OU : elle avait rendu leurs sauts aux joueurs (16 demandés, 10 joués,
     * avant elle), mais elle rejouait cette entrée à chaque tick sans attendre les
     * suivantes, et accusait toujours le même numéro. Sa position « à l'entrée N »
     * portait donc l'aller-retour complet — 2 m à 300 ms — et le client recalait à sec
     * vingt fois par seconde. C'est le tampon (`tampon.js`) qui tient la règle
     * maintenant : chaque image est jouée une fois, à son rang, par un sous-pas.
     *
     * La redondance garde son rôle : chaque paquet porte les trois dernières images, et on
     * range celles qu'on n'a pas encore. Ce qui est plus vieux que ce qu'on a déjà est
     * ignoré en bloc — rejouer une entrée périmée ferait revenir le personnage en arrière.
     */
    entree(nom, { tick: seq, frames }) {
      let tampon = tampons.get(nom);
      if (!tampon) { tampon = creerTampon({ sousPas: SOUS_PAS }); tampons.set(nom, tampon); }
      return tampon.deposer(seq, frames);
    },

    /** L'état des tampons, par joueur — pour les diagnostics et les tests. */
    get reseau() {
      return Object.fromEntries([...tampons].map(([nom, t]) => [nom, t.statistiques]));
    },

    /**
     * Un joueur se déconnecte — ou quitte par le menu : c'est un ABANDON.
     *
     * Il est éliminé de la manche en cours, sur-le-champ (`manche.js:abandonner`). La
     * partie ne s'arrête pas pour autant : les autres continuent, et dans un duel l'autre
     * gagne aussitôt. Décision produit du 2 septembre 2026 ; avant, son personnage passait
     * en pilotage automatique et l'adversaire d'un 1v1 jouait seul contre un pantin.
     *
     * Ce qui vaut pour un onglet fermé vaut pour une coupure réseau : le lien du client
     * réessaie, mais la manche ne l'attend pas. Une partie à mises ne peut pas suspendre
     * quinze joueurs le temps qu'un seizième retrouve son wifi.
     *
     * Son tampon est jeté, sinon un corps figé garderait une touche pressée.
     */
    deconnecter(nom) {
      connectes.delete(nom);
      tampons.delete(nom);
      partie.abandonner?.(nom);
      if (!connectes.size) {
        // Plus personne au bout du fil : inutile de simuler pour des bots. On clôt, et le
        // classement produit reste valide — il décrit ce qui s'est réellement passé.
        arreter();
        tirerLaRoue(partie.resultat);
        surFin?.(partie.resultat);
      }
    },

    reconnecter(nom) {
      if (humains.has(nom)) connectes.add(nom);
      return humains.has(nom);
    },

    arreter,
  };
}
