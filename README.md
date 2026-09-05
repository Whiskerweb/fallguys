# Tumble — party game à mises réelles

Un jeu de parcours d'obstacles façon Fall Guys, jouable **dans un navigateur**, avec entrée
payante en USDC et redistribution aux gagnants. La mise est la proposition de valeur : on
ne bat pas Fall Guys en qualité de jeu, on occupe un créneau vide.

Le design complet est dans [`docs/superpowers/specs/`](docs/superpowers/specs/) — lisez les
**Amendements** en tête du fichier avant le corps, ils disent ce qui a changé depuis.

---

## Jouer à deux, tout de suite

```bash
cd tools/feel-lab && npm install && npm run build
cd ../../serveur   && npm install && npm start
```

Le serveur affiche deux adresses :

```
  Ouvrez le jeu ici :
    http://localhost:8080          (cette machine)
    http://192.168.1.137:8080      (les autres machines du réseau)
```

Ouvrez la première sur une machine, la seconde sur l'autre. La page se connecte toute
seule au serveur qui l'a servie — la pastille en haut à droite passe à **ONLINE**, et le
nom se change en cliquant dessus. **PLAY** entre dans la file du mode et de la table
choisis ; le ticket montre qui attend où, et le salon part dès qu'il est plein.

**Il n'y a plus de partie hors ligne.** Sans serveur, PLAY reste gris et le ticket dit
pourquoi. Et quand quelqu'un attend ailleurs — un 1v1 prêt à partir pendant que vous
chargez une arène seul — le serveur vous le propose au bout de quelques secondes, en
notification : **SWITCH**, ou **KEEP WAITING**. Rien ne bouge sans vous.

**Un seul processus sert la page et la partie**, et ce n'est pas un raccourci : la seconde
machine ouvre une adresse et la WebSocket part vers ce même hôte. Rien à saisir, rien à
faire correspondre. Deux serveurs sur deux ports obligeraient à retrouver une IP deux fois
— et cette friction-là suffit à ce qu'on ne teste pas.

Aucun compte n'est nécessaire pour jouer en ligne : le pseudo suffit. Les comptes servent à
l'argent, pas au jeu.

| `POLITIQUE=` | joueurs | part quand | suggère une autre file après | bots |
|---|---|---|---|---|
| `PRODUCTION` (défaut) | selon le mode : 2 / 4 / 16 | 1v1 à 2, squad à 4, arène à 16 — ou dès 13 après 35 s sans nouvelle arrivée | 20 s | jamais |
| `DEV` | selon le mode : 2 / 4 / 16 | pleins, ou dès 2 (3 avec une mise) après 8 s de calme | 8 s | jamais |
| `DUEL_TEST` | 2, tous modes confondus | à 2 | 5 s | jamais |
| `BANC` | 16 | 1 humain suffit, bots si gratuit | — | si la partie est gratuite |

`DEV` (`npm run dev`) est le réglage sous lequel on **voit** le matchmaking travailler à
deux machines : l'une en arène, l'autre en 1v1, et la première se fait proposer le duel.
Le pot de l'arène s'affiche **en fourchette** (13 à 16 mises), parce que c'est ce qu'elle
peut vraiment payer.

```bash
POLITIQUE=PRODUCTION npm start
```

---

## Trois modes, trois mises, et la roue

Le lobby ouvre **neuf tables** : trois formes de partie × trois mises.

| Mode | Joueurs | Manches | Places payées | Vainqueur |
|---|---|---|---|---|
| **1v1** | 2 | 1 | 1 | ×1,8 |
| **SQUAD 4** | 4 | 2 | 2 | ×1,9 à ×2,6 |
| **ARENA 16** | 16 | 3 | 8 | ×2,9 à ×7,4 |

Mises : **2 / 5 / 10 USDC**. Rake 10 %, toujours.

Le duel et le squad existent d'abord pour le **démarrage à froid** : réunir seize personnes
prêtes à miser la même somme au même instant est difficile le premier jour ; deux, non.
Des parties plus courtes, plus de vainqueurs par minute.

### La roue

En squad et en arène, une roue tire la **forme** du barème avant chaque partie. Le pot ne
change pas — ce que la roue donne au vainqueur, elle le retire au reste du haut de tableau.
En arène, à 2 USDC de mise :

| Variante | Rareté | 1er | 2e | 3e | 4e | 5e–8e |
|---|---|---|---|---|---|---|
| ÉGALITÉ | 4 % | ×2,9 | ×2,7 | ×2,5 | ×2,3 | ×1,0 |
| PARTAGE | 12 % | ×3,4 | ×3,0 | ×2,4 | ×1,6 | ×1,0 |
| STANDARD | 50 % | ×5,0 | ×2,5 | ×1,7 | ×1,2 | ×1,0 |
| COURONNE | 28 % | ×6,4 | ×2,0 | ×1,0 | ×1,0 | ×1,0 |
| ROYALE | 6 % | ×7,4 | ×1,0 | ×1,0 | ×1,0 | ×1,0 |

Trois choses ne bougent jamais : le rake vaut 10 %, la bande 5e–8e récupère sa mise, et
**STANDARD est la table de référence du jeu** — celle d'avant la roue, au dixième près. Le
plafond de ×7,4 n'est pas un réglage : c'est ce qui reste quand les huit remboursés ont
leur mise. Aller plus haut demanderait de payer le deuxième moins que le huitième.

### La roue, à l'écran

Dans le lobby, un aperçu du disque tient dans le ticket. **À la fin d'une partie, et
seulement là**, la vraie roue monte du bas de l'écran — on n'en voit que la calotte haute.
Le joueur la lance lui-même (clic, Espace, ou un vrai geste) et elle s'arrête sur sa place.
Jante blanche, anneau rouge, boulons dorés, un quartier d'or pour le premier : c'est une
roue de foire, et elle n'apparaît nulle part ailleurs dans le jeu.

**Un quartier par place, tous de la même taille** — parce qu'une place vaut exactement `1/n`
de la roue. Seize places en arène, seize quartiers de 22,5°, payés et non payés entrelacés
pour que le disque alterne. La taille d'un quartier EST sa probabilité : c'est ce qui rend
la roue lisible sans mentir. Le seuil de remboursement valant la moitié de l'effectif,
**exactement la moitié du disque paie**, dans les trois modes.

Le gain moyen d'un joueur payé vaut **exactement ×1,8** partout — la moitié des joueurs se
partage 90 % du pot. C'est le rake de 10 %, vu de l'autre côté.

Elle ne tire rien — le barème était connu avant la mise. Elle révèle où le classement vous
a mis, et le montant monte de zéro jusqu'à sa valeur. Ensuite **rien ne se ferme tout
seul** : LOBBY ou REJOUER, c'est le joueur qui décide.

Nulle part le joueur ne voit de `×`. Il mise des USDC et il gagne des USDC ; le
multiplicateur est notre outil de calcul, pas son unité de compte.

**Elle tourne AVANT le départ**, à la création du salon, et s'affiche pendant qu'il se
remplit. Ce n'est pas un choix d'ergonomie : la qualification « compétition de skill »
(spec § 5) repose sur le fait qu'aucune machine ne décide de ce qu'un joueur gagne. Tirée
après la partie, la roue fixerait le montant du prix par le hasard, une fois la mise
engagée. Tirée avant et publiée, c'est un **tournoi à barème connu**, où seul le classement
décide. Le duel, lui, n'a pas de roue du tout : une seule place payée, rien à redistribuer.

Le tirage dérive de la graine du salon : à graine égale, variante égale, dans les trois
implémentations. N'importe qui peut le refaire et vérifier.

---

## Les quatre morceaux

| | |
|---|---|
| [`tools/feel-lab/`](tools/feel-lab/) | **Le jeu.** Three.js + Rapier, cinq épreuves, le lobby, l'économie affichée. C'est aussi lui que le serveur exécute. |
| [`serveur/`](serveur/) | **Le serveur de jeu**, autoritatif. Il arbitre les parties et n'a accès à aucun solde. |
| [`backend/`](backend/) | **L'argent.** Comptes Supabase, grand livre en partie double, dépôts et retraits USDC sur Robinhood Chain (testnet). |
| [`src/Fallguys.Rules/`](src/Fallguys.Rules/) | **Le noyau de règles** en C# : la table des gains, sans Unity ni dépendance. |

Le serveur de jeu **importe les vrais modules du jeu**, pas une réécriture. Une simulation
« serveur » séparée divergerait au premier réglage, et le jour où elle diverge la
prédiction du client cesse de coller sans que rien ne le signale.

La règle du § 6.3 de la spec est tenue : **le serveur de jeu ne connaît aucun solde et ne
déclenche aucun paiement.** Il produit un classement ; `backend/` le convertira en argent.

---

## Vérifier

```bash
dotnet test                                     #  92 tests — modes, roue, table des gains
cd backend            && npm test               #  83 verdicts — grand livre, RLS, retraits, les 3 modes
cd tools/test-harness && npm test               # 182 verdicts — serveur, files, roue, réseau, entrées
cd tools/feel-lab     && node diag/economie.mjs #  45 verdicts — le barème annoncé, sans navigateur
cd tools/feel-lab     && node diag/duel.mjs     #  53 verdicts — DEUX navigateurs, un duel payant
cd tools/feel-lab     && node diag/bascule.mjs #  DEUX navigateurs : présence, suggestion, SWITCH
cd tools/feel-lab     && node diag/partie.mjs   #  le BANC solo (hors produit), trois manches
cd tools/test-harness && node franchissable.mjs # un rapport : chaque carte se termine-t-elle ?
```

Aucun de ces tests ne demande Docker, ni base de données, ni serveur lancé d'avance. Le
backend tourne sur **PGlite** — un vrai Postgres compilé en WebAssembly, dans le processus
Node — donc contraintes différées, `plpgsql` et RLS s'y comportent comme en production.

Les harnais de `tools/feel-lab/diag/` **pilotent réellement le personnage** au lieu de juger
des images, et ne mesurent jamais en images : à ~10 images par seconde en rendu logiciel,
compter des frames mesure la machine et non le jeu.

---

## Avant de toucher de l'argent réel

Le testnet ne vaut rien : on peut y tricher sans conséquence, et c'est très bien. La liste
des conditions à remplir avant le mainnet est en tête de [`backend/README.md`](backend/README.md)
— serveur autoritatif (fait), résultats **signés** (à faire), journal de replay,
géo-restriction, gestion de clé sérieuse, et validation juridique.

Cette dernière n'est pas une question d'ingénierie et aucun code de ce dépôt ne la tranche.
