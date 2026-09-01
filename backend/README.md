# Le backend — comptes, grand livre, USDC

> **Ce service est en devnet. Il ne doit pas toucher de mainnet.**
> La liste des conditions à remplir avant d'y penser est en bas de page, et elle n'est pas
> facultative.

Le jeu ne connaît aucun solde et ne déclenche aucun paiement. Il produit un résultat de
partie ; ce service le convertit en mouvements comptables et, seul, parle à Solana.

---

## Ce qu'il fait

| | |
|---|---|
| **Comptes** | Supabase Auth, **e-mail et mot de passe** ; plus un wallet Solana **lié par signature** |
| **Dépôts** | une adresse Solana dédiée par joueur, dérivée ; un guetteur crédite et balaie |
| **Retraits** | vers le wallet lié **uniquement** ; minimum 25 USDC, 24 h avant le premier |
| **Parties** | mise engagée au lancement, gain versé au rang atteint, rake 10 % |
| **Trésorerie** | le rake s'accumule sur `treasury:rake`. Le rachat-et-brûlage n'est **pas** implémenté |

---

## Démarrer

```bash
set -a && source ../.env && set +a     # les secrets vivent dans le .env de la racine
cd backend && npm install
APPLIQUER_SCHEMA=1 npm start           # la première fois seulement
npm start
```

```bash
npm test        # 47 verdicts, aucun réseau, aucune installation
```

**Deux réglages à faire une fois dans le dashboard Supabase**, et le second n'est pas
optionnel pour un prototype :

1. **Connection string.** `db.<ref>.supabase.co` n'a qu'une adresse **IPv6** ; une machine
   sans route IPv6 échoue sur un `ENOTFOUND` qui ne dit pas pourquoi. Passez par le
   *pooler* (Settings → Database → Connection pooling), dont le nom porte la région, avec
   l'utilisateur `postgres.<ref>`. **Encodez le mot de passe** : un `@` ou un `#` non
   encodé change l'hôte que l'URL désigne.
2. **Confirm email.** Activé par défaut (Authentication → Providers → Email). Tant qu'il
   l'est, un compte créé n'a pas de session avant que le lien reçu soit cliqué — et le SMTP
   gratuit est limité à quelques envois par heure, après quoi l'inscription renvoie
   `email rate limit exceeded`. Décochez-le : l'inscription devient immédiate et n'envoie
   plus rien.

**TLS.** Le pooler présente un certificat auto-signé. `src/pool.js` **vérifie** la chaîne
contre la CA de Supabase, épinglée dans `certs/`. La réponse répandue —
`rejectUnauthorized: false` — accepte n'importe quel serveur se présentant à la place du
bon, sur une connexion qui transporte des soldes et des ordres de paiement. Le chemin
honnête coûte un fichier de 1 ko.

Les tests tournent sur **PGlite** — Postgres compilé en WebAssembly, dans le processus
Node. Ce n'est pas une imitation : contraintes différées, `plpgsql`, rôles et RLS s'y
comportent comme en production. C'est ce qui permet de *vérifier* l'invariant du grand
livre et les politiques d'accès au lieu de les décrire, sans docker et sans serveur.

---

## Le grand livre

Écriture **en partie double**. Chaque mouvement pose au moins deux lignes de signe opposé
dont la somme vaut zéro. L'invariant du système tient donc en une requête, et n'importe
qui peut la lancer sans rien connaître du code :

```sql
select sum(amount_micros) from public.ledger_entries;   -- doit valoir 0
```

Un solde n'est jamais une colonne qu'on incrémente : c'est la **somme** des lignes d'un
compte. Un solde stocké finit toujours par diverger de son historique ; une somme ne le
peut pas.

Comptes : `user:<uuid>` · `pot:<match>` · `treasury:rake` · `treasury:hot` · `chain:in` ·
`chain:out`.

Tout est en **micro-unités entières** (1 USDC = 1 000 000), en `bigint`. Jamais de
flottant — même type et même échelle que `Money.Micros` dans `src/Fallguys.Rules`, pour
qu'aucune conversion n'intervienne entre le calcul du gain et son paiement.

**L'équilibre est tenu par la base, pas par le code appelant** : une contrainte différée
le vérifie au commit. Le jour où quelqu'un écrit par un autre chemin — une migration, un
script de reprise, une console `psql` à trois heures du matin — la règle tient encore.

---

## Ce qui protège la caisse

**RLS est la seule barrière, et c'est voulu.** Le navigateur reçoit la clé `anon`, qui est
publique : elle est dans le bundle JavaScript. Les deux tables du grand livre ont donc RLS
activé **et aucune politique** — personne ne passe, ni en lecture ni en écriture. Le joueur
lit son solde par `public.mon_solde()`, une fonction `security definer` **sans paramètre**
qui filtre sur `auth.uid()` : il n'y a littéralement pas de moyen de demander le solde d'un
autre.

**Le retrait ne prend pas de destination.** Elle est toujours le wallet lié. Un compte volé
ne peut pas rediriger les fonds parce qu'il n'y a aucun paramètre à détourner. Relier un
wallet remet le délai de 24 h à zéro : un attaquant qui relie sa propre adresse doit
attendre un jour, le temps que le propriétaire s'en aperçoive.

**L'idempotence est une contrainte de base, pas une précaution.** Un dépôt est clé par sa
signature Solana, une partie par son identifiant. Le guetteur *rejoue* — il redémarre, relit
des blocs déjà vus : c'est son fonctionnement normal, pas un cas limite.

**Les retraits, trois règles dans l'ordre où elles comptent :**

1. **On débite avant d'envoyer.** L'inverse laisserait, après un arrêt, un joueur payé *et*
   crédité. Dans ce sens, un arrêt immobilise l'argent sans jamais le perdre.
2. **On enregistre la signature avant de diffuser.** Sur Solana elle est connue dès la
   signature. Sans cette trace, un arrêt laisse une transaction peut-être partie dont on ne
   connaît pas le nom.
3. **On ne re-signe jamais sans avoir relu la chaîne** — et pas seulement « est-elle
   confirmée ? ». Tant que son blockhash est valide elle peut encore l'être, et une seconde
   transaction paierait deux fois. Seul un blockhash **expiré** autorise à recommencer.

---

## Hébergement

| Étage | Où |
|---|---|
| Client (`tools/feel-lab`, `vite build`) | Cloudflare Pages ou Vercel — statique |
| Base + Auth | Supabase managé |
| Ce service | Fly.io, **un seul conteneur** |
| RPC Solana | Helius ou QuickNode — le RPC public limite et perd des transactions |

**Une seule instance.** Deux guetteurs qui balaient la même adresse produisent deux
transactions concurrentes ; deux signataires peuvent envoyer deux fois le même retrait.
C'est le scénario dont on ne se relève pas. Ne pas mettre ce service derrière un
autoscaler.

---

## Ce qui n'est pas fait

**Le rachat-et-brûlage.** Le token n'existe pas. Les 10 % s'accumulent sur `treasury:rake`
et **rien ne s'exécute**. Le grand livre chiffre la dette à l'unité près depuis la première
partie : le jour où le token existe, le montant à racheter est connu sans reconstitution.
Câbler un swap sur un mint inexistant produirait du code que personne ne peut essayer.

**Le serveur de jeu autoritatif.** Voir ci-dessous.

**KYC et géo-restriction.** Conditions du mainnet, chacune un chantier à part.

**Une conséquence économique du mode solo, à connaître.** La table des gains suppose seize
joueurs. En solo, le pot ne contient qu'une mise, et un joueur qui gagne touche pourtant
5,00 USDC pour 1,00 engagé : la différence sort de `treasury:hot`, qui devient négatif.
Ce n'est pas un bug — c'est la traduction comptable exacte du fait qu'une partie sans
adversaires n'est pas une partie. Sur devnet c'est gratuit. En mainnet, ce serait la maison
qui paie, et c'est une raison de plus pour laquelle le multijoueur précède l'argent réel.

---

## Le verrou avant le mainnet

Le devnet ne vaut rien : on peut y tricher sans conséquence, et c'est très bien. Rien de ce
qui suit n'est optionnel avant de toucher un dollar réel.

1. **Serveur de jeu autoritatif.** Aujourd'hui le navigateur exécute la physique et
   *déclare* son rang à `POST /partie/regler`. `window.__probeGame()` est exposé pour les
   harnais de diagnostic : n'importe qui l'appelle depuis la console et se déclare
   vainqueur. Tant que c'est vrai, l'argent est en libre-service.
2. **Résultats de partie signés** par le serveur de jeu, et vérifiés ici avant tout
   versement.
3. **Journal de replay archivé** (spec § 6.4). Sans lui, aucun litige n'est arbitrable.
4. **Géo-restriction effective**, France exclue (spec § 5).
5. **Gestion de clé sérieuse** pour `CAISSE_CLE` — KMS ou signataire matériel. Pas une
   variable d'environnement sur un conteneur.
6. **Validation juridique.** La spec elle-même la pose en risque ouvert n° 2. Un jeu de
   compétence à mises est légal dans certaines juridictions et interdit dans d'autres.
   Ce n'est pas une question d'ingénierie et aucun code de ce dossier ne la tranche.
