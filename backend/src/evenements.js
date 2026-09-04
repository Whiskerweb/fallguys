/**
 * Le bus d'evenements du service — ce que la page de suivi ecoute EN DIRECT.
 *
 * Une transaction confirmee, un depot vu, un rachat brule, une partie reglee : chacun
 * passe par `publier()`, et chaque navigateur ouvert sur `/stats/flux` le recoit dans la
 * seconde (SSE). Rien n'est memorise ici : un evenement manque se relit dans `/stats`,
 * qui est la verite ; le flux n'est qu'un signal de « va relire ».
 */

const auditeurs = new Set();

export function publier(type, data = {}) {
  const evenement = { type, ...data, a: new Date().toISOString() };
  for (const fn of auditeurs) {
    try { fn(evenement); } catch { /* un auditeur mort ne bloque pas les autres */ }
  }
  return evenement;
}

export function souscrire(fn) {
  auditeurs.add(fn);
  return () => auditeurs.delete(fn);
}

export const nombreAuditeurs = () => auditeurs.size;
