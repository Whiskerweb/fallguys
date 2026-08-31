# Clips d'animation greffés

Ce dossier ne contient pas des personnages : ce sont des **porteurs d'animation**.

Un fichier par personnage — `idle-babytrump`, `idle-techtitan`, `idle-grenouille`,
`idle-diplomate`, `idle-captainleeky` — parce que chacun a reçu sa propre attente. Un clip
unique partagé par les cinq avait été monté d'abord ; il marchait, mais cinq personnages
qui attendent exactement pareil se lisent comme cinq instances du même acteur, et la
vitrine est précisément l'endroit où on les compare.

Chacun est livré avec un maillage complet et sa texture, 5 à 6 Mo dont rien ne sert :
`fusion-anims.mjs` ne lit que la liste des nœuds, pour vérifier que les squelettes
concordent, et les données d'animation. Les fichiers ont donc été réduits à ces deux
choses — 131 Ko, maillage, peau et matériaux retirés. La greffe produit un GLB **identique
octet pour octet** à celle faite depuis le fichier d'origine.

Voir « Greffer l'animation d'attente » dans `tools/feel-lab/README.md`.
