/**
 * Charge le `.env` de la racine du dépôt dans `process.env` — sans rien écraser.
 *
 * Le serveur de jeu a besoin de quatre réglages pour parler d'argent (`BACKEND_URL`,
 * `SERVEUR_CLE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`), et ils vivent dans le même fichier
 * que ceux du backend. Demander à l'opérateur de faire `set -a && source .env` avant
 * chaque `npm start` est le genre d'étape qu'on oublie une fois sur deux — et cette fois-là,
 * le serveur démarre sans pont et ferme les files payantes sans dire pourquoi.
 *
 * Une variable déjà posée dans l'environnement gagne : le fichier n'est qu'un repli.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

/** Les variables qui viennent du FICHIER, et non de l'environnement réel. */
export const depuisFichier = new Set();

export function chargerEnv(fichier = ENV) {
  if (!existsSync(fichier)) return 0;
  let n = 0;
  for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne);
    if (!m || m[1] in process.env) continue;
    const brut = m[2];
    process.env[m[1]] = /^(["']).*\1$/.test(brut) ? brut.slice(1, -1) : brut;
    depuisFichier.add(m[1]);
    n++;
  }
  return n;
}

chargerEnv();
