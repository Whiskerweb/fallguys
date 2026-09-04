/**
 * UNE MANCHE, arbitrée par le serveur — et AVANÇABLE PAS À PAS.
 *
 * C'est ici que le classement se décide. Le navigateur le déclarait et le backend le
 * croyait sur parole : c'est la condition n°1 du verrou mainnet (`backend/README.md`),
 * et ce fichier est ce qui la lève.
 *
 * ─── POURQUOI UN OBJET PLUTÔT QU'UNE FONCTION ───────────────────────────────
 *
 * La première version jouait la manche ENTIÈRE dans une boucle bloquante. Parfait pour un
 * banc d'essai — on veut la réponse le plus vite possible — et inutilisable en ligne : un
 * serveur doit avancer d'un tick, rendre la main, encaisser les entrées arrivées par le
 * réseau, puis avancer du tick suivant. Une boucle qui ne rend jamais la main ne peut rien
 * recevoir.
 *
 * `creerManche()` rend donc un objet dont on appelle `avancer()`. Deux pilotes possibles,
 * et c'est tout l'intérêt :
 *
 *   - le HARNAIS l'appelle en boucle serrée, aussi vite que la machine le permet ;
 *   - le SERVEUR l'appelle sur une horloge à 30 Hz, entre deux paquets.
 *
 * La simulation ne voit aucune différence — c'est la même suite de ticks. `jouerManche()`
 * est conservée comme enveloppe : elle boucle sur `avancer()` jusqu'à la fin, ce qui garde
 * le harnais et les tests inchangés.
 *
 * ─── LES DEUX RÈGLES DE FIN ─────────────────────────────────────────────────
 *
 *   - COURSE : on est qualifié en franchissant `finishZ`. Tomber sous `killY` fait
 *              RÉAPPARAÎTRE au dernier point de passage, ça n'élimine pas.
 *   - SURVIE : on est qualifié en tenant `survie.duree`. Tomber sous `killY` ÉLIMINE,
 *              définitivement, sans réapparition.
 *
 * L'inverser rendrait Les Hexagones ingagnables et La Course interminable. La scène est
 * la seule à savoir laquelle des deux s'applique.
 */

import { construire, creerPerso, liberer as libererMonde } from './monde.js';
import { avancerTick } from './tick.js';

/** 30 Hz. La valeur que la spec fixe pour le tick de simulation (section 6.2). */
export const HZ = 30;
export const DT = 1 / HZ;

/** Décompte avant le départ, en secondes. Le jeu en affiche trois. */
export const DECOMPTE = 3;

/** Les phases d'une manche, dans l'ordre. */
export const PHASE = { DECOMPTE: 'decompte', EN_JEU: 'en-jeu', FINIE: 'finie' };

/**
 * Crée une manche prête à être avancée.
 *
 * @param {object} p
 * @param {string} p.epreuve   identifiant de carte
 * @param {number} p.graine
 * @param {Array}  p.inscrits  `[{ nom, faire(monde, perso, index) -> pilote }]`
 * @param {number} p.qualifies combien passent au tour suivant
 * @param {number} [p.dureeMax] garde-fou en secondes
 */
export function creerManche({ epreuve, graine, inscrits, qualifies, dureeMax = 240 }) {
  const monde = construire(epreuve, graine);

  const coureurs = inscrits.map((inscrit, i) => {
    const perso = creerPerso(monde, i, inscrits.length);
    return {
      nom: inscrit.nom,
      index: i,
      perso,
      pilote: inscrit.faire(monde, perso, i),
      etat: 'court',          // 'court' | 'qualifie' | 'elimine'
      temps: null,            // secondes écoulées à la qualification ou à l'élimination
      progres: 0,             // fraction du parcours, ou secondes tenues
      chutes: 0,
      abandon: false,         // parti en cours de manche : éliminé, et jamais repêché
    };
  });

  const departZ = monde.spawn.z;
  const distanceTotale = Math.max(1, departZ - monde.finishZ);
  const ticksDecompte = DECOMPTE * HZ;
  const maxTicks = dureeMax * HZ;

  let tick = 0;              // ticks écoulés DEPUIS le départ (le décompte est en négatif)
  let tickDecompte = 0;
  let places = 0;            // combien de places de qualifié sont déjà prises
  let phase = PHASE.DECOMPTE;
  let resultat = null;
  let libere = false;

  const inerte = () => ({ x: 0, z: 0, jump: false, dive: false });

  /**
   * Un coureur a fini sa manche — qualifié ou éliminé.
   *
   * ─── ET SON CORPS S'ARRÊTE ──────────────────────────────────────────────────
   *
   * Changer l'état ne suffisait pas. Un coureur qui a fini n'est plus passé à
   * `avancerTick` — donc plus piloté, et surtout plus borné par `limiterVitesse()` — mais
   * son corps rigide reste dans le monde physique, et `world.step()` continue de le faire
   * tomber. Mesuré sur Les Hexagones : le joueur éliminé au tick 96 se trouvait à −58 m au
   * tick 120, −206 m au tick 180, −802 m au tick 300.
   *
   * Comme les instantanés publient TOUS les coureurs, éliminés compris, le joueur recevait
   * vingt fois par seconde sa propre position en chute libre, et la correction l'y suivait
   * fidèlement : il se regardait tomber sans fin.
   *
   * On coupe donc la gravité et on annule les vitesses. Le corps reste dans le monde — le
   * retirer invaliderait des références que la manche détient encore — mais il ne bouge
   * plus. En course, ça vaut aussi pour un qualifié : il s'arrête sur la ligne au lieu de
   * continuer sa course pendant que les autres finissent.
   */
  function finir(c, etat, t) {
    c.etat = etat;
    c.temps = t;
    if (etat === 'qualifie') places++;

    const corps = c.perso?.body;
    if (corps) {
      corps.setLinvel({ x: 0, y: 0, z: 0 }, true);
      corps.setAngvel({ x: 0, y: 0, z: 0 }, true);
      corps.setGravityScale(0, true);
    }
  }

  /**
   * Un tick de décompte.
   *
   * La physique TOURNE — les personnages se posent — mais aucune entrée n'est lue, et
   * `enJeu = false` empêche le terrain de céder. Sur Les Hexagones, un sol qui céderait
   * pendant ces trois secondes perdrait la manche avant qu'elle commence.
   */
  function avancerDecompte() {
    avancerTick(
      monde,
      coureurs.map((c) => ({ perso: c.perso, entree: inerte() })),
      tickDecompte / HZ, DT, false,
    );
    tickDecompte++;
    if (tickDecompte >= ticksDecompte) phase = PHASE.EN_JEU;
  }

  /** Un tick de jeu. Rend `true` si la manche vient de se terminer. */
  function avancerJeu(entreesReseau) {
    const t = tick / HZ;
    const enCourse = coureurs.filter((c) => c.etat === 'court');

    /*
     * ─── DEUX FAÇONS DE GAGNER, ET LA SECONDE MANQUAIT ───────────────────────
     *
     * `places >= qualifies` est la règle d'une COURSE : on gagne en franchissant quelque
     * chose. En SURVIE il n'y a rien à franchir — on gagne parce que les autres sont
     * tombés. Le sol est de la lave, les plateformes sont le salut, et le système est
     * inversé.
     *
     * Sans la condition ci-dessous, un duel sur Les Hexagones se passait ainsi : l'un
     * tombe et se fait éliminer ; `places` vaut toujours zéro, donc la manche CONTINUE ;
     * le survivant joue seul jusqu'à tomber à son tour ; et les deux se retrouvent
     * éliminés à l'écran, sans vainqueur apparent. Rapporté en jouant, deux fois.
     *
     * `places + enCourse.length <= qualifies` dit : « ceux qui restent tiennent tous dans
     * les places à pourvoir ». Il n'y a alors plus rien à départager, et les faire jouer
     * plus longtemps ne changerait aucun classement.
     *
     * Elle ne change RIEN aux courses : tomber n'y élimine pas, donc `enCourse` ne se vide
     * qu'à mesure que les joueurs franchissent la ligne — et `places` grandit d'autant, si
     * bien que `places >= qualifies` se déclenche toujours en premier.
     */
    if (!enCourse.length || places >= qualifies || places + enCourse.length <= qualifies
        || tick >= maxTicks) {
      clore();
      return true;
    }

    /*
     * L'ENTRÉE D'UN COUREUR VIENT DU RÉSEAU, OU DE SON PILOTE.
     *
     * Un joueur distant fournit une `InputFrame` ; un bot la calcule. Les deux produisent
     * la même forme, et la simulation ne sait pas laquelle elle traite — c'est ce qui
     * permet à une partie de mélanger humains et bots sans code particulier, et à un
     * joueur déconnecté de continuer sous pilotage automatique plutôt que de figer la
     * partie des quinze autres.
     */
    avancerTick(
      monde,
      enCourse.map((c) => {
        const reseau = entreesReseau?.get(c.nom);
        // Un joueur réseau apporte ses images UNE PAR SOUS-PAS (`pas`, voir `tampon.js`) ;
        // un bot rend une entrée par tick. `avancerTick` sait jouer les deux formes.
        if (reseau?.pas) return { perso: c.perso, entrees: reseau.pas };
        return { perso: c.perso, entree: reseau ?? c.pilote.entree(tick, c.perso, monde) };
      }),
      t, DT, true,
    );

    /*
     * ON QUALIFIE EN BLOC, PAS COUREUR PAR COUREUR — parce qu'il y a un nombre de PLACES.
     *
     * `places >= qualifies` arrête bien la manche au tick suivant, mais n'a jamais tronqué
     * quoi que ce soit : c'est une condition d'arrêt, pas un plafond. Deux cas le
     * franchissaient.
     *
     *   EN SURVIE, `t` est l'horloge de la MANCHE, la même pour tout le monde. Au tick où
     *   elle atteint la durée, tous les survivants étaient qualifiés d'un coup — quatre
     *   vainqueurs pour une place en finale d'arène. Le classement les départageait
     *   ensuite par leur temps, identique, donc par rien.
     *
     *   EN COURSE, deux joueurs qui franchissent la ligne au MÊME tick donnaient deux
     *   qualifiés pour une place. Trente-trois millisecondes de coïncidence, mais dans une
     *   partie à mises c'est une couronne de trop.
     *
     * On collecte donc, puis on tranche avec une mesure de JEU — jamais l'ordre du tableau.
     */
    const cloche = Boolean(monde.survie) && t >= monde.duree;
    const debout = [];      // survie : ceux qui tiennent encore quand l'horloge tombe
    const arrivants = [];   // course : ceux qui ont franchi la ligne à CE tick

    for (const c of enCourse) {
      const p = c.perso.body.translation();

      if (monde.survie) {
        c.progres = t;
        if (p.y < monde.killY) { finir(c, 'elimine', t); continue; }
        if (cloche) { debout.push({ c, y: p.y }); continue; }
      } else {
        c.progres = Math.max(c.progres, Math.min(1, (departZ - p.z) / distanceTotale));
        if (p.y < monde.killY) {
          // En course, tomber ne tue pas : on réapparaît au dernier point de passage. On
          // compte la chute — c'est ce qui départage deux joueurs éliminés au même endroit.
          c.chutes++;
          c.perso.respawn(monde.arene.checkpointFor?.(p.z) ?? monde.spawn);
          continue;
        }
        if (p.z <= monde.finishZ) { arrivants.push({ c, z: p.z }); continue; }
      }
    }

    /*
     * L'HORLOGE DE SURVIE TOMBE : on départage à l'ALTITUDE.
     *
     * Sur une tour dont les dalles disparaissent sous les pieds, celui qui est le plus haut
     * en a consommé le moins — c'est une mesure de jeu, disponible à l'instant même, et
     * c'est du skill démontrable. Les autres sont éliminés, classés par la même altitude :
     * ils ont tenu la durée, ils sont simplement descendus plus bas.
     */
    if (cloche) {
      debout.sort((a, b) => b.y - a.y);
      for (const { c } of debout) finir(c, places < qualifies ? 'qualifie' : 'elimine', t);
    }

    /*
     * PLUSIEURS ARRIVÉES AU MÊME TICK : le plus ENGAGÉ au-delà de la ligne est passé le
     * premier. Ceux qui restent gardent leur état — la manche se ferme au tick suivant et
     * le classement les prendra à leur avancement, qui vaut déjà 1.
     */
    if (arrivants.length) {
      arrivants.sort((a, b) => a.z - b.z);
      for (const { c } of arrivants) {
        if (places >= qualifies) break;
        finir(c, 'qualifie', t);
      }
    }

    tick++;
    return false;
  }

  /** Classe tout le monde, libère le monde physique, fige le résultat. */
  function clore() {
    if (phase === PHASE.FINIE) return;
    phase = PHASE.FINIE;

    /*
     * Ce qui reste sur la piste est CLASSÉ, du plus avancé au moins avancé : un joueur qui
     * a fait 90 % du parcours ne finit pas au même rang que celui qui n'a pas quitté la
     * ligne de départ.
     */
    const durent = coureurs.filter((c) => c.etat === 'court');
    durent.sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);

    /*
     * ET S'ILS TIENNENT DANS LES PLACES, ILS SONT QUALIFIÉS — pas éliminés puis repêchés.
     *
     * La nuance n'est pas cosmétique. Un survivant marqué `elimine` reçoit l'annonce
     * « ELIMINATED » en cours de manche, avant d'être discrètement repêché dans le
     * classement final. Le dernier debout d'un duel sur Les Hexagones voyait donc s'afficher
     * qu'il avait perdu, puis gagnait. On dit la vérité du premier coup.
     */
    const tiennent = places + durent.length <= qualifies;
    for (const c of durent) finir(c, tiennent ? 'qualifie' : 'elimine', tick / HZ);

    /*
     * On REPÊCHE jusqu'à ce que les places soient pourvues.
     *
     * En course, le temps expire et personne n'a franchi la ligne : les plus avancés
     * passent, sans quoi une manche difficile priverait de leur remboursement huit joueurs
     * à qui on l'avait promis. En survie, tout le monde tombe avant la fin : c'est la règle
     * d'Hex-A-Gone, le DERNIER TOMBÉ gagne. Une manche a toujours un vainqueur.
     */
    // Un joueur qui a ABANDONNÉ n'est jamais repêché, quel que soit son avancement : il
    // n'est plus là pour jouer la manche suivante, et lui donner une place la volerait à
    // quelqu'un qui est resté.
    const repeches = coureurs.filter((c) => c.etat === 'elimine' && !c.abandon)
      .sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);
    for (const c of repeches) {
      if (places >= qualifies) break;
      c.etat = 'qualifie';
      places++;
    }

    /*
     * Les qualifiés d'abord, dans l'ordre où ils ont fini — en course le plus RAPIDE
     * devance, en survie le plus ENDURANT. Puis les éliminés, du plus avancé au moins
     * avancé. C'est ce rang que le backend paiera.
     */
    const qualifiesListe = coureurs.filter((c) => c.etat === 'qualifie')
      .sort((a, b) => {
        // Un repêché a pu ne jamais « finir » : on retombe sur son avancement, la seule
        // mesure disponible. Comparer des `null` produirait des NaN, et un comparateur qui
        // rend NaN laisse le tableau dans un ordre arbitraire.
        if (a.temps === null || b.temps === null) return b.progres - a.progres;
        return monde.survie ? b.temps - a.temps : a.temps - b.temps;
      });
    // Les abandons ferment la marche : partir vaut moins que tomber.
    const eliminesListe = coureurs.filter((c) => c.etat === 'elimine')
      .sort((a, b) => Number(a.abandon) - Number(b.abandon) || b.progres - a.progres || a.chutes - b.chutes);

    const classement = [...qualifiesListe, ...eliminesListe].map((c, i) => ({
      nom: c.nom,
      rang: i + 1,
      etat: c.etat,
      temps: c.temps === null ? null : +c.temps.toFixed(2),
      progres: +c.progres.toFixed(3),
      chutes: c.chutes,
    }));

    resultat = {
      epreuve,
      graine,
      survie: Boolean(monde.survie),
      ticks: tick,
      duree: +(tick / HZ).toFixed(2),
      classement,
      qualifies: classement.filter((c) => c.etat === 'qualifie').map((c) => c.nom),
    };
  }

  return {
    epreuve,
    graine,
    monde,
    get phase() { return phase; },
    get tick() { return tick; },
    get fini() { return phase === PHASE.FINIE; },
    get resultat() { return resultat; },

    /** Secondes restantes avant le départ. `0` dès que la manche a commencé. */
    resteDecompte() {
      return phase === PHASE.DECOMPTE ? (ticksDecompte - tickDecompte) / HZ : 0;
    },

    /** Les coureurs, tels qu'un instantané réseau doit les décrire. */
    etatCoureurs() {
      return coureurs.map((c) => {
        const p = c.perso.position;
        const v = c.perso.body.linvel();
        /*
         * L'ORIENTATION DU CORPS, et pas seulement sa position.
         *
         * En plongeon et en culbute, le personnage passe en ragdoll : son visuel prend la
         * rotation complète du corps physique (`character.js`, branche `ragdoll`). C'est
         * cette bascule qui REND le geste lisible — le squelette, lui, ne fait qu'écarter
         * les membres, ce qui ne se voit pas à dix mètres.
         *
         * Sans elle sur le fil, un adversaire qui plonge se contentait de glisser vers
         * l'avant, bien droit. « On ne voit pas quand il plonge », et c'était exact.
         *
         * Une seule lecture : wasm-bindgen refuse les emprunts imbriqués.
         */
        const r = c.perso.body.rotation();
        return {
          nom: c.nom,
          index: c.index,
          x: p.x, y: p.y, z: p.z,
          vx: v.x, vy: v.y, vz: v.z,
          qx: r.x, qy: r.y, qz: r.z, qw: r.w,
          etat: c.etat,
          pose: c.perso.state,
          progres: c.progres,
          abandon: c.abandon,
        };
      });
    },

    /**
     * Avance d'UN tick.
     *
     * @param {Map<string, object>} [entrees] les entrées reçues du réseau, par nom de
     *   joueur. Un absent est piloté par son pilote — un bot, ou l'auto-pilotage d'un
     *   joueur déconnecté.
     * @returns {boolean} `true` si la manche est terminée
     */
    avancer(entrees) {
      if (phase === PHASE.FINIE) return true;
      if (phase === PHASE.DECOMPTE) { avancerDecompte(); return false; }
      return avancerJeu(entrees);
    },

    /** Termine la manche avant l'heure — un salon vidé, un serveur qui s'arrête. */
    interrompre() { clore(); },

    /**
     * UN JOUEUR QUITTE LA PARTIE : il est ÉLIMINÉ, tout de suite.
     *
     * Décision produit du 2 septembre 2026. Son personnage passait jusqu'ici en pilotage
     * automatique et restait classé sur son avancement — en 1v1, l'adversaire jouait donc
     * seul contre un pantin jusqu'à la fin du chrono. Partir est un abandon : le joueur
     * sort de la manche, les places restantes se décident entre ceux qui sont là, et dans
     * un duel l'autre gagne aussitôt (la règle « ceux qui restent tiennent dans les
     * places » de `avancerJeu` fait le reste).
     *
     * Marqué `abandon` : jamais repêché, classé derrière tous les éliminés. Rend `true` si
     * le joueur était encore en course.
     */
    abandonner(nom) {
      const c = coureurs.find((x) => x.nom === nom);
      if (!c || c.etat !== 'court') return false;
      c.abandon = true;
      finir(c, 'elimine', tick / HZ);
      return true;
    },

    /** Rend la mémoire : monde physique wasm et maillages construits pour rien. */
    liberer() {
      if (libere) return;
      libere = true;
      for (const c of coureurs) c.perso.dispose?.();
      libererMonde(monde);
    },
  };
}

/**
 * Joue une manche entière, d'un trait.
 *
 * L'enveloppe que le harnais et les tests utilisent : elle boucle sur `avancer()` aussi
 * vite que la machine le permet. C'est exactement la même suite de ticks que celle qu'un
 * serveur produirait sur son horloge — seule la cadence change, et la simulation ne la
 * voit pas.
 */
export function jouerManche({ epreuve, graine, inscrits, qualifies, dureeMax = 240, surTick }) {
  const manche = creerManche({ epreuve, graine, inscrits, qualifies, dureeMax });

  // Le décompte, puis le jeu. Le garde-fou est large : `avancer()` s'arrête tout seul sur
  // `dureeMax`, cette borne-ci n'est là que pour qu'une boucle ne puisse jamais être infinie.
  const plafond = (DECOMPTE + dureeMax) * HZ + 10;
  for (let i = 0; i < plafond; i++) {
    if (manche.avancer()) break;
    surTick?.(manche.tick, manche);
  }
  manche.interrompre();

  const r = manche.resultat;
  manche.liberer();
  return r;
}
