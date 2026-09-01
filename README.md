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

Ouvrez la première sur une machine, la seconde sur l'autre. Bouton **ONLINE** en haut à
droite, un pseudo, `FIND A MATCH`. Le salon part dès qu'il est plein.

**Un seul processus sert la page et la partie**, et ce n'est pas un raccourci : la seconde
machine ouvre une adresse et la WebSocket part vers ce même hôte. Rien à saisir, rien à
faire correspondre. Deux serveurs sur deux ports obligeraient à retrouver une IP deux fois
— et cette friction-là suffit à ce qu'on ne teste pas.

Aucun compte n'est nécessaire pour jouer en ligne : le pseudo suffit. Les comptes servent à
l'argent, pas au jeu.

| `POLITIQUE=` | joueurs | minimum | bots |
|---|---|---|---|
| `DUEL_TEST` (défaut) | 2 | 2 | jamais |
| `PRODUCTION` | 16 | 10 | jamais |
| `BANC` | 16 | 1 | si la partie est gratuite |

```bash
POLITIQUE=PRODUCTION npm start
```

---

## Les quatre morceaux

| | |
|---|---|
| [`tools/feel-lab/`](tools/feel-lab/) | **Le jeu.** Three.js + Rapier, cinq épreuves, le lobby, l'économie affichée. C'est aussi lui que le serveur exécute. |
| [`serveur/`](serveur/) | **Le serveur de jeu**, autoritatif. Il arbitre les parties et n'a accès à aucun solde. |
| [`backend/`](backend/) | **L'argent.** Comptes Supabase, grand livre en partie double, dépôts et retraits USDC sur devnet. |
| [`src/Fallguys.Rules/`](src/Fallguys.Rules/) | **Le noyau de règles** en C# : la table des gains, sans Unity ni dépendance. |

Le serveur de jeu **importe les vrais modules du jeu**, pas une réécriture. Une simulation
« serveur » séparée divergerait au premier réglage, et le jour où elle diverge la
prédiction du client cesse de coller sans que rien ne le signale.

La règle du § 6.3 de la spec est tenue : **le serveur de jeu ne connaît aucun solde et ne
déclenche aucun paiement.** Il produit un classement ; `backend/` le convertira en argent.

---

## Vérifier

```bash
dotnet test                                   #  58 tests — la table des gains
cd backend         && npm test                #  50 verdicts — grand livre, RLS, retraits
cd tools/test-harness && npm test             # 111 verdicts — serveur, réseau, prédiction
cd tools/feel-lab  && node diag/duel.mjs      #  14 verdicts — DEUX navigateurs, une partie
cd tools/feel-lab  && node diag/partie.mjs    #  le solo, inchangé
```

Aucun de ces tests ne demande Docker, ni base de données, ni serveur lancé d'avance. Le
backend tourne sur **PGlite** — un vrai Postgres compilé en WebAssembly, dans le processus
Node — donc contraintes différées, `plpgsql` et RLS s'y comportent comme en production.

Les harnais de `tools/feel-lab/diag/` **pilotent réellement le personnage** au lieu de juger
des images, et ne mesurent jamais en images : à ~10 images par seconde en rendu logiciel,
compter des frames mesure la machine et non le jeu.

---

## Avant de toucher de l'argent réel

Le devnet ne vaut rien : on peut y tricher sans conséquence, et c'est très bien. La liste
des conditions à remplir avant le mainnet est en tête de [`backend/README.md`](backend/README.md)
— serveur autoritatif (fait), résultats **signés** (à faire), journal de replay,
géo-restriction, gestion de clé sérieuse, et validation juridique.

Cette dernière n'est pas une question d'ingénierie et aucun code de ce dépôt ne la tranche.
