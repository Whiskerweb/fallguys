namespace Fallguys.Rules;

/// <summary>Ordre d'arrivée d'une manche, du meilleur au moins bon, parmi les joueurs encore en lice.</summary>
public sealed record RoundOutcome(int RoundIndex, IReadOnlyList<PlayerId> FinishOrder);

/// <summary>
/// Classement cumulé d'une partie. Un joueur éliminé tard se classe devant un joueur
/// éliminé tôt ; à manche d'élimination égale, l'ordre d'arrivée départage.
/// </summary>
public sealed class Standings
{
    private readonly MatchConfiguration _config;
    private readonly List<PlayerId> _active;
    private readonly List<PlayerId> _eliminatedFromBestToWorst = new();
    private int _nextRoundIndex;

    public Standings(MatchConfiguration config, IReadOnlyList<PlayerId> entrants)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(entrants);
        config.Validate();

        if (entrants.Count != config.PlayerCount)
            throw new ArgumentException(
                $"{config.PlayerCount} entrants attendus, {entrants.Count} recus.", nameof(entrants));

        if (entrants.Distinct().Count() != entrants.Count)
            throw new ArgumentException("Les entrants doivent etre distincts.", nameof(entrants));

        _config = config;
        _active = entrants.ToList();
    }

    public IReadOnlyList<PlayerId> Active => _active;

    public bool IsComplete => _nextRoundIndex >= _config.RoundCount;

    public void ApplyRound(RoundOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        if (IsComplete)
            throw new InvalidOperationException("La partie est terminee : aucune manche supplementaire.");

        if (outcome.RoundIndex != _nextRoundIndex)
            throw new ArgumentException(
                $"Manche {_nextRoundIndex} attendue, manche {outcome.RoundIndex} recue.", nameof(outcome));

        if (outcome.FinishOrder.Count != _active.Count)
            throw new ArgumentException(
                $"L'ordre d'arrivee doit couvrir les {_active.Count} joueurs actifs.", nameof(outcome));

        if (outcome.FinishOrder.Distinct().Count() != outcome.FinishOrder.Count)
            throw new ArgumentException("L'ordre d'arrivee contient un doublon.", nameof(outcome));

        foreach (var player in outcome.FinishOrder)
        {
            if (!_active.Contains(player))
                throw new ArgumentException($"Joueur inconnu ou deja elimine : {player}.", nameof(outcome));
        }

        var survivorCount = _config.RoundSurvivors[outcome.RoundIndex];
        var survivors = outcome.FinishOrder.Take(survivorCount).ToList();
        var eliminated = outcome.FinishOrder.Skip(survivorCount).ToList();

        // Les éliminés de cette manche se classent devant ceux des manches précédentes.
        _eliminatedFromBestToWorst.InsertRange(0, eliminated);

        _active.Clear();
        _active.AddRange(survivors);
        _nextRoundIndex++;
    }

    public IReadOnlyList<PlayerId> FinalRanking()
    {
        if (!IsComplete)
            throw new InvalidOperationException(
                $"Partie inachevee : {_nextRoundIndex}/{_config.RoundCount} manches jouees.");

        return _active.Concat(_eliminatedFromBestToWorst).ToList();
    }
}
