/**
 * La connexion Postgres de production, et son TLS.
 *
 * Isolee ici parce qu'elle porte une decision de securite qui ne doit pas se decider au
 * detour d'un appel : on VERIFIE le certificat du serveur, contre la CA de Supabase
 * epinglee dans `certs/`.
 *
 * L'alternative repandue est `rejectUnauthorized: false`, qui « marche » et qu'on trouve
 * dans a peu pres tous les exemples. Elle accepte n'importe quel certificat, donc
 * n'importe quel serveur qui se presenterait a la place du bon — et ce qui transite sur
 * cette connexion, ce sont des soldes et des ordres de paiement. Le chemin honnete coute
 * un fichier de 1 ko.
 *
 * `servername` est force : le pooler se presente sous le nom du projet, pas sous celui du
 * point d'entree regional par lequel on l'atteint. Sans cela, la verification echoue sur
 * un nom qui ne correspond pas, et l'on est tente de tout desactiver pour s'en sortir.
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';

const CA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'certs', 'supabase-ca.crt');

export function creerPool() {
  const url = new URL(config.databaseUrl);

  if (!existsSync(CA)) {
    throw new Error(
      `certificat de CA absent (${CA}).\n`
      + `  curl -fsSL https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt \\\n`
      + `    -o backend/certs/supabase-ca.crt`,
    );
  }

  return new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: {
      ca: readFileSync(CA, 'utf8'),
      // Le certificat du pooler porte « *.pooler.supabase.com », mais la connexion
      // traverse un point d'entree regional. On annonce donc explicitement le nom
      // attendu, plutot que de renoncer a verifier.
      servername: url.hostname,
    },
    // Le service est mono-instance et fait peu de requetes concurrentes : une poignee de
    // connexions suffit, et le pooler de Supabase compte les siennes.
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
