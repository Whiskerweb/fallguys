namespace Fallguys.Rules;

/// <summary>
/// Cycle de vie d'une partie : Lobby -> InProgress -> Settled.
/// Toute transition illégale lève une exception plutôt que de produire un état incohérent :
/// une partie qui manipule de l'argent ne doit jamais avancer par accident.
/// </summary>
public sealed class MatchStateMachine
{
    private readonly string _matchId;
    private readonly MatchConfiguration _config;
    private readonly StakeContext _stake;
    private Standings? _standings;

    public MatchStateMachine(string matchId, MatchConfiguration config, StakeContext stake)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(matchId);
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(stake);
        config.Validate();

        _matchId = matchId;
        _config = config;
        _stake = stake;
        Phase = MatchPhase.Lobby;
    }

    public MatchPhase Phase { get; private set; }

    public void Start(IReadOnlyList<PlayerId> entrants)
    {
        if (Phase != MatchPhase.Lobby)
            throw new InvalidOperationException($"Start impossible depuis la phase {Phase}.");

        _standings = new Standings(_config, entrants);
        Phase = MatchPhase.InProgress;
    }

    public void ApplyRound(RoundOutcome outcome)
    {
        if (Phase != MatchPhase.InProgress || _standings is null)
            throw new InvalidOperationException($"ApplyRound impossible depuis la phase {Phase}.");

        _standings.ApplyRound(outcome);
    }

    public MatchResult Settle(string buildVersion, string replayHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(buildVersion);
        ArgumentException.ThrowIfNullOrWhiteSpace(replayHash);

        if (Phase != MatchPhase.InProgress || _standings is null)
            throw new InvalidOperationException($"Settle impossible depuis la phase {Phase}.");

        if (!_standings.IsComplete)
            throw new InvalidOperationException("Settle impossible : toutes les manches n'ont pas ete jouees.");

        var table = PayoutPolicy.Compute(_config, _stake);
        var ranking = _standings.FinalRanking();

        var payouts = ranking
            .Select((player, index) => new PlayerPayout(player, index + 1, table.ForRank(index + 1)))
            .ToList();

        Phase = MatchPhase.Settled;

        return new MatchResult(
            _matchId,
            buildVersion,
            replayHash,
            _stake,
            table.Pot,
            table.Rake,
            payouts);
    }
}
