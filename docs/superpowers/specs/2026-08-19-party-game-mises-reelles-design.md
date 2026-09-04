# Design — Party game à mises réelles (nom de code : projet Fallguys)

> Spec validée le 19 août 2026. Source amont : étude de marché en 15 sections,
> `/Users/lucasroncey/.claude/plans/projet-gamefi-pay-to-play-earn-per-kill-graceful-sketch.md`

> ## Amendements postérieurs
>
> Le corps du document est laissé **tel qu'il a été validé** : il dit ce qu'on croyait au
> 19 août, et le réécrire effacerait la trace des décisions. Ce qui a changé depuis est
> listé ici, et c'est cette liste qui fait foi en cas de contradiction.
>
> **2 septembre 2026 — LA ROUE TIRE, APRÈS LA PARTIE. Décision du directeur produit.**
>
> Ceci renverse l'amendement du 1er septembre ci-dessous, et le § 5 avec lui. Le directeur
> produit a été prévenu que le tirage d'un montant APRÈS l'engagement de la mise est le
> motif exact d'une requalification en jeu d'argent, que Betclic opère sous licence, et
> qu'une variante « tirée avant, scellée, révélée après » donnait la même sensation sans
> ce risque. Il a choisi le tirage après. Cette décision est la sienne, elle est consignée
> ici, et **aucun code de ce dépôt ne la tranche** — la validation juridique reste sur la
> liste d'avant-mainnet de `backend/README.md`, en tête.
>
> Ce que la roue devient :
>
> - **Une roue PAR JOUEUR, selon son PALIER.** Diamant pour le 1er, or pour le podium,
>   argent pour la bande remboursée, bronze pour ceux qui ont perdu leur mise.
>   Arène : ◆ 1 · ★ 2-4 · ● 5-8 · ○ 9-16. Squad : ◆ 1 · ★ 2 · ○ 3-4. Duel : ◆ 1 · ○ 2.
> - **Dix cases par roue, de tailles inégales.** La taille d'une case EST sa probabilité —
>   règle inchangée. Les montants d'un même palier diffèrent d'un rang à l'autre, et se
>   répètent parfois : c'est voulu, c'est ce qui rend la roue crédible.
> - **Les bronzes gagnent de l'XP, et parfois leur mise.** Chaque roue de bronze porte une
>   case « mise rendue » (4 à 14 % selon le rang en arène, 6 à 9 % en squad, une demi-mise
>   au mieux en duel) et neuf cases d'XP, de 15 à 150.
> - **La maison ne sort jamais d'argent, et prend 10 % EN MOYENNE.** Les dix cases de
>   toutes les roues d'une partie sont les dix colonnes d'un même tableau : à chaque partie,
>   UNE ligne est tirée. Une ligne distribue entre 70 % et 100 % du pot — jamais plus ; ce
>   qu'elle ne distribue pas est le rake de cette partie, de 0 % (JACKPOT en duel, tout le
>   pot au vainqueur) à 17,5 % (FLAT en duel). Pondérées par leurs poids, les dix lignes
>   distribuent exactement 90 % du pot. Première version : 90 % sur CHAQUE ligne, rake fixe.
>   Le directeur produit a vu trois fois « 3.60 » sur la roue d'un duel à 2 USDC et demandé
>   des petites variations et une case à 4,00 : à rake fixe, dix montants distincts n'existent
>   pas (sept valeurs possibles entre 2,40 et 3,60), et 4,00 est le pot entier. Décision du
>   2 septembre 2026, seconde version : le rake varie avec la ligne, la moyenne ne bouge pas.
> - **Le tirage vient du SERVEUR, à la fin.** Une graine de 32 bits tirée au hasard
>   cryptographique au classement final, publiée dans `fin-partie` et écrite au grand
>   livre. Client et backend recalculent la même ligne avec le même mélangeur (lowbias32).
>   Rien n'est tiré dans le salon : le lobby montre désormais les DIX possibilités de
>   chaque palier et leur espérance, pas une table certaine.
> - **Le joueur ne voit pas son gain avant de lancer.** Le bandeau dit le rang ; le montant
>   n'apparaît qu'à l'arrêt de la roue. Demande explicite.
> - **Les salons réduits (arène partie à 13, 14 ou 15) restent au barème calculé, sans
>   roue.** Le tableau à dix colonnes est écrit pour seize rangs ; le tordre pour treize
>   déplacerait les 66 tables verrouillées. Le résultat s'y affiche directement.
>
> Les dix lignes de chaque mode, en VINGTIÈMES de mise (20 = la mise ; le pot vaut
> 20 × joueurs ; la moyenne pondérée vaut 18 × joueurs, soit 90 %) :
>
> | Arène 16 | poids | 1er | 2e | 3e | 4e | 5e-8e | mise rendue à | somme | rake |
> |---|---|---|---|---|---|---|---|---|---|
> | plat | 6 % | 50 | 44 | 38 | 30 | 26 · 24 · 23 · 21 | 15e | 276 | 13,8 % |
> | doux | 9 % | 62 | 45 | 35 | 27 | 25 · 23 · 22 · 21 | 13e | 280 | 12,5 % |
> | partage | 12 % | 70 | 51 | 31 | 26 | 23 · 22 · 21 · 20 | 11e | 284 | 11,3 % |
> | equilibre | 14 % | 82 | 47 | 29 | 25 | 22 · 21 · 20 · 20 | 10e | 286 | 10,6 % |
> | standard | 22 % | 100 | 50 | 34 | 24 | 20 · 20 · 20 · 20 | — | 288 | 10 % |
> | podium | 14 % | 102 | 39 | 26 | 23 | 20 · 20 · 20 · 20 | 9e | 290 | 9,4 % |
> | pointu | 10 % | 116 | 33 | 24 | 21 | 20 · 20 · 20 · 20 | 12e | 294 | 8,1 % |
> | couronne | 7 % | 125 | 28 | 23 | 20 | 20 · 20 · 20 · 20 | 14e | 296 | 7,5 % |
> | royale | 4 % | 131 | 26 | 22 | 22 | 20 · 20 · 20 · 20 | 16e | 301 | 5,9 % |
> | jackpot | 2 % | 158 | 22 | 20 | 20 | 20 · 20 · 20 · 20 | — | 300 | 6,3 % |
>
> Espérance en arène : 1er ×4,67 · 2e ×2,13 · 3e ×1,48 · 4e ×1,21 · 5e-8e ×1,01-1,07 ·
> 9e-16e ×0,04-0,14. Le vainqueur voit dix montants distincts, de 2,5 à 7,9 fois sa
> mise ; à 2 USDC, de 5,00 à 15,80 USDC, espérance 9,35. Les 2e, 3e et 4e ont aussi dix
> montants distincts (neuf pour le 4e).
>
> | Squad 4 | poids | 1er | 2e | 3e | 4e | somme | | Duel | poids | 1er | 2e | somme |
> |---|---|---|---|---|---|---|---|---|---|---|---|---|
> | plat | 6 % | 30 | 24 | 0 | 13 | 67 | | plat | 6 % | 26 | 7 | 33 |
> | doux | 9 % | 33 | 21 | 13 | 0 | 67 | | doux | 9 % | 28 | 8 | 36 |
> | partage | 12 % | 37 | 33 | 0 | 0 | 70 | | partage | 12 % | 30 | 8 | 38 |
> | equilibre | 14 % | 41 | 31 | 0 | 0 | 72 | | equilibre | 14 % | 35 | 0 | 35 |
> | standard | 22 % | 50 | 22 | 0 | 0 | 72 | | standard | 22 % | 36 | 0 | 36 |
> | podium | 14 % | 45 | 27 | 0 | 0 | 72 | | podium | 14 % | 37 | 0 | 37 |
> | pointu | 10 % | 48 | 26 | 0 | 0 | 74 | | pointu | 10 % | 32 | 0 | 32 |
> | couronne | 7 % | 52 | 25 | 0 | 0 | 77 | | couronne | 7 % | 38 | 0 | 38 |
> | royale | 4 % | 56 | 23 | 0 | 0 | 79 | | royale | 4 % | 39 | 0 | 39 |
> | jackpot | 2 % | 60 | 20 | 0 | 0 | 80 | | jackpot | 2 % | 40 | 0 | 40 |
>
> Squad : 1er ×2,21 (dix montants distincts, de ×1,5 à ×3,0), 2e ×1,30 (dix montants
> distincts), 3e et 4e ×0,06 et ×0,04. Duel à 2 USDC : le vainqueur voit 2,60 · 2,80 ·
> 3,00 · 3,20 · 3,50 · 3,60 · 3,70 · 3,80 · 3,90 · 4,00, espérance 3,39 (×1,70) ; le perdant
> récupère 0,70 à 0,80 USDC sur les trois lignes basses (27 % du temps), de l'XP ailleurs.
> La case 4,00 est le pot entier : la maison n'y garde rien, et se rattrape sur FLAT.
>
> Le tableau se lit aussi rang par rang : la roue du 9e en arène, c'est la colonne « 9e »
> — neuf cases d'XP et une case « mise rendue » sur la ligne PODIUM, 14 % du disque.
>
> Ces chiffres sont des DONNÉES, verrouillées par les tests des trois implémentations ;
> les changer est une décision produit, pas un correctif. La table qui fait foi est
> `PrizeWheelTests.cs`, comparée à chaque exécution à `economie.js` et `gains.js`.
>
> **1er septembre 2026 — trois modes, trois mises, et la roue.** Le § 3 décrit UNE forme
> de partie : seize joueurs, trois manches, une table. Il y en a désormais trois, aux
> mises **2 / 5 / 10 USDC** (et non plus 1 / 2 / 5) :
>
> | Mode | Joueurs | Manches | Places payées | Vainqueur |
> |---|---|---|---|---|
> | `duel` — 1v1 | 2 | 1 | 1 | ×1,8 |
> | `squad` — SQUAD 4 | 4 | 2 | 2 | ×1,9 à ×2,6 |
> | `arena` — ARENA 16 | 16 | 3 | 8 | ×2,9 à ×7,4 |
>
> Le duel et le squad sont la réponse au **démarrage à froid**, que le § 2 nomme comme le
> risque n°1 : remplir seize places demande seize personnes vivantes prêtes à miser le
> même montant au même instant. Deux, on les trouve. Le coût est que neuf files remplacent
> trois, et que l'arène devient plus dure à lancer qu'elle ne l'était.
>
> **La roue.** Avant chaque partie de squad ou d'arène, une roue tire la FORME du barème :
> une variante parmi quatre ou cinq, de la plus plate (ÉGALITÉ, ×2,9 au vainqueur) à la
> plus pointue (ROYALE, ×7,4). Le pot ne bouge pas — le rake reste exactement 10 %, la
> maison ne porte aucun risque, et **« passe la manche 1, tu récupères ta mise » survit à
> toutes les variantes**. Ce que la roue donne au vainqueur, elle le retire au reste du
> haut de tableau ; d'où le plafond dur de ×7,4, qui est simplement ce qui reste quand les
> huit remboursés ont leur mise. La variante STANDARD tombe une fois sur deux et **EST**,
> au dixième près, la table de référence ci-dessus : la roue n'invente pas un barème, elle
> ajoute de la variance autour de celui qui existait.
>
> **ELLE TOURNE AVANT LE DÉPART, DANS LE LOBBY, ET C'EST UNE DÉCISION DE § 5, PAS D'ERGONOMIE.**
> Le § 5 fait reposer toute la qualification « compétition de skill » sur le fait qu'aucune
> machine ne décide de l'issue. Une roue tournée APRÈS la partie déterminerait le montant
> du prix par le hasard, une fois la mise engagée : c'est le motif exact qu'un régulateur
> cherche pour requalifier en jeu d'argent. Tirée de la graine du salon à sa création, et
> affichée pendant qu'il se remplit, ce n'est plus un tirage — c'est un **tournoi à barème
> publié**, que le joueur lit avant de décider de jouer. Le duel n'a pas de roue du tout :
> une seule place payée, rien à redistribuer, barème entièrement fixe.
>
> Le § 5 est donc **étendu, pas amendé** : sa règle « aucun générateur aléatoire dans le
> monde du jeu » vaut toujours, et la roue n'est pas dans le monde du jeu. Ce qu'il faut y
> ajouter est une seconde règle du même ordre : **aucun tirage après l'engagement de la
> mise.**
>
> La table qui fait foi reste celle des tests — `PrizeWheelTests.cs` et `MatchModeTests.cs`
> côté noyau, vérifiées à chaque exécution contre `tools/feel-lab/src/economie.js` et
> `backend/src/gains.js`, catalogue de variantes ET tirage compris.
>
> **1er septembre 2026 — l'argent est branché sur le jeu en ligne.** Il ne l'était pas : le
> lobby envoyait `mise: 0` en dur, et toutes les parties en ligne étaient gratuites quel
> que soit le palier affiché. La mise part désormais au lancement de la manche 1, et le
> gain est versé au classement rendu par le serveur. Cela **étend au multijoueur** la
> limite déjà documentée en solo — le navigateur déclare son résultat — sans l'aggraver en
> nature. Le correctif est le même et il est le même depuis le début : `MatchResult` signé
> par le serveur de jeu, qui devra couvrir le mode et la variante en plus du classement.

> **31 août 2026 — le moteur.** Le § 2 retient Unity 6, desktop d'abord. Ça n'a jamais été
> commencé : `game/` est vide. Le jeu réel est `tools/feel-lab`, en Three.js + Rapier dans
> le navigateur, avec cinq épreuves jouables. Le § 6 (assemblies `.asmdef`) décrit donc une
> architecture qui n'existe pas ; seul `src/Fallguys.Rules` en a été construit, et il est à
> jour.
>
> **31 août 2026 — le rake passe de 15 % à 10 %,** et les poids de bonus de `[35, 15, 5, 1]`
> à `[40, 15, 7, 2]`. Les anciens poids étaient calibrés pour tomber sur des chiffres ronds
> *à 15 %* ; à 10 % la même formule paie 2,714285 USDC au deuxième. La table du § 3 est donc
> périmée — la table qui fait foi est celle de `PayoutPolicyTests.cs`, vérifiée à chaque
> exécution contre `tools/feel-lab/src/economie.js` et `backend/src/gains.js`.
> Vainqueur ×5,0 au lieu de ×4,5 ; la règle « passe la première manche, tu récupères ta
> mise » est inchangée.
>
> **31 août 2026 — l'argent réel est câblé, sur devnet.** Le § 6.7 le rangeait en « plus
> tard » ; c'est fait, dans `backend/` : comptes Supabase, dépôts et retraits USDC, grand
> livre en partie double. Le § 6.3 (séparation jeu / argent) est respecté. En revanche
> **le § 6.7 supposait que le serveur autoritatif viendrait d'abord** — ce n'est pas le cas,
> et c'est un ordre assumé pour tester la boucle financière sans risque. Les conditions à
> remplir avant tout mainnet sont dans `backend/README.md`.

## 1. Concept

Party game de parcours d'obstacles, style cartoon, avec entrée payante et redistribution
en argent réel aux gagnants. Le slot "party game cartoon + cash réel" est vide : Fall Guys
n'a pas de mises, Stumble Guys s'arrête à la monnaie douce sans cash-out, Pudgy Party fait
du cosmétique web3 sans mises. Le seul comparable frontal (BR1 Infinite, shooter) grind
depuis 4 ans sans percer, avec des murs structurellement plus hauts que les nôtres.

**Proposition de valeur assumée :** on ne bat pas Fall Guys en qualité de jeu. La mise EST
la proposition de valeur.

## 2. Décisions actées

| Décision | Choix | Raison décisive |
|---|---|---|
| Interaction entre joueurs | **Collisions physiques réelles, autoritatives serveur** | Décision produit : sans le contact, ce n'est pas le jeu. |
| Netcode | Prédiction client contre le décor, autorité serveur sur les contacts | Évite le rollback complet : 8-14 semaines au lieu de 4-8 mois. |
| Moteur | **Unity 6** | MCP officiel (je pilote l'éditeur sans intervention manuelle), netcode mature (Fish-Net/Netick), chemin WebGPU pour le client web, un projet → deux builds. |
| Distribution (cible) | **Web** pour gratuit + micro-mises, **desktop** pour paliers élevés | Le web maximise l'acquisition (moteur de croissance = collabs), le desktop maximise le coût de fabrication d'un bot. Sécurité graduée par palier. |
| Distribution (ordre de build) | **Desktop d'abord**, client web au second temps | Un seul client à déboguer pendant que le netcode se stabilise. `ITransport` est posé dès le jour 1 pour que le web ne soit qu'un ajout, jamais un refactor. |
| Anti-bot | Friction **à la sortie** (retrait minimum, délai, KYC au seuil), pas à l'entrée | Modèle BR1 (25 USDC min). Permet d'ouvrir le web en grand sans exposer la caisse. |
| Taille de lobby | **16 joueurs** (structure en % → tourne de 12 à 24) | Remplir 16 places est ~4× plus rapide que 60. Le cold start est le risque n°1 créé par le choix des collisions. |
| Direction artistique | **Cartoon haut de gamme** (Fall Guys, Astro Bot, Pudgy Party) | Le ragdoll n'est comique que sur un personnage abstrait ; les mascottes de collab sont toutes cartoon ; le client web impose un budget perf. |

### Décisions écartées, et pourquoi (pour mémoire)

- **Time-trial asynchrone** : netcode trivial et légalement le plus propre, mais ce n'est plus
  un party game, et le mur des 95 % de perdants y est pire (le leaderboard rend la défaite
  explicite et permanente).
- **Course simultanée sans collisions** : aurait divisé le coût netcode par 5 et supprimé le
  risque de collusion, mais retire le contact — écarté par décision produit.
- **Godot 4** : serveur headless plus léger, licence MIT, projet en fichiers texte. Perd sur
  le web 3D (WebGL2 seulement, et le C# ne s'exporte pas en web) et sur le netcode prêt à l'emploi.
- **Photoréalisme** : casse le comique du ragdoll, rend les collabs de mascottes impossibles,
  tue le client web, et exhibe les défauts des assets générés.

## 3. Boucle de partie

| Manche | Rôle | Entrants | Sortants | Durée |
|---|---|---|---|---|
| 1 | Qualification | 16 | 8 | ~75 s |
| 2 | Attrition | 8 | 4 | ~2 min |
| 3 | Finale | 4 | 1 | ~45 s |

**Payouts gradués.** Pot = 16 × mise. Rake plateforme 15 % (curseur 10-25 %).
Exemple à 1 $ : 16 $ collectés, 13,60 $ redistribués.

| Rang | Nb | Gain | Effet |
|---|---|---|---|
| 1er | 1 | 4,50 $ | ×4,5 |
| 2e | 1 | 2,50 $ | ×2,5 |
| 3e | 1 | 1,50 $ | ×1,5 |
| 4e | 1 | 1,10 $ | petit gain |
| 5e-8e | 4 | 1,00 $ | **mise remboursée** |
| 9e-16e | 8 | 0 $ | perte de la mise |

Le seuil de remboursement est placé exactement à la fin de la manche 1. Règle qui tient en
une phrase : **« passe la première manche, tu récupères ta mise »**. Taux de non-perte : 50 %
(contre 1,7 % pour un format 1 gagnant sur 60).

**Paliers** : gratuit (entraînement + argument légal) / micro 0,25-1 $ / élevé.
Les cosmétiques premium réduiront le rake du joueur (modèle ERB de BR1) — c'est leur utilité,
pas de la spéculation. Hors périmètre MVP.

## 4. Les trois mini-jeux

Un mini-jeu par étage de la pyramide d'élimination, pas trois choisis pour la variété.

### 4.1 « La Course » — qualification (16 → 8, ~75 s)
Parcours linéaire. Bras rotatifs, pendules, portes battantes, tapis roulants, rampes
glissantes, un passage étroit créant volontairement du bouchon. Les 8 premiers passent.
Compétence : lecture d'obstacle et timing sous pression de vitesse.
Rôle : lisibilité immédiate, absorbe 16 corps, meilleure vitrine à clips.

### 4.2 « Les Hexagones » — attrition (8 → 4, ~2 min)
Étages de plateformes hexagonales qui disparaissent une seconde après le passage.
Tomber d'un étage fait descendre ; tomber du dernier élimine. Les 4 derniers passent.
Compétence : planification spatiale, gestion d'une ressource finie.
Rôle : **pièce à conviction légale** — map entièrement statique, tout découle des actions
des joueurs. C'est aussi là que les collisions deviennent tactiques.

### 4.3 « L'Ascension » — finale (4 → 1, ~45 s)
Pilier vertical, obstacles balayants, couronne au sommet. Premier à la toucher gagne.
Compétence : exécution sous pression, arbitrage risque/sécurité.
Rôle : contraste (verticalité, très court), et surtout **image de victoire** — le plan de fin
des clips, et l'objet que les partenaires de collab voudront skinner.

## 5. Contrainte légale de design

Voie visée : qualification **compétition de skill** (modèle Skillz, légal dans 45 États US).
France = juridiction hostile, à géo-exclure. Paiements en USDC pour contourner les
processeurs de paiement. Distribution hors Steam (Valve interdit les jeux crypto).

**Règle unique, sans exception : aucun générateur aléatoire dans le monde du jeu.**

Interdit :
- Portes truquées / choix à l'aveugle (récupérable si la bonne porte porte un indice visuel
  discret : le choix redevient de l'observation).
- Obstacles à trajectoire ou timing aléatoires.
- Objets distribués au hasard, positions de départ tirées au sort.

Autorisé — et c'est ce qui sauve le jeu :
- **Les collisions entre joueurs.** Se faire bousculer par un adversaire n'est pas un
  événement aléatoire au sens juridique : c'est la décision d'un autre compétiteur, comme un
  contact au rugby. Le hasard prohibé, c'est la machine qui tire un dé.

Conséquences de level design, applicables dès la première map :
1. Tous les obstacles tournent sur des cycles temporels fixes, démarrés au même instant pour
   tous. Mémoriser un rythme est un apprentissage, donc du skill démontrable.
2. Les lignes de départ sont conçues pour que la position n'ait aucune valeur (couloir large,
   distance identique au premier obstacle). Évite d'avoir à attribuer — donc à tirer — les places.

## 6. Architecture logicielle

**Principe directeur :** le code est rangé selon la façon dont il peut être vérifié sans
intervention humaine. La zone la plus coûteuse (jugement du feel) doit rester la plus petite.

| Zone | Vérification | Vitesse |
|---|---|---|
| Logique pure | Tests unitaires C# sans Unity | ms |
| Simulation physique | Unity headless (`-batchmode -nographics`) | s |
| Rendu, animation, feel | Humain, manette en main | temps humain |

### 6.1 Assemblies (`.asmdef` — dépendances interdites au compilateur, pas par convention)

| Assembly | Contient | Référence | Testé par |
|---|---|---|---|
| `Game.Rules` | Machine à états de partie, élimination, classement, payouts | **rien** (C# pur) | EditMode |
| `Game.Simulation` | Contrôleur perso, collisions, obstacles, ragdoll | `Rules` + physique Unity | PlayMode headless |
| `Game.Net` | Transport, sérialisation, snapshots, prédiction, journal de replay | `Rules`, `Simulation` | intégration headless |
| `Game.Presentation` | Rendu, anims, VFX, son, caméra, UI | tout | humain |
| `Game.Platform` | Comptes, wallet, mises, géo, KYC — interfaces + stubs au MVP | `Rules` | tests sur stubs |

Règle dure : `Game.Simulation` ignore l'existence de `Game.Presentation`.
Le serveur exécute Rules + Simulation + Net, rien d'autre.

### 6.2 Contrat réseau
- Client → serveur : `InputFrame { tick, moveX, moveY, jump, dive, grab }` (~6 octets),
  60 Hz, avec redondance des 3 dernières frames (survit à la perte sans retransmission).
- Serveur → client : snapshot delta-compressé à 20 Hz, positions quantifiées 16 bits/axe.
  16 joueurs ≈ 250 octets/snapshot ≈ 5 Ko/s par joueur.
- Tick de simulation : **30 Hz**.
- **`ITransport` abstrait, obligatoire dès le jour 1** : UDP natif (desktop) / WebSocket ou
  WebRTC DataChannel (web, qui n'a pas accès à UDP). Rétrofitter cette abstraction plus tard
  serait un des refactors les plus coûteux du projet.

### 6.3 Séparation jeu / argent — non négociable
Le serveur de jeu ne connaît aucun solde, n'accède pas à la base, ne déclenche aucun paiement.
Il produit un `MatchResult` signé : classement, participants, hash du replay, version du build.
Un service backend séparé vérifie la signature, applique la politique de payout et crédite.

Conséquence : un serveur de jeu compromis peut au pire fausser un classement — pas vider une
caisse. Et le replay archivé rend un classement faussé détectable après coup.

### 6.4 Journal de replay (~100 Ko compressés par partie)
Enregistre tous les inputs, l'état initial, la version du build, le hash de la config physique.
Trois usages :
- **Arbitrage de litige** : rejouer la partie contestée et montrer.
- **Détection de bot en différé** : analyse statistique des timings hors ligne, zéro CPU en partie.
- **Non-régression du feel** : replays de référence qui doivent reproduire la trajectoire à
  l'identique. Toucher une constante physique casse le test avant que l'humain teste.

### 6.5 Game feel
Toutes les constantes (vitesse, accélération, frictions sol/air, hauteur de saut, coyote time,
impulsion de plongeon, masse, force de bousculade, raideur du ragdoll, réactivité caméra) dans
un fichier de config externe rechargeable à chaud + panneau debug à sliders en jeu.
**Le serveur charge la même config et vérifie son hash à la connexion** — sinon le fichier de
tuning devient un vecteur de triche.

### 6.6 Harnais multi-clients — priorité n°1, livrable de première semaine
Un serveur + 15 clients headless pilotés par inputs scriptés ou rejoués, avec simulation de
latence et de perte. Sans lui, un jeu multijoueur est indéveloppable en solo : personne ne peut
tester un lobby de 16 à la main.

### 6.7 Ancrages posés, non implémentés

| Ancrage | MVP | Plus tard |
|---|---|---|
| Identité | `PlayerId` stable | Comptes, wallet, KYC |
| Mise | `StakeContext { tier, amount }` = `Free` | Paliers réels, USDC |
| Résultat | `MatchResult` signé, même en gratuit | Converti en paiement |
| Payouts | Calculés et affichés en monnaie fictive | Versement réel |
| Géo | Juridiction enregistrée, point de contrôle passant | Blocage effectif, France exclue |
| Rake | Appliqué au calcul, affiché | Encaissé |

Le mode gratuit exécute **exactement le même chemin de code** que le mode payant, aux montants
près. Brancher l'argent = remplacer des implémentations d'interfaces, sans toucher au jeu.
Permet aussi de faire tester le jeu dès maintenant, partout, sans exposition réglementaire.

### 6.8 Arborescence
```
/game                    Projet Unity (client web + desktop + serveur)
  /Assets/Scripts/{Rules,Simulation,Net,Presentation,Platform}
  /Assets/Content/{Characters,Obstacles,Maps,Cosmetics}
  /Assets/Tests/{EditMode,PlayMode}
/backend                 Matchmaking, comptes, résultats, payouts
/tools/meshy-pipeline    Génération → import → conventions Unity
/tools/test-harness      1 serveur + 15 clients headless
/tools/replay-analyzer   Détection de bot hors ligne
/docs/specs
```

## 7. Périmètre MVP

**Dedans :** les 3 mini-jeux, la boucle de partie complète à 16 joueurs, le netcode avec
collisions autoritatives, le harnais de test, le journal de replay, la config de game feel,
les payouts calculés en monnaie fictive, le pipeline Meshy, un lobby fonctionnel.

**Dehors (cycles spec → plan → implémentation séparés) :** paiements réels et wallet, KYC et
géo-restriction effective, cosmétiques et réduction de rake, lobby social avec avatars visibles,
collabs de skins, matchmaking à grande échelle, client web (le desktop d'abord, le web ensuite —
mais `ITransport` est posé dès maintenant).

## 8. Risques ouverts

1. **Cold start** (risque n°1, créé par le choix des collisions) : il faut 16 joueurs vivants
   prêts à miser le même montant au même instant. Leviers identifiés, non tranchés : lobbies de
   12-16 plutôt que 60, départs à heure fixe plutôt que matchmaking continu, palier gratuit comme
   vivier. Chacun a des effets de bord économiques. À traiter comme une section de design à part.
2. **Légal** : le vide du slot peut signifier « interdit en pratique » plutôt que « personne n'y
   a pensé ». À valider juridiquement avant de brancher de l'argent réel — pas avant de coder.
3. **Collusion** : deux joueurs coordonnés peuvent en bloquer un troisième. Conséquence directe
   du choix des collisions, non résolue à ce jour dans l'industrie. Mitigations à concevoir
   (détection de patterns dans les replays, lobbies non choisis).
4. **Friction d'installation** : le desktop coûte la conversion des collabs. Compensé
   partiellement par le client web prévu au second temps.
