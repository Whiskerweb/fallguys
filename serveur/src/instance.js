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

import { creerPartie } from './partie.js';
import { HZ } from './manche.js';
import { encoderInstantane } from './reseau.js';

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
  const entrees = new Map();   // nom -> { seq, frame }
  const humains = new Set(inscrits.filter((i) => !i.estBot).map((i) => i.nom));
  const connectes = new Set(humains);

  let minuteur = null;
  let dernierReveil = 0;
  let reste = 0;
  let arretee = false;
  let pasTotal = 0;          // ticks depuis le début de l'instance, décompte compris

  const diffuser = (message) => {
    for (const nom of humains) envoyer(nom, message);
  };

  /** Annonce la manche qui commence : le client a besoin de construire le même monde. */
  function annoncerManche() {
    const m = partie.manche;
    if (!m) return;
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
      joueurs: m.etatCoureurs().map((c) => ({ index: c.index, nom: c.nom })),
    });
  }

  function envoyerInstantanes() {
    const m = partie.manche;
    if (!m) return;
    const etats = m.etatCoureurs();
    for (const nom of humains) {
      // L'accusé est propre à chaque destinataire : c'est le numéro de SA dernière entrée
      // appliquée, sans quoi il ne peut pas réconcilier sa prédiction.
      const accuse = entrees.get(nom)?.seq ?? 0;
      envoyer(nom, encoderInstantane(m.tick, etats, accuse));
    }
  }

  function unTick() {
    const evenements = partie.avancer(
      new Map([...entrees].map(([nom, e]) => [nom, e.frame])),
    );

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
      diffuser({ type: 'fin-partie', partie: id, classement: evenements.finPartie.classement });
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
     * Une entrée arrive du réseau.
     *
     * On ignore ce qui est plus VIEUX que ce qu'on a déjà : les paquets arrivent dans le
     * désordre, et rejouer une entrée périmée ferait revenir le personnage en arrière.
     */
    entree(nom, { tick: seq, frames }) {
      const courant = entrees.get(nom);
      if (courant && seq <= courant.seq) return false;
      entrees.set(nom, { seq, frame: frames[frames.length - 1] });
      return true;
    },

    /**
     * Un joueur se déconnecte.
     *
     * Sa place N'EST PAS libérée et la partie ne s'arrête pas : son personnage passe sous
     * le pilotage de son `pilote`, comme un bot. Figer une partie de seize parce qu'un
     * joueur a fermé son onglet punirait quinze personnes pour la décision d'une seule.
     *
     * Sa dernière entrée est effacée, sinon il continuerait à courir droit devant lui
     * jusqu'à la fin de la manche, sur la foi d'une touche qu'il ne presse plus.
     */
    deconnecter(nom) {
      connectes.delete(nom);
      entrees.delete(nom);
      if (!connectes.size) {
        // Plus personne au bout du fil : inutile de simuler pour des bots. On clôt, et le
        // classement produit reste valide — il décrit ce qui s'est réellement passé.
        arreter();
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
