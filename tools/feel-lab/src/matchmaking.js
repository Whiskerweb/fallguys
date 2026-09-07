/**
 * LE LOBBY EN LIGNE — la connexion, la file d'attente, les suggestions, les notifications.
 *
 * Il n'existe plus de partie hors ligne. Le bouton PLAY ne lance pas une simulation
 * locale : il entre dans une file du serveur, et tout ce que le ticket affiche pendant
 * l'attente vient de là — qui attend où, combien de places restent, sous quel barème on
 * jouera, et où l'on ferait mieux d'aller.
 *
 * ─── CE QUE CE FICHIER FAIT ─────────────────────────────────────────────────
 *
 *   1. Il TROUVE le serveur et s'y connecte au chargement, avant tout clic. La page est
 *      servie par le serveur de jeu, donc la partie est au même endroit : rien à saisir.
 *   2. PLAY entre en file avec le mode et la mise du ticket ; le même bouton en sort.
 *      Changer de mode ou de table PENDANT l'attente change de file — c'est une bascule,
 *      exactement le geste qu'une suggestion propose.
 *   3. Il montre LA PRÉSENCE : « 3 waiting » sur chaque mode, et sur chaque table du mode
 *      choisi. Un lobby qui ne dit pas où sont les gens est un lobby qu'on croit vide.
 *   4. Il reçoit les SUGGESTIONS du serveur — « quelqu'un attend en 1v1, ta partie y
 *      démarrerait » — et les montre en notification, avec un son, et par une notification
 *      du navigateur si l'onglet est en arrière-plan. Le joueur accepte ou reste ; rien ne
 *      bouge sans lui.
 *
 * ─── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────
 *
 * Il ne décide rien. Le serveur dit qui attend, quand partir, quoi suggérer ; ce fichier
 * l'affiche et transmet les gestes du joueur. Et il n'installe aucune logique réseau dans
 * `main.js` : la boucle de jeu n'a que deux points d'accroche de plus — `jouer()` et
 * `surAbandon()` —, tout le reste vit ici et dans `enligne/`.
 */

import { sfx } from './audio.js';
import { cosmetics } from './cosmetics.js';
import {
  MICROS, MODES, miseChoisie, modeChoisi, choisirMise, choisirMode, montant, surChangement,
} from './economie.js';
import { portefeuille, caisse } from './caisse.js';
import { jeton, surSession } from './compte.js';
import { poserDevise, poserReseau } from './devise.js';
import { evaluerPorte } from './porte.js';
import { brancherEnLigne } from './enligne/brancher.js';
import {
  nomJoueur, renommerJoueur, definirSalon, definirLiaison, majFiles, majBarre,
} from './lobbyui.js';

const el = (id) => document.getElementById(id);

/** Mémorisé : quand la page ne vient pas du serveur de jeu, on rejoue sur le même. */
const CLE_URL = 'tumble-serveur';

/**
 * OÙ EST LE SERVEUR.
 *
 * Trois sources, dans cet ordre, et la première qui répond gagne :
 *
 *   1. `?serveur=ws://…` dans l'adresse — pour un banc, ou pour viser une autre machine ;
 *   2. la page elle-même : le serveur de jeu sert le jeu compilé, et lui seul répond à
 *      `/etat`. Le serveur de développement de Vite rend un 404. C'est le cas normal, et
 *      c'est ce qui fait qu'un joueur n'a jamais rien à taper ;
 *   3. l'adresse mémorisée d'une fois précédente.
 *
 * Aucune des trois : on ne DEVINE PAS. Tenter `127.0.0.1:8080` à l'aveugle ferait
 * journaliser une erreur de connexion toutes les dix secondes dans les quarante harnais
 * de `diag/` qui tournent sans serveur, et certains comptent les erreurs de console comme
 * des échecs. Le ticket dit alors « pas de serveur », et propose de saisir une adresse.
 */
async function trouverServeur() {
  const forcee = new URLSearchParams(location.search).get('serveur');
  if (forcee) { localStorage.setItem(CLE_URL, forcee); return forcee; }

  try {
    const r = await fetch('/etat', { cache: 'no-store' });
    if (r.ok) {
      const etat = await r.json();
      if (etat && Array.isArray(etat.salons)) {
        // Le serveur dit la chaîne et le nom du dollar (USDC sur le testnet, USDG sur
        // mainnet) : l'interface se renomme AVANT d'afficher quoi que ce soit d'argent.
        if (etat.chaine) { poserDevise(etat.chaine.stable); poserReseau(etat.chaine); }
        const protocole = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocole}//${location.host}`;
      }
    }
  } catch { /* pas de serveur ici */ }

  return localStorage.getItem(CLE_URL) ?? null;
}

/**
 * @param {object} jeu l'instance de `Game`
 */
export async function brancherMatchmaking(jeu) {
  let branche = null;
  /** 'absent' (aucune adresse) · 'connexion' · 'ouvert' · 'ferme' (coupé, on réessaie) */
  let etat = 'connexion';
  /** Le joueur a demandé une partie. Survit à une coupure : on se remet en file au retour. */
  let enFile = false;
  /** La dernière file demandée — c'est à elle qu'on compare un clic sur un autre mode. */
  let demande = null;
  /** Le dernier état de salon reçu, et l'instant où il est arrivé (pour le chrono). */
  let salon = null;
  let salonRecuA = 0;
  let files = [];
  let joueursEnLigne = 0;
  let suggestion = null;
  let enPartie = false;

  const msg = el('file-msg');
  const dire = (texte, ok = false) => { msg.textContent = texte; msg.classList.toggle('ok', ok); };

  // ---------- rendu ----------

  const LIBELLE_LIEN = {
    absent: 'NO SERVER', connexion: 'CONNECTING…', ouvert: 'ONLINE', ferme: 'RECONNECTING…',
  };

  /** Repeint tout ce qui dépend de l'état : la pastille, le ticket, le bloc de file. */
  function peindre() {
    const pastille = el('lien');
    pastille.className = etat;
    el('lien-txt').textContent = etat === 'ouvert' && joueursEnLigne > 0
      ? `ONLINE · ${joueursEnLigne} player${joueursEnLigne > 1 ? 's' : ''}`
      : LIBELLE_LIEN[etat];

    el('serveur-absent').classList.toggle('hidden', etat !== 'absent');

    // Le ticket : PLAY / LEAVE QUEUE, et la note sous le bouton.
    definirLiaison({ etat, enFile, joueurs: joueursEnLigne });

    peindreFile();
  }

  /** Le bloc de file, dans le ticket : où l'on attend, avec qui, depuis quand. */
  function peindreFile() {
    const bloc = el('file');
    bloc.classList.toggle('hidden', !enFile);
    if (!enFile) return;

    const depart = el('file-depart');
    const sieges = el('file-sieges');

    if (!salon) {
      el('file-titre').textContent = 'JOINING…';
      el('file-ligne').textContent = demande
        ? `${MODES[demande.mode]?.nom ?? demande.mode} · ${montant(demande.mise)} USDC`
        : '';
      sieges.innerHTML = '';
      depart.classList.add('hidden');
      return;
    }

    const config = MODES[salon.mode];
    el('file-titre').textContent = salon.pretAPartir ? 'STARTING…' : 'LOOKING FOR PLAYERS';
    el('file-ligne').textContent =
      `${config?.nom ?? salon.mode} · ${montant(salon.mise)} USDC · ${salon.humains} / ${salon.cible}`;

    /*
     * UN POINT PAR PLACE. Seize points pour une arène, deux pour un duel : on voit d'un
     * coup d'œil ce qui manque, et un chiffre seul ne le dit pas aussi vite. Les places
     * sous le minimum sont marquées : c'est là que le départ devient possible.
     */
    sieges.innerHTML = '';
    for (let i = 0; i < salon.cible; i++) {
      const p = document.createElement('i');
      p.className = (i < salon.humains ? 'pris' : '') + (i < salon.minimum ? ' requis' : '');
      sieges.appendChild(p);
    }

    /*
     * LE DÉPART RÉDUIT EN DÉCOMPTE, et ce qu'il doit dire.
     *
     * Personne n'a rien à accepter : au-dessus du minimum, le salon part quand plus
     * personne n'arrive depuis `calme` secondes. Le joueur doit LIRE deux choses — dans
     * combien de temps, et pour quel pot, plus petit que celui de la table pleine. Sous le
     * minimum, le serveur n'annonce rien, et il faut alors expliquer pourquoi on attend,
     * sinon l'attente ressemble à une panne.
     */
    const d = salon.departReduit;
    depart.classList.toggle('hidden', !d);
    if (d) {
      depart.textContent = `Starting in ${d.dans} s with ${d.joueurs} players · ${montant(d.pot)} USDC pot`
        + ' — unless someone joins';
    }

    if (salon.humains < salon.minimum) {
      /*
       * SOUS LE MINIMUM, ON LE DIT TOUT DE SUITE — pas après le délai d'attente du serveur
       * (`sousLeMinimum` ne s'allume qu'une fois le salon jugé figé). Le joueur doit savoir
       * dès la première seconde combien il en faut, et ON REDIT LA TABLE : un salon est
       * déterminé par le couple mode + mise, et deux joueurs qui n'ont pas choisi la même
       * s'attendent chacun dans une pièce vide sans que rien ne le laisse deviner. Arrivé
       * deux fois en test.
       */
      const manque = salon.minimum - salon.humains;
      dire(`Need ${salon.minimum} to start (${manque} more) — everyone must pick the SAME mode and table.`);
    } else if (salon.pretAPartir) {
      dire('Everyone is here — starting.', true);
    } else if (salon.humains < salon.cible) {
      const manque = salon.cible - salon.humains;
      dire(d
        ? `Room for ${manque} more — every arrival grows the pot and restarts the countdown.`
        : `Waiting for ${manque} more player${manque > 1 ? 's' : ''}…`, true);
    }
  }

  /** Le chrono de l'attente, depuis le PREMIER arrivant du salon — pas depuis nous. */
  setInterval(() => {
    if (!enFile || !salon) { el('file-chrono').textContent = ''; return; }
    const s = (salon.attente ?? 0) + Math.max(0, (performance.now() - salonRecuA) / 1000);
    el('file-chrono').textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }, 500);

  // ---------- les notifications ----------

  /**
   * Le navigateur peut prévenir un onglet qu'on ne regarde plus. On le demande au PREMIER
   * clic sur PLAY — c'est un geste du joueur, donc le navigateur accepte de poser la
   * question — et jamais au chargement, où la question tomberait de nulle part.
   */
  function demanderNotifications() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
  }

  function notifierNavigateur(titre, corps) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;   // à l'écran, la notification du jeu suffit
    try {
      const n = new Notification(titre, { body: corps, tag: 'tumble-lobby' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* certains navigateurs refusent hors service worker */ }
  }

  /**
   * UNE NOTIFICATION DANS LE JEU, avec ou sans boutons.
   *
   * Une seule à la fois : la nouvelle remplace l'ancienne. Deux invitations empilées se
   * contrediraient — le serveur n'en fait qu'une, l'écran n'en montre qu'une.
   */
  function notifier({ titre, corps, ok = null, non = null, duree = 0, type = '' }) {
    const boite = el('notifs');
    boite.innerHTML = '';
    const n = document.createElement('div');
    n.className = `notif ${type}`.trim();

    const txt = document.createElement('div');
    txt.className = 'nt-txt';
    const b = document.createElement('b');
    b.textContent = titre;
    const s = document.createElement('span');
    s.textContent = corps ?? '';
    txt.append(b, s);
    n.appendChild(txt);

    if (ok || non) {
      const btns = document.createElement('div');
      btns.className = 'nt-btns';
      if (ok) {
        const bo = document.createElement('button');
        bo.className = 'nt-ok';
        bo.textContent = ok.texte;
        bo.addEventListener('click', () => { sfx.click(); ok.faire(); });
        btns.appendChild(bo);
      }
      if (non) {
        const bn = document.createElement('button');
        bn.className = 'nt-non';
        bn.textContent = non.texte;
        bn.addEventListener('click', () => { sfx.click(); non.faire(); });
        btns.appendChild(bn);
      }
      n.appendChild(btns);
    }
    boite.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    if (duree) setTimeout(() => { if (n.parentNode) n.remove(); }, duree * 1000);
    return n;
  }

  const cacherNotif = () => { el('notifs').innerHTML = ''; };

  /**
   * LA SUGGESTION DU SERVEUR — « quelqu'un attend là-bas, et ta partie y démarrerait ».
   *
   * On dit exactement ce que le serveur sait : combien attendent, dans quel mode, à quelle
   * mise, et si la partie PARTIRAIT tout de suite ou deviendrait seulement proposable. Le
   * joueur choisit ; rien ne bouge sans lui. La mise proposée n'est jamais plus haute que
   * la sienne — c'est une règle du serveur, pas un affichage.
   */
  function montrerSuggestion(s) {
    suggestion = s;
    const nomMode = MODES[s.mode]?.nom ?? s.mode;
    const titre = `${s.joueurs} player${s.joueurs > 1 ? 's' : ''} waiting in ${nomMode} · ${montant(s.mise)} USDC`;
    const corps = s.demarre
      ? 'Your match would start right now.'
      : `Enough to start with ${s.joueurs + 1} — if everyone there agrees.`;
    sfx.beep();
    notifier({
      titre, corps, type: 'suggestion',
      ok: { texte: `SWITCH TO ${nomMode}`, faire: () => basculer(s.mode, s.mise) },
      non: { texte: 'KEEP WAITING', faire: () => { suggestion = null; cacherNotif(); } },
    });
    notifierNavigateur(`Tumble — ${titre}`, corps);
  }

  // ---------- le compteur de qualifiés, et le bandeau de partie ----------

  let passes = 0;
  let places = 1;
  const majQualifies = () => {
    const cible = el('hud-qualifies');
    if (cible) cible.textContent = `${passes}/${places}`;
  };

  const hud = el('enligne-hud');
  function majHud() {
    if (!branche || !jeu.enligne) { hud.classList.add('hidden'); return; }
    const s = jeu.enligne.statistiques;
    hud.classList.remove('hidden');
    // `latence` vaut null quand le serveur n'accuse plus rien : on ne sait pas, et on
    // l'écrit. Afficher la valeur de saturation donnait « 1983 ms » figé, identique sur
    // toutes les machines — un chiffre qui a l'air d'une mesure et n'en est pas une.
    hud.textContent = (s.latence === null ? '— ms' : `${s.latence} ms`)
      + ` · ${s.figurants + 1} players`
      + (s.recalages ? ` · ${s.recalages} resyncs` : '');
  }
  setInterval(majHud, 500);

  // ---------- les gestes ----------

  /** Entre dans la file du mode et de la table choisis. Rend `true` si la demande est partie. */
  function chercher() {
    if (jeu.mode !== 'lobby') return false;
    if (etat !== 'ouvert') { dire('Not connected to a game server.'); return false; }
    const mise = miseChoisie();
    const mode = modeChoisi();
    if (portefeuille.solde < mise) return false;
    if (enFile) return true;

    enFile = true;
    demande = { mode, mise };
    salon = null;
    demanderNotifications();
    branche.rejoindre(mise, cosmetics.model, mode);
    dire('Joining…', true);
    peindre();
    return true;
  }

  /** Sort de la file. La connexion reste : on peut rejouer sans attendre. */
  function annuler() {
    if (!enFile) return;
    enFile = false;
    demande = null;
    salon = null;
    suggestion = null;
    cacherNotif();
    branche?.quitter();
    definirSalon(null);
    dire('Left the queue.');
    peindre();
  }

  /**
   * Change de file — sur une suggestion, ou sur un clic dans le ticket pendant l'attente.
   *
   * Le ticket suit : le mode et la table sélectionnés deviennent ceux de la nouvelle file,
   * pour que ce qu'on lit soit ce qu'on joue. `choisirMode` réveille `surChangement`, qui
   * retombe ici — d'où `demande`, posée AVANT, pour qu'il n'y ait rien à faire.
   */
  function basculer(mode, mise) {
    if (!enFile || !branche) return;
    if (portefeuille.solde < mise) { dire('Not enough balance for that table.'); return; }
    demande = { mode, mise };
    salon = null;
    suggestion = null;
    cacherNotif();
    choisirMode(mode);
    choisirMise(mise / MICROS);
    branche.basculer(mise, mode);
    dire(`Switching to ${MODES[mode]?.nom ?? mode} · ${montant(mise)} USDC…`, true);
    peindre();
  }

  // Un clic sur un autre mode ou une autre table PENDANT l'attente est une bascule.
  surChangement(() => {
    if (!enFile || !demande) return;
    const mode = modeChoisi();
    const mise = miseChoisie();
    if (mode === demande.mode && mise === demande.mise) return;
    if (portefeuille.solde < mise) {
      // On ne peut pas y aller : le ticket revient sur la file où l'on est.
      choisirMode(demande.mode);
      choisirMise(demande.mise / MICROS);
      return;
    }
    basculer(mode, mise);
  });

  // ---------- ce que le serveur dit ----------

  function evenement(quoi, data) {
    if (quoi === 'etat') {
      etat = data.etat;
      if (etat === 'ouvert') {
        // La ligne est (re)venue. Si le joueur cherchait une partie, le serveur l'a
        // oublié à la coupure : on le remet en file sans qu'il ait à recliquer.
        if (enFile && demande) branche.rejoindre(demande.mise, cosmetics.model, demande.mode);
      } else if (etat === 'ferme' && enFile) {
        salon = null;
        dire('Connection lost — reconnecting…');
      }
      peindre();
      return;
    }

    if (quoi === 'bienvenue') {
      joueursEnLigne = data.joueurs ?? 0;
      /*
       * Le serveur dit QUI il a reconnu et S'IL Y A DE L'ARGENT derrière lui. C'est la
       * caisse qui en tire les conséquences : solde réel, ou portefeuille de banc, ou zéro.
       */
      caisse.definirServeur({ compte: data.compte ?? null, argent: data.argent, identite: data.identite });
      // Un serveur à argent réel sans session : la porte se ferme devant le lobby.
      evaluerPorte();
      if (data.argent && !data.compte && caisse.enLigne) {
        dire('Signed in, but the game server did not recognise your session — reconnect.');
      }
      majBarre();
      peindre();
      return;
    }

    if (quoi === 'engagement') {
      // Les mises partent sur la chaîne. Rien à décider : on le montre, et on attend.
      definirLiaison({ engagement: true });
      dire('Committing stakes on-chain…', true);
      return;
    }

    if (quoi === 'reglement') {
      /*
       * LE BACKEND A PAYÉ (ou dit qu'il paiera). Le montant affiché par la roue vient du
       * même calcul ; ici on relit simplement le solde, et on dit si quelque chose cloche.
       */
      if (data.erreur) {
        notifier({
          titre: 'Payout pending', type: 'alerte', duree: 10,
          corps: `The backend has not settled this match yet (${data.erreur}). Your balance will update.`,
        });
      }
      caisse.surReglement().then(() => majBarre()).catch(() => {});
      return;
    }

    if (quoi === 'files') {
      files = data.files ?? [];
      majFiles(files);
      return;
    }

    if (quoi === 'salon') {
      /*
       * LA VARIANTE ARRIVE ICI, ET C'EST TOUT LE POINT.
       *
       * Elle vient avec l'état du salon, donc pendant que celui-ci se remplit — avant que
       * la mise ne parte. Le ticket se recalcule dessus : le joueur lit le barème EXACT de
       * la partie qu'on lui propose, et décide de rester ou de partir. Si un jour cette
       * information n'arrivait qu'à la fin, la roue cesserait d'être un barème annoncé
       * pour devenir un tirage — et c'est la qualification « compétition de skill » du
       * spec (§ 5) qui tomberait avec.
       */
      salon = data;
      salonRecuA = performance.now();
      if (!enFile) { enFile = true; demande = { mode: data.mode, mise: data.mise }; }
      definirSalon(data);
      peindre();
      return;
    }

    if (quoi === 'suggestion') {
      if (data.aucune) {
        // L'invitation n'a plus d'objet : le salon visé est parti, ou s'est vidé.
        if (suggestion) { suggestion = null; cacherNotif(); }
        return;
      }
      if (enFile) montrerSuggestion(data);
      return;
    }

    if (quoi === 'manche') {
      definirLiaison({ engagement: false });
      enPartie = true;
      enFile = false;
      demande = null;
      suggestion = null;
      cacherNotif();
      // Manche neuve : personne n'est encore passé. Le compteur repart de zéro, et il
      // repart AVEC le nombre de places que le serveur vient d'annoncer.
      passes = 0;
      places = data.qualifies ?? places;
      majQualifies();
      if (data.numero === 1) {
        sfx.checkpoint();
        notifierNavigateur('Tumble — match found!', 'Your match is starting.');
      }
      if (data.spectateur) jeu.banner?.('SPECTATING', 3);
      peindre();
      return;
    }

    /*
     * QUELQU'UN VIENT DE PASSER LA LIGNE — et le compteur doit le dire.
     *
     * On compte les annonces plutôt que de demander un total : le serveur n'émet un `sorti`
     * que sur un CHANGEMENT d'état, une seule fois par joueur et par transition.
     */
    if (quoi === 'sorti') {
      if (data.etat === 'qualifie') { passes++; majQualifies(); }
      return;
    }

    if (quoi === 'fin-partie') {
      // Le salon n'existe plus : le ticket doit remontrer le CATALOGUE, pas la variante
      // d'une partie terminée. Laisser l'ancienne afficherait un barème périmé.
      enPartie = false;
      enFile = false;
      demande = null;
      salon = null;
      definirSalon(null);
      hud.classList.add('hidden');
      dire('Match over.', true);
      peindre();
      return;
    }

    if (quoi === 'mise-refusee') {
      // Le joueur court déjà : on ne peut plus l'arrêter, mais il doit savoir qu'il joue
      // pour rien. Le taire serait lui laisser croire à un gain qui ne viendra pas.
      notifier({
        titre: 'Stake could not be committed', type: 'alerte', duree: 8,
        corps: 'This match pays nothing. Check your balance.',
      });
      return;
    }

    /*
     * LE RÈGLEMENT A ÉCHOUÉ — et on le dit, parce que l'alternative était pire : l'écran
     * de fin ne montait pas du tout. Le joueur voit son rang, un gain « — », et cette
     * ligne. Sa mise n'a pas bougé ; c'est un opérateur qui la rend.
     */
    if (quoi === 'reglement-echoue') {
      notifier({
        titre: 'Payout could not be computed for this table', type: 'alerte', duree: 12,
        corps: `Nothing was paid. (${data.raison})`,
      });
      return;
    }

    if (quoi === 'refus') {
      // Une raison nommée par le serveur, dite en clair quand on sait la traduire. Un
      // refus à l'inscription nous laisse HORS de toute file : le bouton redevient PLAY.
      const RAISONS = {
        MISE_IMPAYABLE: 'This server cannot take a stake in this mode: no payout table for a room this small. Pick 1v1, or a free table.',
        MODE_INCONNU: 'This server does not know that game mode.',
        DEJA_EN_FILE: 'You are already waiting in a queue.',
        SALON_PLEIN: 'That room just filled up — try again.',
        PARTIE_LANCEE: 'That match just started without you — try again.',
        NON_AUTHENTIFIE: 'Sign in to play for USDC.',
        ARGENT_INDISPONIBLE: 'This server has no wallet backend: paid tables are closed.',
        SOLDE_INSUFFISANT: 'Not enough balance for this table — deposit USDC from WALLET.',
        MISE_REFUSEE: 'Your stake could not be committed on-chain. Check your balance and try again.',
        PARTIE_ANNULEE: 'A player could not stake, so the match was cancelled — you are back in the queue.',
      };
      definirLiaison({ engagement: false });
      dire(RAISONS[data.raison] ?? `Refused: ${data.raison}`);
      // Une partie annulée nous remet en file d'elle-même : le serveur renvoie un salon.
      if (data.raison !== 'DEJA_EN_FILE' && data.raison !== 'PARTIE_ANNULEE') { enFile = false; demande = null; salon = null; definirSalon(null); peindre(); }
      if (data.raison === 'PARTIE_ANNULEE') { salon = null; peindre(); }
      if (['SOLDE_INSUFFISANT', 'MISE_REFUSEE', 'NON_AUTHENTIFIE'].includes(data.raison)) caisse.rafraichir().then(() => majBarre()).catch(() => {});
      // Le message doit survivre au repli du bloc de file : on le remet sous le bouton.
      el('play-note').textContent = RAISONS[data.raison] ?? `Refused: ${data.raison}`;
      el('play-note').classList.add('alerte');
    }
  }

  // ---------- la connexion ----------

  function connecter(url) {
    branche?.debrancher();
    etat = 'connexion';
    peindre();
    branche = brancherEnLigne(jeu, {
      url,
      nom: nomJoueur(),
      // Le jeton de session part avec `bonjour` : c'est ce qui fait de nous un compte.
      jeton,
      modele: cosmetics.model,
      surEvenement: evenement,
      // REJOUER repasse par ici : c'est la seule voie qui sache ce que le joueur a choisi
      // entre-temps, et la seule qui tienne `enFile` à jour.
      surRejouer: () => chercher(),
    });
  }

  /** Le personnage change : la prochaine inscription part avec le nouveau. */
  // (rien à faire : `chercher` lit `cosmetics.model` au moment de rejoindre)

  /**
   * LE NOM SE CHANGE EN CLIQUANT DESSUS — pas dans un panneau à part.
   *
   * C'est le nom sous lequel les autres nous voient, donc il part avec `bonjour` ; le
   * changer coûte une reconnexion, qu'on ne fait ni en file ni en partie : au milieu d'un
   * match, le serveur verrait un inconnu se présenter et un joueur disparaître.
   */
  function brancherPseudo() {
    const nom = el('pname');
    const champ = el('pname-champ');
    if (!nom || !champ) return;

    const ouvrir = (e) => {
      e.stopPropagation();
      if (enFile || enPartie) return;
      champ.value = nomJoueur();
      nom.classList.add('hidden');
      champ.classList.remove('hidden');
      champ.focus();
      champ.select();
    };
    const fermer = () => { champ.classList.add('hidden'); nom.classList.remove('hidden'); };
    const valider = () => {
      const v = champ.value.trim().slice(0, 24);
      fermer();
      if (v && v !== nomJoueur()) renommer(v);
    };

    nom.addEventListener('click', ouvrir);
    champ.addEventListener('click', (e) => e.stopPropagation());
    // Les touches ne doivent pas atteindre le jeu : Entrée y lance une partie.
    champ.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') valider();
      if (e.key === 'Escape') fermer();
    });
    champ.addEventListener('keyup', (e) => e.stopPropagation());
    champ.addEventListener('blur', valider);
  }

  let urlCourante = null;

  /** Change de nom et se représente au serveur sous ce nom. Hors file et hors partie. */
  function renommer(nom) {
    if (enFile || enPartie) return false;
    renommerJoueur(nom);
    majBarre();
    if (branche && urlCourante) connecter(urlCourante);
    return true;
  }

  /** Saisie d'une adresse, quand la page ne vient pas du serveur de jeu. */
  function brancherAdresse() {
    const champ = el('serveur-url');
    const bouton = el('serveur-connecter');
    champ.value = localStorage.getItem(CLE_URL) ?? 'ws://127.0.0.1:8080';
    const aller = () => {
      const url = champ.value.trim();
      if (!url) return;
      localStorage.setItem(CLE_URL, url);
      urlCourante = url;
      sfx.click();
      connecter(url);
    };
    bouton.addEventListener('click', aller);
    champ.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') aller(); });
    champ.addEventListener('keyup', (e) => e.stopPropagation());
  }

  // ---------- les points d'accroche de la boucle de jeu ----------

  /** Entrée et PLAY : une partie, ou la sortie de la file si l'on y est déjà. */
  jeu.jouer = () => { if (enFile) annuler(); else chercher(); };

  /**
   * Quitter une partie en cours (menu de pause). Le serveur passe notre personnage en
   * pilotage automatique et la partie continue ; nous, on cesse d'écouter et de piloter.
   */
  jeu.surAbandon = () => {
    if (!branche) return;
    branche.abandonner();
    enPartie = false;
    enFile = false;
    demande = null;
    hud.classList.add('hidden');
    peindre();
  };

  /*
   * UNE SESSION QUI S'OUVRE OU SE FERME CHANGE QUI L'ON EST POUR LE SERVEUR.
   *
   * La connexion part au chargement, souvent avant que le joueur se soit connecté à son
   * compte : `bonjour` est parti sans jeton, et le serveur nous tient pour un invité —
   * files gratuites seulement. Il faut donc se REPRÉSENTER avec le jeton dès que la
   * session existe, exactement comme on le fait pour un changement de nom. Pas en file ni
   * en partie : au milieu d'un match, le serveur verrait un joueur disparaître.
   */
  surSession(() => {
    if (enFile || enPartie || !branche || !urlCourante) return;
    connecter(urlCourante);
  });

  /** Pour les harnais : l'état de la file, en lecture. */
  jeu.file = {
    get etat() { return etat; },
    /** Le compte que le serveur nous reconnaît — `null` tant qu'on est un invité. */
    get compte() { return caisse.compte; },
    get enFile() { return enFile; },
    get enPartie() { return enPartie; },
    get salon() { return salon; },
    get suggestion() { return suggestion; },
    get files() { return files; },
    get demande() { return demande; },
    chercher, annuler, basculer, renommer,
  };

  brancherPseudo();
  brancherAdresse();
  peindre();

  urlCourante = await trouverServeur();
  if (!urlCourante) {
    etat = 'absent';
    peindre();
    return jeu.file;
  }
  connecter(urlCourante);
  return jeu.file;
}
