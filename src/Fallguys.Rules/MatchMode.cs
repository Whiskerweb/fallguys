namespace Fallguys.Rules;

/// <summary>
/// Les formes de partie ouvertes au public : 1v1, 4 joueurs, 16 joueurs.
///
/// UN MODE EST DÉCLARÉ, JAMAIS DÉRIVÉ D'UN EFFECTIF. C'est la différence avec
/// <see cref="MatchConfiguration.ForPlayers"/>, qui calcule une pyramide pour un salon de
/// seize qui part à douze. Les deux coexistent et ne servent pas à la même chose :
///
///   • un MODE  — le joueur l'a choisi dans le lobby, sa forme est posée à la main ici ;
///   • un SALON RÉDUIT — personne ne l'a choisi, sa forme est calculée par moitiés.
///
/// Les mélanger coûterait cher : l'échelle de 3 à 24 joueurs de `ForPlayers` est comparée
/// rang par rang, à chaque exécution des tests, contre `backend/src/gains.js` et
/// `tools/feel-lab/src/economie.js`. Y faire entrer trois formes choisies à la main
/// déplacerait 66 tables que trois implémentations tiennent verrouillées.
///
/// Le démarrage à froid — risque n°1 du spec — est la raison d'être du duel et du squad :
/// remplir seize places demande seize personnes vivantes prêtes à miser le même montant au
/// même instant, et au premier jour il n'y en a aucune. Deux, on les trouve.
/// </summary>
public sealed record MatchMode(string Id, string Nom, MatchConfiguration Config)
{
    /// <summary>
    /// Le duel. Une manche, un vainqueur, ×1,8 — le reste est le rake.
    ///
    /// Le seul survivant de la manche 1 récupère sa mise puis prend tout le bonus :
    /// <see cref="PayoutPolicy"/> n'a pas besoin d'une ligne de plus pour le payer, la
    /// règle « passe la manche 1, tu récupères ta mise » y dégénère correctement.
    ///
    /// C'est aussi le mode le plus propre juridiquement : une seule place payée, donc rien
    /// à faire tourner sur la roue, donc un barème entièrement fixe et affiché d'avance.
    /// </summary>
    public static MatchMode Duel { get; } =
        new("duel", "1v1", new MatchConfiguration(2, new[] { 1 }, 1000, new[] { 1 }));

    /// <summary>
    /// Quatre joueurs, deux manches, deux places payées. La demi-finale du format long,
    /// jouée seule : assez court pour enchaîner, assez peuplé pour que les collisions
    /// comptent.
    /// </summary>
    public static MatchMode Squad { get; } =
        new("squad", "SQUAD 4", new MatchConfiguration(4, new[] { 2, 1 }, 1000, new[] { 40, 15, 7, 2 }));

    /// <summary>
    /// Le format de référence du spec : seize joueurs, trois manches, huit remboursés.
    /// Sa configuration EST <see cref="MatchConfiguration.Default"/> — pas une copie, la
    /// même instance, pour qu'aucun réglage ne puisse s'appliquer à l'une sans l'autre.
    /// </summary>
    public static MatchMode Arena { get; } =
        new("arena", "ARENA 16", MatchConfiguration.Default);

    /// <summary>
    /// Dans cet ordre, et l'ordre compte : c'est celui du sélecteur de mode du lobby, du
    /// plus court au plus long.
    /// </summary>
    public static IReadOnlyList<MatchMode> All { get; } = new[] { Duel, Squad, Arena };

    public int PlayerCount => Config.PlayerCount;

    public int RoundCount => Config.RoundCount;

    /// <summary>Retrouve un mode par son identifiant, et refuse clairement l'inconnu.</summary>
    public static MatchMode ById(string id)
    {
        var mode = All.FirstOrDefault(m => m.Id == id);
        if (mode is null)
            throw new ArgumentException(
                $"mode inconnu « {id} » — attendu : {string.Join(", ", All.Select(m => m.Id))}");
        return mode;
    }

    /// <summary>
    /// Les mises ouvertes, en unités USDC. Doublé à l'identique dans les deux ports
    /// JavaScript (`PALIERS`), et vérifié par le service qui paie avant tout débit.
    /// </summary>
    public static IReadOnlyList<decimal> StakeTiers { get; } = new[] { 2m, 5m, 10m };
}
