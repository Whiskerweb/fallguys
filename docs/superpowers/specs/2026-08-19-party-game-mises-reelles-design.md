# Design — Party game à mises réelles (nom de code : projet Fallguys)

> Spec validée le 19 août 2026. Source amont : étude de marché en 15 sections,
> `/Users/lucasroncey/.claude/plans/projet-gamefi-pay-to-play-earn-per-kill-graceful-sketch.md`

> ## Amendements postérieurs
>
> Le corps du document est laissé **tel qu'il a été validé** : il dit ce qu'on croyait au
> 19 août, et le réécrire effacerait la trace des décisions. Ce qui a changé depuis est
> listé ici, et c'est cette liste qui fait foi en cas de contradiction.
>
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
