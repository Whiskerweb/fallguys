/**
 * Le banc des tests du backend : un Postgres reel, en memoire, monte en une seconde.
 *
 * PGlite est Postgres compile en WebAssembly. Ce n'est pas une imitation : les contraintes
 * differees, `plpgsql`, les roles et RLS s'y comportent comme en production. C'est ce qui
 * permet de VERIFIER l'invariant du grand livre et les politiques d'acces au lieu de les
 * decrire — sans docker, sans serveur, sans etape que personne ne lance.
 *
 * Le schema `auth` est un DOUBLE de celui de Supabase : deux objets, `auth.users` et
 * `auth.uid()`. Les politiques ecrites dans `sql/002_rls.sql` sont, elles, exactement
 * celles qui partiront en production. C'est bien la politique qu'on teste, pas une
 * reecriture pour les besoins du test.
 */

import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { enrober, appliquerSchema } from '../src/base.js';

/** Double du schema d'authentification de Supabase. */
const AUTH = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);

  -- Supabase lit l'identifiant du porteur dans le JWT. Ici on le lit dans un parametre
  -- de session, ce qui permet a un test de « devenir » un joueur donne.
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

/** Monte une base neuve, schema applique. */
export async function banc() {
  const pglite = new PGlite();
  const db = enrober(pglite);
  await db.executer(AUTH);
  await appliquerSchema(db);
  return { db, pglite };
}

/** Cree un joueur : la ligne `auth.users` et son profil. */
export async function joueur(db, pseudo = 'joueur') {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${pseudo}@test`]);
  await db.query(
    `insert into public.profiles (id, pseudo, adresse_depot) values ($1, $2, $3)`,
    [id, pseudo, `DEPOT_${id.slice(0, 8)}`],
  );
  return id;
}

/**
 * Credite un joueur depuis la caisse, sans passer par la chaine.
 *
 * Sert a poser une situation de depart dans les tests qui ne portent pas sur le depot.
 * C'est un vrai mouvement equilibre du livre : meme un raccourci de test ne doit pas
 * pouvoir creer de l'argent, sans quoi l'invariant ne prouverait plus rien.
 */
export async function doter(db, userId, montant) {
  const { poster, compte } = await import('../src/livre.js');
  return db.transaction((tx) => poster(tx, {
    genre: 'depot',
    ref: `test:${userId}:${randomUUID()}`,
    metadata: { test: true },
    lignes: [
      { compte: compte.entree, montant: -montant },
      { compte: compte.joueur(userId), montant: +montant },
    ],
  }));
}

// ---------- verdicts ----------

let total = 0;
let echecs = 0;

export function dit(ok, texte) {
  total++;
  if (!ok) echecs++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`);
}

/** Verifie qu'une operation ECHOUE. Le seul verdict qui compte pour la securite. */
export async function refuse(promesse, texte) {
  try {
    await promesse;
    dit(false, `${texte} — a REUSSI alors qu'il devait echouer`);
  } catch {
    dit(true, texte);
  }
}

export function titre(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

export function bilan() {
  console.log(`\n--- ${echecs === 0 ? `${total} verdicts, aucun ecart` : `${echecs} ECHEC(S) sur ${total}`} ---`);
  return echecs;
}
