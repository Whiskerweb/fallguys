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
    jeu.imposee = null;
    jeu.enligne = null;
    session.detacher();
    // Le rang vient du SERVEUR, jamais du client : c'est tout l'objet de l'exercice.
    if (moi) jeu.reglerPartie?.(moi.rang);
    jeu.returnToLobby?.();
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
