/**
 * Acces a Postgres, et la transaction.
 *
 * Deux sources possibles derriere la meme interface : le Postgres de Supabase en
 * fonctionnement normal, et PGlite — un Postgres complet compile en WebAssembly, qui
 * tourne DANS le processus Node — pour les tests.
 *
 * Ce n'est pas une commodite de confort. Sans PGlite, verifier l'invariant du grand livre
 * ou les politiques RLS demanderait un serveur, donc un docker, donc une etape que
 * personne ne lance et un test qui ne tourne jamais. Avec, `npm test` execute le vrai
 * moteur Postgres — memes contraintes differees, meme `plpgsql`, meme RLS — sans rien
 * installer. Un test qui tourne partout est un test qui tourne.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SQL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/**
 * Enveloppe une source Postgres.
 *
 * @param {object} source pool `pg` ou instance PGlite
 * @returns {{query: Function, transaction: Function, fermer: Function}}
 */
export function enrober(source) {
  // PGlite expose `.transaction()` ; `pg` expose `.connect()`. On distingue la-dessus.
  const estPglite = typeof source.transaction === 'function' && typeof source.connect !== 'function';

  return {
    query: (sql, params) => source.query(sql, params),

    /*
     * Executer un SCRIPT — plusieurs instructions d'un coup.
     *
     * `query()` passe par le protocole etendu, qui n'accepte qu'une seule commande par
     * appel : lui donner un fichier de schema echoue sur « cannot insert multiple
     * commands into a prepared statement ». PGlite expose `exec()` pour cela ; `pg`
     * accepte plusieurs commandes dans `query()` des lors qu'on ne passe pas de
     * parametres. D'ou ces deux chemins, qui n'ont rien d'arbitraire.
     */
    executer: (sql) => (estPglite ? source.exec(sql) : source.query(sql)),

    /**
     * Execute `travail` dans UNE transaction, et la defait entierement en cas d'erreur.
     *
     * Tout ce qui touche a l'argent passe par ici. La contrainte d'equilibre du livre est
     * differee au commit : ecrire hors transaction ferait echouer la premiere ligne d'un
     * mouvement, qui est forcement desequilibree tant que sa contrepartie n'est pas posee.
     */
    async transaction(travail) {
      if (estPglite) {
        return source.transaction((tx) => travail({ query: (sql, params) => tx.query(sql, params) }));
      }
      const client = await source.connect();
      try {
        await client.query('begin');
        const resultat = await travail({ query: (sql, params) => client.query(sql, params) });
        await client.query('commit');
        return resultat;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },

    fermer: () => (source.end ? source.end() : source.close?.()),
  };
}

/**
 * Applique les fichiers de `sql/` dans l'ordre de leur numero.
 *
 * Numerotes et joues en entier a chaque fois : le schema est encore assez petit pour que
 * ce soit honnete, et les instructions sont ecrites en `if not exists` / `create or
 * replace`. Le jour ou il faudra de vraies migrations differentielles, ce sera un travail
 * a part — pas une couche a improviser maintenant.
 */
export async function appliquerSchema(db) {
  const fichiers = readdirSync(SQL).filter((f) => f.endsWith('.sql')).sort();
  for (const f of fichiers) {
    await db.executer(readFileSync(path.join(SQL, f), 'utf8'));
  }
  return fichiers;
}
