/**
 * QUI EST LE JOUEUR — le jeton Supabase, verifie ici, avant qu'un nom n'entre en file.
 *
 * Jusqu'au 2 septembre 2026, l'identite etait DECLAREE : `bonjour` portait un nom, et le
 * serveur le croyait. Tant qu'aucun argent ne suivait le resultat, c'etait sans
 * consequence. Depuis que le serveur de jeu fait engager les mises et regler les gains,
 * ce nom designe un compte qui paie et qui touche : il faut une preuve.
 *
 * La preuve est le jeton de session Supabase, que le client envoie avec `bonjour`. On le
 * presente a Supabase (`/auth/v1/user`), qui detient la cle de signature ; on ne decode
 * JAMAIS le JWT nous-memes — un decodage sans verification se lit « n'importe qui peut se
 * declarer n'importe qui ». Pas de bibliotheque : un appel HTTP suffit.
 *
 * Sans jeton, le joueur est un INVITE : il peut jouer les files gratuites (mise nulle) si
 * la politique les ouvre, jamais une file payante. `politique.js` decide ; ce module ne
 * fait que dire qui est la.
 */

const URL_SUPABASE = process.env.SUPABASE_URL ?? '';
const CLE_ANON = process.env.SUPABASE_ANON_KEY ?? '';

/** `true` quand le serveur peut verifier une identite. Sans cela, tout le monde est invite. */
export const IDENTITE_CONFIGUREE = Boolean(URL_SUPABASE && CLE_ANON);

/**
 * Verifie un jeton. Rend `{ userId, email }` ou `null` — jamais une exception : un jeton
 * pourri n'est pas une panne, c'est un invite.
 *
 * @param {string|null|undefined} jeton
 */
export async function verifierJeton(jeton, { fetchFn = fetch } = {}) {
  if (!IDENTITE_CONFIGUREE || typeof jeton !== 'string' || jeton.length < 20 || jeton.length > 4096) return null;
  try {
    const r = await fetchFn(`${URL_SUPABASE.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: CLE_ANON, authorization: `Bearer ${jeton}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id) return null;
    return { userId: u.id, email: u.email ?? null };
  } catch {
    return null;
  }
}
