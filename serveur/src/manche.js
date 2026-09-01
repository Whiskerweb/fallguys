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

  function finir(c, etat, t) {
    c.etat = etat;
    c.temps = t;
    if (etat === 'qualifie') places++;
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

    if (!enCourse.length || places >= qualifies || tick >= maxTicks) {
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
      enCourse.map((c) => ({
        perso: c.perso,
        entree: entreesReseau?.get(c.nom) ?? c.pilote.entree(tick, c.perso, monde),
      })),
      t, DT, true,
    );

    for (const c of enCourse) {
      const p = c.perso.body.translation();

      if (monde.survie) {
        c.progres = t;
        if (p.y < monde.killY) { finir(c, 'elimine', t); continue; }
        if (t >= monde.duree) { finir(c, 'qualifie', t); continue; }
      } else {
        c.progres = Math.max(c.progres, Math.min(1, (departZ - p.z) / distanceTotale));
        if (p.y < monde.killY) {
          // En course, tomber ne tue pas : on réapparaît au dernier point de passage. On
          // compte la chute — c'est ce qui départage deux joueurs éliminés au même endroit.
          c.chutes++;
          c.perso.respawn(monde.arene.checkpointFor?.(p.z) ?? monde.spawn);
          continue;
        }
        if (p.z <= monde.finishZ) { finir(c, 'qualifie', t); continue; }
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
     * Ce qui reste sur la piste est éliminé, mais CLASSÉ, du plus avancé au moins avancé :
     * un joueur qui a fait 90 % du parcours ne finit pas au même rang que celui qui n'a
     * pas quitté la ligne de départ.
     */
    const durent = coureurs.filter((c) => c.etat === 'court');
    durent.sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);
    for (const c of durent) finir(c, 'elimine', tick / HZ);

    /*
     * On REPÊCHE jusqu'à ce que les places soient pourvues.
     *
     * En course, le temps expire et personne n'a franchi la ligne : les plus avancés
     * passent, sans quoi une manche difficile priverait de leur remboursement huit joueurs
     * à qui on l'avait promis. En survie, tout le monde tombe avant la fin : c'est la règle
     * d'Hex-A-Gone, le DERNIER TOMBÉ gagne. Une manche a toujours un vainqueur.
     */
    const repeches = coureurs.filter((c) => c.etat === 'elimine')
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
    const eliminesListe = coureurs.filter((c) => c.etat === 'elimine')
      .sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);

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
        return {
          nom: c.nom,
          index: c.index,
          x: p.x, y: p.y, z: p.z,
          vx: v.x, vy: v.y, vz: v.z,
          etat: c.etat,
          pose: c.perso.state,
          progres: c.progres,
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
