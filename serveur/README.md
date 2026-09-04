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

## Le tampon d'entrées, et pourquoi l'écart ne porte plus la latence

Jusqu'au 4 septembre 2026, le serveur gardait la dernière entrée reçue de chaque joueur
et la rejouait à chaque tick, que quelque chose soit arrivé ou non, en accusant toujours
le même numéro. Le client comparait alors sa position « à l'entrée N » à celle du
serveur — qui avait continué sans lui pendant tout l'aller-retour. L'écart valait la
vitesse fois la latence : invisible en local, 2 m et plus depuis les Canaries, c'est-à-dire
le seuil de recalage sec, vingt fois par seconde.

`tampon.js` remplace cela par une file par joueur. Le client numérote **une entrée par pas
de physique** (1/60 s), le serveur les range dans l'ordre et **chaque sous-pas du tick en
tire une** : après l'entrée N, les deux simulations ont joué les mêmes pas, et l'écart ne
mesure plus que les vrais désaccords. Trois règles, toutes mesurées au banc :

- **En famine, on extrapole** (les derniers axes, jamais un bouton) et l'accusé ne bouge
  pas — le client sait qu'il n'y a rien de neuf à comparer.
- **À la reprise, on saute autant d'images qu'on a extrapolé de pas** (boutons reportés) :
  sinon le serveur jouerait la coupure deux fois et le joueur serait propulsé.
- **La réserve d'avance ne se reconstitue que joueur immobile** — au décompte, à
  l'arrêt — parce que c'est gratuit à ce moment-là. Un joueur qui court ne paie jamais
  d'attente ; la latence ajoutée sur un réseau propre est de 33 ms.

`tools/test-harness/gigue.mjs` rejoue la connexion du directeur produit — 240 ms
d'aller-retour, une coupure de 300 ms toutes les deux secondes — et exige la même barre
que sans latence : erreur médiane sous 15 cm, zéro recalage. `tampon.mjs` éprouve la
file à sec, cas par cas.

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

## Le salon, et sa politique

Une **politique nommée** répond à quatre questions : combien de joueurs on vise, en dessous
de combien on ne part pas, au bout de combien de temps on propose de partir quand même, et
qui peut convoquer des bots.

| Politique | cible | minimum | départ réduit après | suggère à | bots |
|---|---|---|---|---|---|
| `PRODUCTION` (défaut) | 2 / 4 / 16 selon le mode | 2 / 4 / **13** | arène : **35 s sans arrivée** ; 1v1 et squad : jamais, ils partent pleins | 20 s | **jamais** |
| `DEV` | 2 / 4 / 16 selon le mode | 2 / 2 / 2 — **3 dès qu'il y a une mise** | 8 s sans arrivée | 8 s | **jamais** |
| `DUEL_TEST` | 2, tous modes | 2 | — | 5 s | **jamais** |
| `BANC` | 16 | 1 | — | — | si gratuit |

**Enlever les bots est le choix d'une politique, pas une opération chirurgicale.** Le jour
où de vrais joueurs remplissent les salons, on cesse d'utiliser `BANC` et il n'y a rien à
démonter. `PRODUCTION` les interdit déjà par construction, et la mise non nulle les
interdit une seconde fois : une garantie qui tient à un seul test tient à une seule faute
de frappe. Il n'existe volontairement **aucune** valeur qui les autoriserait
inconditionnellement.

### Trois issues, et le salon en choisit une

1. **Il se remplit** → on part tout de suite, personne n'attend pour rien.
2. **Il est au-dessus du minimum et plus personne n'arrive** → passé `calme` secondes sans
   nouvelle arrivée, on part à effectif réduit. Une arrivée remet ce compte à zéro. Personne
   n'a rien à accepter : ce qui rend ce départ défendable, c'est que le ticket annonce le
   pot **en fourchette** (13 à 16 mises pour l'arène) avant que quiconque ne clique. L'accord
   de tous a été retiré le 2 septembre 2026 : il faisait attendre treize personnes qu'une
   quatorzième daigne cliquer. Le 1v1 et le squad n'ont pas de départ réduit — leur minimum
   est leur cible.
3. **Il se fige sous le minimum** → on ne part pas, et **rien n'est annoncé**. On n'annonce
   jamais l'impossible : un compte à rebours vers une partie à trois ferait croire qu'elle
   est permise.

L'horloge est injectable : éprouver soixante secondes d'attente ne doit pas coûter soixante
secondes, sinon personne ne lance la suite de tests.

### Ce que le serveur dit à tous, même hors file

Depuis qu'il n'y a plus de partie hors ligne, le lobby **est** le matchmaking, et il ne se
regarde pas à travers un panneau. À chaque battement, l'état des **neuf files** part à tous
les connectés (`files`) : le ticket écrit « 3 waiting » sur l'arène avant qu'on y entre.

Et passé `suggererApres`, un joueur dont le salon ne part pas se voit **suggérer** une autre
file (`suggestion`) — seulement si sa partie y démarrerait ou y deviendrait proposable,
jamais pour une mise plus haute que la sienne, jamais vers un salon moins rempli, et sans que
deux joueurs puissent se suggérer l'un l'autre et se croiser. Le message `basculer` change
de file d'un seul geste, sous la même identité. `tools/test-harness/files.mjs` éprouve tout
cela sous horloge factice ; `tools/feel-lab/diag/bascule.mjs` le joue dans deux navigateurs.

### La partie s'adapte à l'effectif

| Joueurs | Manches | Pyramide |
|---|---|---|
| 2 | 1 | une finale |
| 3-4 | 2 | 2 → 1 |
| 5-7 | 3 | 3 → 2 → 1 |
| 8 | 3 | 4 → 2 → 1 |
| 16 | 3 | 8 → 4 → 1 |
| 24 | 3 | 12 → 6 → 1 |

La règle vient de `economie.js`, **la même** que celle qui calcule les gains et que le noyau
C# `MatchConfiguration.ForPlayers`. En écrire une version « serveur » ferait diverger la
partie *jouée* de la partie *payée* : un joueur verrait trois manches annoncées et en
disputerait deux. Les trois implémentations sont verrouillées entre elles par les tests, de
3 à 24 joueurs.

**Deux joueurs n'ont pas de barème**, et ce n'est pas un oubli. Il faut au moins deux
manches, donc la manche 1 laisse moins de deux joueurs, donc la manche 2 devrait en laisser
moins d'un : structurellement impossible. Un duel se joue en une finale, hors table de
gains — c'est ce qui rend `DUEL_TEST` nécessairement gratuit.

### Tester à deux machines

C'est le mode de mise au point, et il n'utilise **aucun bot** :

```js
creerSalon({ politique: 'DUEL_TEST', mise: 0 })
```

Deux vrais comptes, deux vraies machines, le vrai chemin de code. Rien à enlever ensuite, et
rien qui masque un défaut de netcode derrière un adversaire complaisant.

---

## L'argent — ce que le serveur dit au backend, et comment il le prouve

Le serveur de jeu **ne connaît aucun solde et ne signe aucune transaction Solana**. Mais il
est le seul à savoir qui a pris le départ et qui a fini où. Depuis le 2 septembre 2026, il
le dit au backend en trois moments, et chaque message est **signé Ed25519** avec
`SERVEUR_CLE` (`argent.js`, `signature.js`) :

1. **À l'entrée en file payante** : « a-t-il de quoi ? » (`/interne/soldes`). Sans compte
   vérifié — le jeton Supabase envoyé avec `bonjour`, contrôlé par `identite.js` — une
   file payante est refusée (`NON_AUTHENTIFIE`). Un nom déclaré ne désigne personne.
2. **Avant le départ** : « voici les joueurs de ce salon, engagez leurs mises »
   (`/interne/partie/engager`). Le backend fait partir chaque mise du wallet du joueur vers
   le wallet du pot, sur la chaîne, et répond qui est engagé. **Si une mise ne part pas, la
   partie est annulée** : ceux que ça concerne reçoivent la raison, les autres repartent en
   file dans un salon neuf, et le backend a déjà rendu les mises parties. Pendant ce temps
   le client affiche « STAKING… » ; la manche 1 ne s'annonce qu'après.
3. **À la fin** : le classement, le mode, la mise, l'effectif et la graine de roue
   (`/interne/partie/regler`). Le backend en dérive la ligne du tableau, paie sur la
   chaîne, et rend ce que chacun a touché ; le serveur le relaie à chaque joueur dans
   `reglement`, et le client relit son solde là-dessus.

`BACKEND_URL` et `SERVEUR_CLE` viennent du `.env` de la racine (`env.js` le charge). Au
démarrage, `pont.ping()` vérifie que le backend reconnaît notre clé : découvrir au premier
règlement que la signature est refusée, c'est seize joueurs qui ont payé et que personne
ne paie. **PRODUCTION sans `BACKEND_URL` refuse de démarrer.** `DEV`, `DUEL_TEST` et `BANC`
tournent sans backend : le client y joue avec un portefeuille de banc imaginaire, que le
serveur annonce dans `bienvenue` (`argent: false, identite: 'facultative'`).

Le serveur relaie aussi `/api/…` vers le backend : le navigateur ne connaît qu'une adresse,
celle qui lui a servi la page. La page de suivi est donc à `/api/suivi`.

---

## Lancer, et jouer

**Un seul processus sert la page ET la partie.** Ce n'est pas un raccourci : la seconde
machine ouvre une adresse et la WebSocket part vers ce même hôte. Rien à saisir, rien à
faire correspondre — deux serveurs sur deux ports obligeraient à retrouver une IP deux
fois, et cette friction-là suffit à ce qu'on ne teste pas.

```bash
cd tools/feel-lab && npm run build   # une fois, et à chaque changement du jeu
cd serveur && npm start              # affiche les adresses à ouvrir
```

Sans rien, c'est `PRODUCTION` — le jeu. `POLITIQUE=DEV npm start` (ou `npm run dev`) pour
tester à deux machines dans les trois modes, et voir les suggestions travailler.

```bash
cd tools/test-harness
node verdicts.mjs      # 74 verdicts — la simulation, sans réseau
node reseau.mjs        # 21 verdicts — le serveur et de vraies WebSockets
node client.mjs        # 16 verdicts — la prédiction contre l'autorité
node partie.mjs        # une partie complète de 16 joueurs, manche par manche

cd ../feel-lab && node diag/duel.mjs   # 14 verdicts — DEUX navigateurs, une partie
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
| **5 — fait** | `MatchResult` **signé** → `backend/` cesse de croire le navigateur (2 septembre 2026) |
| 6 | journal de replay archivé |

La phase 6 lève la condition 2 du verrou mainnet (`backend/README.md`).
