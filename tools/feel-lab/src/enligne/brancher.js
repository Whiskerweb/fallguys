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
import { montant, ordinal, table, miseChoisie } from '../economie.js';

/**
 * @param {object} jeu  l'instance de `Game`
 * @param {object} p
 * @param {string} p.url    `ws://127.0.0.1:8080`
 * @param {string} p.nom
 * @param {number} [p.mise] en micro-USDC. Zéro = partie gratuite.
 * @param {(evenement: string, data: object) => void} [p.surEvenement] pour l'interface
 */
export function brancherEnLigne(jeu, { url, nom, mise = 0, surEvenement }) {
  const session = creerSession({ url, nom });
  const dire = (quoi, data) => surEvenement?.(quoi, data);

  session.sur('etat', (etat) => dire('etat', { etat }));
  session.sur('bienvenue', (msg) => dire('bienvenue', msg));
  session.sur('refus', (msg) => dire('refus', msg));
  session.sur('salon', (msg) => dire('salon', msg));

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

  session.sur('fin-partie', (msg) => {
    dire('fin-partie', msg);

    const moi = msg.classement.find((c) => c.nom === nom);
    const rang = moi?.rang ?? msg.classement.length;
    const total = msg.classement.length;

    /*
     * ON COUPE LA SESSION AVANT D'AFFICHER.
     *
     * La boucle de jeu envoie une entrée par image tant que `jeu.enligne` existe ; la
     * laisser vivre pendant les quatre secondes du verdict enverrait deux cent quarante
     * paquets à une partie qui n'existe plus.
     */
    jeu.imposee = null;
    jeu.enligne = null;
    session.detacher();

    /*
     * LE RANG VIENT DU SERVEUR, jamais du client — c'est tout l'objet de l'exercice.
     *
     * Et il faut le MONTRER : sans cet écran, une partie en ligne se terminait par un
     * retour au lobby sans que le joueur sache s'il avait gagné. Le solo, lui, affiche un
     * verdict depuis toujours ; il n'y a aucune raison que la version qui compte soit la
     * plus muette des deux.
     */
    const gain = jeu.reglerPartie?.(rang) ?? 0;
    const gagne = rang === 1;

    jeu.verdict?.(
      gagne ? 'VICTORY!' : 'MATCH OVER',
      { etiquette: `${ordinal(rang)} of ${total}`, valeur: gain > 0 ? `+${montant(gain)} USDC` : '—' },
      gagne ? 'win' : (gain > 0 ? 'ok' : 'ko'),
    );

    /*
     * Le PODIUM, en clair. Trois lignes suffisent : dans un jeu à mises, ce que le joueur
     * veut savoir en premier c'est qui a pris la couronne, et ensuite seulement où il
     * s'est classé lui-même.
     */
    const podium = msg.classement.slice(0, 3)
      .map((c) => `${c.rang}. ${c.nom}`).join('   ');
    const ecran = document.getElementById('result-line');
    if (ecran) ecran.textContent = podium;
    const titre = document.getElementById('result-title');
    if (titre) titre.textContent = gagne ? 'MATCH WON' : `${ordinal(rang)} PLACE`;
    const temps = document.getElementById('result-time');
    if (temps) temps.textContent = gain > 0 ? `+${montant(gain)} USDC` : 'No payout';
    document.getElementById('result-card')?.classList.add('show');

    // On laisse le verdict se lire avant de rendre la main. Quatre secondes : la durée que
    // le jeu s'accorde déjà pour ses propres cartes de résultat.
    setTimeout(() => {
      document.getElementById('result-card')?.classList.remove('show');
      jeu.returnToLobby?.();
    }, 4000);
  });

  session.connecter();

  return {
    session,
    /** Entre dans la file d'attente. */
    rejoindre(m = mise) { session.rejoindre(m); },
    /** Accepte de partir à effectif réduit. */
    accepter() { session.accepter(); },
    debrancher() {
      jeu.imposee = null;
      jeu.enligne = null;
      session.fermer();
    },
  };
}
