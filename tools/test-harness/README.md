# Le banc du serveur de jeu

La spec range ce dossier en **« priorité n°1, livrable de première semaine »** (§ 6.6), et
pour une raison simple : *personne ne peut tester un lobby de seize à la main*. Sans
harnais, un jeu multijoueur est indéveloppable en solo.

Aucun navigateur, aucun réseau, aucune installation : la simulation entière tourne dans le
processus Node. Une partie complète de seize joueurs coûte une quinzaine de secondes de
calcul.

```bash
node verdicts.mjs      # 74 verdicts · ~58 s
node partie.mjs        # une partie, manche par manche
node partie.mjs 777 8  # graine 777, salon de 8
```

## Ce que `verdicts.mjs` prouve

| | |
|---|---|
| **1** | **Aucun bot dans une partie payante.** Le seul verdict dont l'échec interdirait de livrer : c'est une règle juridique avant d'être une règle de jeu. |
| **2** | L'attente et le **départ à effectif réduit** : douze ne partent jamais, treize partent après 35 s sans nouvelle arrivée (une arrivée remet le calme à zéro), seize partent tout de suite, le squad et le 1v1 ne partent que pleins, et **sous le minimum rien n'est annoncé**. |
| **3** | Le serveur joue les cinq cartes avec le code du client : 16 personnages posés, aucun NaN. |
| **4** | **Déterminisme** : même graine, même classement, sur les cinq cartes. Sans lui, aucun replay ne reproduit rien. |
| **5** | Une manche pourvoit toujours ses places, même quand personne ne finit. |
| **6** | Une partie complète produit un classement valide : chacun une fois, rangs 1 à N. |
| **7** | Les petits effectifs se jouent vraiment : un duel en une finale, quatre joueurs en demie + finale, **sans un seul bot**. |
| 8 | Les niveaux de bot — **mesuré et affiché, pas asserté**. Voir ci-dessous. |

## Pourquoi le point 7 n'est pas un verdict

L'ordre `fort > moyen > faible` ne tient pas encore sur les cinq cartes. Poser une
assertion qui échoue quatre fois sur cinq n'apprendrait rien à personne et finirait par
être ignorée ; poser une assertion molle — « l'ordre tient au moins une fois » — serait
pire, parce qu'elle donnerait l'illusion d'une garantie.

On mesure donc, on affiche, et le chiffre dit où en est le pilote. Le jour où l'ordre
tiendra partout, ce bloc deviendra un verdict.

## Ce qui manque encore

Le nom du dossier promet « 1 serveur + 15 clients headless ». Pour l'instant, les quinze
clients sont dans le même processus et il n'y a pas de réseau : c'est la phase 2. Le
harnais y gagnera la latence et la perte de paquets simulées, qui sont la moitié de son
intérêt.
