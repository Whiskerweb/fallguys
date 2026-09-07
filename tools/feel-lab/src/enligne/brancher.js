/**
 * BRANCHER LE JEU SUR UN SERVEUR — le raccord, et rien d'autre.
 *
 * Tout le netcode vit dans `session.js`, `lien.js`, `reconciliation.js` et `figurants.js`.
 * Ce fichier ne fait que les relier à la boucle de jeu : il écoute le serveur et appelle
 * les méthodes que `main.js` expose déjà.
 *
 * Il est séparé pour une raison précise : `main.js` est édité par plusieurs mains, et il
 * ne doit pas devenir le lieu où vit le netcode. Cinq points d'accroche y suffisent —
 * `imposee`, `enligne`, `attacher`, `envoyer`, `avancer` — et tout le reste est ici.
 */

import { creerSession } from './session.js';
import { ordinal } from '../economie.js';

/**
 * @param {object} jeu  l'instance de `Game`
 * @param {object} p
 * @param {string} p.url    `ws://127.0.0.1:8080`
 * @param {string} p.nom
 * @param {number} [p.mise] en micro-USDG. Zéro = partie gratuite.
 * @param {string} [p.mode] `duel` | `squad` | `arena`
 * @param {string} [p.modele] l'identifiant du personnage choisi, pour que les AUTRES le
 *   voient tel qu'il est. Sans lui, chacun se voyait juste et voyait les autres au hasard.
 * @param {(evenement: string, data: object) => void} [p.surEvenement] pour l'interface
 * @param {() => void} [p.surRejouer] ce que fait REJOUER sur l'écran de fin. Par défaut,
 *   la session se remet dans la même file ; le lobby en ligne préfère repasser par son
 *   propre chemin, qui sait ce que le joueur a choisi entre-temps.
 */
export function brancherEnLigne(jeu, { url, nom, jeton = null, mise: miseInitiale = 0, mode: modeInitial = 'arena', modele: modeleInitial = null, surEvenement, surRejouer = null }) {
  const session = creerSession({ url, nom, jeton });
  const dire = (quoi, data) => surEvenement?.(quoi, data);

  /*
   * LA MISE, LE MODE ET LE PERSONNAGE SUIVENT LE JOUEUR, pas la connexion.
   *
   * La session s'ouvre au chargement du lobby, avant tout choix ; ce qu'on engage se
   * décide à `rejoindre` — et se redécide à chaque bascule. Ce sont ces trois valeurs, à
   * jour, que `engagerEnLigne` lira au lancement de la manche 1 : un joueur qui a changé de
   * table en cours d'attente doit être débité de la table où il joue, pas de la première
   * qu'il avait cliquée.
   */
  let mise = miseInitiale;
  let mode = modeInitial;
  let modele = modeleInitial;

  /*
   * PLUS DE VARIANTE DANS LE SALON. La roue tirait sa forme au lobby, avant la mise ;
   * depuis le 2 septembre 2026 elle tire à la FIN, sur le serveur, et sa graine arrive
   * avec `fin-partie`. Le lobby n'annonce plus qu'un mode et une mise.
   */

  session.sur('etat', (etat) => dire('etat', { etat }));
  session.sur('bienvenue', (msg) => dire('bienvenue', msg));
  session.sur('refus', (msg) => dire('refus', msg));
  session.sur('salon', (msg) => {
    // Le salon fait foi sur le mode et la mise : c'est LUI qui sera payé, quoi que le
    // client ait cru demander.
    if (msg.mode) mode = msg.mode;
    if (typeof msg.mise === 'number') mise = msg.mise;
    dire('salon', msg);
  });
  // Le lobby vu du serveur : qui attend où, et où l'on ferait mieux d'aller. Rien à
  // décider ici — l'interface les montre, le joueur choisit.
  session.sur('files', (msg) => dire('files', msg));
  session.sur('suggestion', (msg) => dire('suggestion', msg));
  /*
   * L'ARGENT, vu du serveur — deux messages, et aucune décision ici.
   *
   * `engagement` : le salon est plein, le serveur fait partir les mises sur la chaîne
   * avant d'annoncer la manche 1. Le lobby affiche « Staking… » ; si une mise ne part pas,
   * un `refus` suit et tout le monde retourne au lobby.
   *
   * `reglement` : le backend a payé. Il dit ce que NOUS avons touché, la ligne tirée et
   * les signatures des transactions ; le lobby relit son solde là-dessus. Le montant
   * affiché par la roue vient du même calcul — `economie.js` — et le backend l'a refait.
   */
  // Un recalage sec est un evenement (chute, reapparition arbitree par le serveur) : le
  // personnage saute, la camera doit sauter avec lui. Une correction absorbee, elle, ne
  // deplace que le corps, et le visuel — que la camera suit — rattrape en douceur.
  session.sur('correction', ({ effet }) => { if (effet === 'recale') jeu.snapCamera = true; });
  session.sur('engagement', (msg) => dire('engagement', msg));
  session.sur('reglement', (msg) => dire('reglement', msg));

  session.sur('manche', (msg) => {
    /*
     * L'ÉPREUVE ET LA GRAINE VIENNENT DU SERVEUR.
     *
     * `startRace()` les lit dans `jeu.imposee` au lieu de les tirer. Les seize joueurs
     * construisent alors exactement le même monde — la condition sans laquelle aucune
     * prédiction ne tient.
     */
    jeu.imposee = {
      epreuve: msg.epreuve,
      graine: msg.graine,
      numero: msg.numero,
      sur: msg.sur,
      decompte: msg.decompte,
      qualifies: msg.qualifies,
    };
    jeu.enligne = session;

    /*
     * SPECTATEUR : on a été éliminé, mais on reçoit quand même l'annonce — c'est ce qui
     * permet de regarder la suite au lieu d'attendre devant un écran noir. On construit
     * donc bien l'arène, simplement on ne pilote plus rien.
     */
    dire('manche', { ...msg, spectateur: session.estSpectateur });
    jeu.startRace();

    /*
     * LA MISE PART ICI, au lancement de la manche 1 — pas à l'entrée dans la file.
     *
     * C'est ce que le ticket promet, et c'est la seule position défendable : un joueur qui
     * attend dans un salon qui ne part jamais ne doit rien avoir payé. Un spectateur non
     * plus — il a été éliminé d'une partie qu'il a déjà payée, ou il n'a jamais joué.
     *
     * L'appel n'est pas attendu : la manche commence par trois secondes de décompte, et
     * faire dépendre le départ d'un aller-retour HTTP ferait rater son décompte au joueur
     * dont le réseau traîne. Le débit est idempotent et verrouillé côté base.
     */
    if (msg.numero === 1 && !session.estSpectateur) {
      /*
       * On n'ATTEND pas, mais on n'IGNORE pas non plus.
       *
       * Un engagement refusé — solde insuffisant, réseau coupé — laisserait le joueur
       * disputer gratuitement une partie que les autres ont payée. Le lobby grise déjà les
       * tables hors de portée, donc le cas est rare ; mais un échec silencieux sur de
       * l'argent est précisément ce qu'on ne veut jamais. On le dit à l'interface, et le
       * joueur finit sa partie sans gain plutôt que sans le savoir.
       */
      Promise.resolve(jeu.engagerEnLigne?.({ mise, mode }))
        .then((ok) => { if (ok === false) dire('mise-refusee', { mise, mode }); })
        .catch(() => dire('mise-refusee', { mise, mode }));
    }
  });

  /*
   * SORTI DE LA MANCHE — quelqu'un vient d'être éliminé ou qualifié.
   *
   * Si c'est nous, deux choses. On l'ANNONCE, parce qu'un joueur doit savoir qu'il est
   * dehors ; et on FIGE le corps local exactement comme le serveur vient de figer le sien.
   *
   * Ce second geste n'est pas cosmétique. Le serveur a coupé la gravité du personnage
   * éliminé ; si le nôtre continuait de tomber, la correction le rappellerait à chaque
   * image vers une position immobile, et le joueur verrait un tremblement au lieu d'un
   * arrêt. Les deux côtés doivent s'arrêter de la même manière.
   */
  session.sur('sorti', (msg) => {
    dire('sorti', msg);
    // Un adversaire qui PART, ça se dit : sans cette ligne, on le voyait se figer sur
    // place sans comprendre, et en 1v1 on gagnait « pour rien ».
    if (msg.nom !== nom && msg.abandon) jeu.banner?.(`${msg.nom} LEFT THE MATCH`, 2.4);
    if (msg.nom !== nom) return;

    const corps = jeu.character?.body;
    if (corps) {
      corps.setLinvel({ x: 0, y: 0, z: 0 }, true);
      corps.setAngvel({ x: 0, y: 0, z: 0 }, true);
      corps.setGravityScale(0, true);
    }
    jeu.banner?.(msg.etat === 'qualifie' ? 'QUALIFIED!' : 'ELIMINATED', 2.4);
  });

  session.sur('fin-manche', (msg) => {
    dire('fin-manche', msg);
    /*
     * On NE change pas de carte ici : la manche suivante s'annoncera d'elle-même, et c'est
     * elle qui déclenchera `startRace()`. Anticiper produirait deux constructions d'arène
     * pour une seule manche — la nôtre, puis celle du serveur.
     */
    const moi = msg.classement.find((c) => c.nom === nom);
    if (moi) jeu.banner?.(moi.etat === 'qualifie' ? 'QUALIFIED!' : 'ELIMINATED', 2.4);
  });

  /*
   * TOUT CE QUI PRÉCÈDE L'ÉCRAN DE FIN EST « AU MIEUX » ; L'ÉCRAN, LUI, EST DÛ.
   *
   * Ce gestionnaire annule `jeu.enligne` puis pose `jeu._fin` — les deux gardes de
   * `main.js`. Entre les deux, tout ce qui JETTE laisse la boucle sans aucune garde à
   * l'image suivante : elle retombe dans ses règles hors ligne, le vainqueur posé au-delà
   * de la ligne voit « QUALIFIED! » puis le lobby, et le perdant, au milieu du parcours,
   * continue de jouer seul. C'est mot pour mot ce qui a été rapporté en jouant — la cause
   * était un barème introuvable (une « arène » de deux, voir `politique.js:misePayable`),
   * mais N'IMPORTE QUELLE exception ici produit les mêmes deux symptômes.
   *
   * On isole donc chaque étape : une panne se dit dans la console et au joueur, elle ne
   * lui vole pas son résultat. Rien n'est étouffé, tout est journalisé.
   */
  const surement = (quoi, fn) => {
    try { return fn(); } catch (e) { console.error(`fin de partie · ${quoi} :`, e); return undefined; }
  };

  session.sur('fin-partie', (msg) => {
    surement('interface', () => dire('fin-partie', msg));

    const moi = msg.classement.find((c) => c.nom === nom);
    const rang = moi?.rang ?? msg.classement.length;
    const total = msg.classement.length;
    /*
     * LA GRAINE DE ROUE VIENT DU SERVEUR, tirée au classement final. Le client en dérive
     * la ligne du tableau — il ne la choisit pas, il ne la déclare pas ; le backend refait
     * le même calcul. Un `fin-partie` sans graine (serveur ancien) vaut zéro : la ligne
     * que rend la graine zéro, jamais une ligne inventée.
     */
    const graineRoue = Number.isInteger(msg.roue?.graine) ? msg.roue.graine : 0;

    /*
     * ON COUPE LA SESSION AVANT D'AFFICHER.
     *
     * La boucle de jeu envoie une entrée par image tant que `jeu.enligne` existe ; la
     * laisser vivre pendant les quatre secondes du verdict enverrait deux cent quarante
     * paquets à une partie qui n'existe plus.
     *
     * ─── ET ÇA REND LA MAIN AUX RÈGLES HORS LIGNE ───────────────────────────
     *
     * Annuler `jeu.enligne` ne coupe pas que l'envoi : à l'image suivante, `main.js` ne se
     * sait plus en ligne et retombe dans SES conditions de fin de manche. Le vainqueur est
     * encore posé au-delà de la ligne d'arrivée, donc `pos.z <= finishZ` est vrai, donc
     * `finishRace()` partait — écrasant le verdict « VICTORY! · +X USDG » par un
     * « QUALIFIED! », puis renvoyant au lobby 3,2 s plus tard, roue comprise.
     *
     * C'est `jeu._fin`, posé par `ecranDeFin` juste en dessous, qui retient ces règles.
     * Les deux lignes sont donc COUPLÉES : déplacer l'une sans l'autre rouvre le trou, et
     * il ne se voit que sur les cartes qu'on peut terminer.
     */
    jeu.imposee = null;
    jeu.enligne = null;
    surement('session', () => session.detacher());

    /*
     * LE RANG VIENT DU SERVEUR, jamais du client — c'est tout l'objet de l'exercice.
     *
     * Et il faut le MONTRER : sans cet écran, une partie en ligne se terminait par un
     * retour au lobby sans que le joueur sache s'il avait gagné. Le solo, lui, affiche un
     * verdict depuis toujours ; il n'y a aucune raison que la version qui compte soit la
     * plus muette des deux.
     */
    /*
     * L'EFFECTIF REEL vient du classement du serveur : c'est le nombre de joueurs qui ont
     * effectivement pris le depart. Un salon parti incomplet — avec l'accord de tous — se
     * paie au bareme de SON effectif, pas a celui de la table pleine.
     *
     * ET SI LE BARÈME N'EXISTE PAS, ON LE DIT. `reglerPartie` jette quand aucune table ne
     * paie cet effectif dans ce mode. Le gain est alors « — », la mise remise à zéro pour
     * l'écran — pas de roue pour un gain qu'on ne sait pas calculer —, et le joueur lit
     * pourquoi. L'argent n'a pas bougé : le backend refuse le même règlement, la mise reste
     * engagée et un opérateur la rend. Ce cas ne doit plus se produire depuis que le
     * serveur refuse la mise à l'inscription ; s'il se produit, il se voit.
     */
    let gain = 0;
    let echec = null;
    try {
      gain = jeu.reglerPartie?.(rang, total, graineRoue) ?? 0;
    } catch (e) {
      echec = e;
      console.error('fin de partie · règlement impossible :', e);
    }
    const gagne = rang === 1;

    // Ce que le joueur doit pouvoir relire : la table sous laquelle il vient de jouer.
    surement('barème', () => dire('bareme', { mode, graineRoue, rang, gain }));
    if (echec) surement('interface', () => dire('reglement-echoue', { rang, total, mode, raison: echec.message }));

    /*
     * L'ÉCRAN DE FIN, ET IL NE SE FERME PAS TOUT SEUL.
     *
     * Avant, quatre secondes plus tard on rendait la main — et la carte de résultat
     * n'était même jamais vue : elle était affichée pendant que `#lobby-ui` était encore
     * masqué, puis retirée avant le retour au lobby. Le podium du serveur n'a donc jamais
     * atteint personne.
     *
     * Désormais la roue monte, le joueur la lance quand il veut, et il choisit entre
     * LOBBY et REJOUER. Il vient de gagner ou de perdre de l'argent réel : lui reprendre
     * l'écran au bout de quatre secondes était une décision qu'on prenait à sa place.
     *
     * LA ROUE NE TIRE RIEN — le barème a été tiré dans le lobby, avant que sa mise ne
     * parte, et elle s'arrête sur le palier que LE SERVEUR lui a donné.
     */
    const podium = msg.classement.slice(0, 3).map((c) => `${c.rang}. ${c.nom}`).join('   ');

    /*
     * REJOUER se remet en file, au même mode et à la même mise.
     *
     * `session.detacher()` ci-dessus n'a pas fermé la socket — seul `fermer()` le fait —
     * donc on est encore connecté et le serveur nous replace dans un salon. C'est la
     * boucle de rétention la moins chère du jeu : tout était déjà câblé pour elle.
     */
    jeu._rejouer = surRejouer ?? (() => session.rejoindre(mise, modele, mode));

    /*
     * LE VAINQUEUR, avec SON personnage — celui que le serveur a relaye dans l'annonce de
     * manche. C'est lui qui monte sur le plateau, chez tout le monde : le perdant regarde
     * celui qui a gagne, comme dans la reference. Sans modele connu (annonce perdue), le
     * plateau montre le personnage local plutot que rien.
     */
    const premier = msg.classement[0];
    const vainqueur = {
      nom: premier?.nom ?? null,
      modele: session.manche?.joueurs?.find((j) => j.nom === premier?.nom)?.modele ?? null,
    };

    jeu.ecranDeFin?.({
      vainqueur,
      titre: gagne ? 'MATCH WON' : `${ordinal(rang)} PLACE`,
      banniere: gagne ? 'VICTORY!' : 'MATCH OVER',
      type: gagne ? 'win' : (gain > 0 ? 'ok' : 'ko'),
      // Sans barème, pas de roue : `mise: 0` prend le chemin du résultat direct.
      rang, total, gain, mise: echec ? 0 : mise, mode, graineRoue,
      podium,
      sous: echec ? `${ordinal(rang)} of ${total} · payout could not be computed` : undefined,
    });
  });

  session.connecter();

  return {
    session,
    /** Entre dans la file d'attente. */
    rejoindre(m = mise, mod = modele, md = mode) {
      mise = m; modele = mod; mode = md;
      session.rejoindre(m, mod, md);
    },
    /** Accepte une suggestion : change de file d'un seul geste. */
    basculer(m = mise, md = mode) {
      mise = m; mode = md;
      session.basculer(m, md);
    },
    /** Sort de la file, sans couper la connexion. */
    quitter() { session.quitter(); },
    /**
     * Abandonne la partie EN COURS : on cesse d'écouter et de piloter, le serveur passe
     * notre personnage en pilotage automatique et la partie continue sans nous. La mise
     * est engagée ; c'est le prix d'un abandon, et il est annoncé dans le menu de pause.
     */
    abandonner() {
      jeu.imposee = null;
      jeu.enligne = null;
      session.detacher();
      session.quitter();
    },
    debrancher() {
      jeu.imposee = null;
      jeu.enligne = null;
      session.fermer();
    },
  };
}
