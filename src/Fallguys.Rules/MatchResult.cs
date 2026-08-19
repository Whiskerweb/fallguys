namespace Fallguys.Rules;

public enum MatchPhase
{
    Lobby,
    InProgress,
    Settled
}

/// <summary>Gain d'un joueur à son rang final.</summary>
public sealed record PlayerPayout(PlayerId Player, int Rank, Money Amount);

/// <summary>
/// Résultat clos d'une partie. C'est le seul objet que le serveur de jeu transmet
/// au backend de règlement : il ne contient aucun solde et ne déclenche aucun paiement.
/// Le backend vérifie sa signature, puis applique les montants.
/// </summary>
public sealed record MatchResult(
    string MatchId,
    string BuildVersion,
    string ReplayHash,
    StakeContext Stake,
    Money Pot,
    Money Rake,
    IReadOnlyList<PlayerPayout> Payouts);
