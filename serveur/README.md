# Le serveur de jeu — autoritatif, sans navigateur

> **Phase 1.** La simulation tourne côté serveur et arbitre une partie complète. Il n'y a
> pas encore de réseau : les joueurs sont des bots, dans le même processus. Le transport
> et la prédiction client sont la phase 2.

Le serveur ne connaît aucun solde et ne déclenche aucun paiement (spec § 6.3). Il produit
un classement ; `backend/` le convertit en argent.

---

## Le pari, et sa vérification

Tout repose sur une question : **le code du jeu tourne-t-il sans navigateur ?** Si non,
il faudrait réécrire une simulation « serveur », qui divergerait de celle du client au
premier réglage — et le jour où elle diverge, la prédiction du client cesse de coller sans
que rien ne le signale.

La réponse est oui, et elle a coûté moins cher que prévu :

| | |
|---|---|
| Rapier sous Node | init 50 ms, puis 0,02 ms/pas |
| Les cinq cartes, construites | 5 à 180 ms · 141 à 498 colliders |
| 16 personnages **réels**, pilotés | **0,147 ms/tick**, soit 0,4 % d'un cœur à 30 Hz |

Ce qu'il a fallu, et rien de plus : ~90 lignes de doublures (`navigateur-absent.js`). Les
modules du jeu ne touchent au navigateur qu'en trois endroits — un `<canvas>` pour les
textures, `location.search` pour les drapeaux, `localStorage` pour les préférences. Aucune
scène n'a été découpée en deux.

**La physique n'est pas le goulot** : au-delà de 200 parties simultanées par cœur, ce sont
le réseau et la sérialisation qui limiteront.

---

## Ce que la phase 1 a révélé

Trois écarts que seul le fait de construire pouvait faire apparaître.

**1. `Math.random` dans la physique — et c'est un problème juridique.**
`character.js` tirait la vitesse angulaire de la culbute avec `Math.random()`. C'est un
générateur aléatoire *dans le monde du jeu*, exactement ce que la spec interdit (§ 5) : la
façon dont un joueur culbute décide de l'endroit où il se relève, donc de sa place, donc
de son gain. C'était aussi la seule source de non-reproductibilité — deux parties de même
graine ne donnaient pas le même classement. La suite est désormais **semée**, dérivée de
la graine de manche et du numéro de joueur, si bien que client et serveur culbutent à
l'identique.

**2. Le contrat de scène était mono-joueur.**
`arena.update(elapsed, dt, focus, …)` ne recevait qu'une position. Sur Les Dalles, Les
Portes et L'Hexagone — les trois cartes à terrain interactif — cela voulait dire qu'un
seul joueur usait le sol pendant que les quinze autres marchaient gratuitement. `focus`
accepte désormais une position **ou une liste**. Le client passe toujours un `Vector3` et
ne voit aucune différence.

**3. Une manche pouvait ne qualifier personne.**
Si huit joueurs devaient passer et qu'aucun ne franchissait la ligne, huit places
restaient vides — alors que la table des gains promet « passe la première manche, tu
récupères ta mise » à huit joueurs. Les places non pourvues reviennent maintenant aux plus
avancés. En survie, la même règle donne ce qu'Hex-A-Gone fait déjà : si tout le monde
tombe, **le dernier tombé gagne**.

---

## Le tick, et pourquoi il est recopié

`tick.js` reproduit une image du client, pas à pas. Trois pièges y sont documentés, tous
rencontrés :

1. **`world.step()` avance de `world.timestep` (1/60), quoi qu'on lui passe.** Un tick
   serveur à 30 Hz vaut donc DEUX sous-pas — et les constantes de `tuning.js` ont été
   mesurées à 1/60.
2. **`limiterVitesse()` s'appelle après le pas**, jamais avant : c'est le solveur qui
   produit les expulsions. Sans ce garde-fou, une capsule coincée part à vitesse non
   bornée puis en NaN — et un NaN rend toute comparaison fausse, donc déclenche à vide
   chaque zone de la carte.
3. **Un rayon ne touche rien tant que le monde n'a pas fait un pas** : la structure
   d'accélération de Rapier n'existe pas avant. Le décompte s'en charge.

---

## Les bots

Ils remplissent les parties pour qu'on puisse les tester. Trois niveaux — `fort`, `moyen`,
`faible` — qui ne diffèrent que par des **dégradations du même pilote** : délai de
réaction, erreur de visée, sauts manqués, vitesse.

Le noyau de navigation n'est pas inventé : il vient de `tools/feel-lab/diag/traversee.mjs`,
qui traverse La Course depuis des mois. Mes premiers essais, écrits de zéro, mouraient au
premier trou. Trois leçons y étaient déjà écrites, et elles coûtent cher à retrouver :
on ne braque pas en approche de fosse ni en vol (la vitesse est un budget partagé entre X
et Z) ; l'origine du rayon doit être **devant** le corps, sinon il touche sa propre capsule ;
le saut a un temps de recharge.

**Tout est déterministe.** Aucun `Math.random` : erreur de visée, sauts manqués et délais
dérivent de la graine de manche et du numéro du bot. Un bot indéterministe est un bot
qu'on ne peut pas déboguer.

> ### Les bots n'entrent jamais dans une partie payante
>
> `salon.js` refuse de les convoquer dès que la mise est non nulle — la partie part alors
> **à effectif réduit**. Toute la qualification « compétition de skill » repose sur le fait
> qu'aucune machine ne décide de l'issue ; payer un joueur selon son classement face à des
> adversaires pilotés par le serveur est précisément le point sur lequel un régulateur se
> penche. C'est une barrière de code, vérifiée par un verdict du harnais, pas une consigne
> qu'on se rappelle de suivre.

**État réel du pilote** : il traverse une bonne partie des cartes mais n'en finit aucune de
façon fiable, et l'ordre `fort > moyen > faible` ne tient qu'épisodiquement — sur une carte
à la fois selon les réglages. Le harnais **mesure et affiche** cet ordre sans en faire un
verdict : poser une assertion qui échoue quatre fois sur cinq n'apprendrait rien et
finirait ignorée. C'est le premier chantier de la suite.

---

## Le salon

Attente de **15 secondes** à partir du **premier** joueur — pas de chaque arrivée, sinon un
flux régulier repousserait le départ indéfiniment. À l'échéance, on complète avec des bots
(si la mise est nulle) et on part. Un salon plein part sans attendre.

L'horloge est injectable : éprouver quinze secondes d'attente ne doit pas coûter quinze
secondes, sinon personne ne lance la suite de tests.

---

## Lancer

```bash
cd tools/test-harness
node verdicts.mjs      # 37 verdicts, ~55 s, aucun réseau ni installation
node partie.mjs        # une partie complète de 16 joueurs, manche par manche
node partie.mjs 777 8  # graine 777, salon de 8
```

Les dépendances viennent de `tools/feel-lab/node_modules` : les modules du jeu résolvent
`three` et `rapier` depuis leur propre emplacement, et `monde.js` passe par
`feel-lab/src/moteur.js` pour obtenir **la même instance**. Une seconde copie de Three
ferait cohabiter deux classes `Vector3` qui se ressemblent assez pour fonctionner par
canard-typage, et assez peu pour qu'un `instanceof` échoue un jour sans rien expliquer.

---

## La suite

| Phase | |
|---|---|
| **1 — fait** | simulation autoritative, bots, salon, harnais |
| 2 | transport (WebSocket), prédiction client, réconciliation |
| 3 | salons réels, matchmaking, reconnexion |
| 4 | collisions entre joueurs |
| 5 | `MatchResult` **signé** → `backend/` cesse de croire le navigateur |
| 6 | journal de replay archivé |

Les phases 5 et 6 lèvent les conditions 1, 2 et 3 du verrou mainnet
(`backend/README.md`).
