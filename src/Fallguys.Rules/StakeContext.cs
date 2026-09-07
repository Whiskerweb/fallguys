namespace Fallguys.Rules;

public enum StakeTier
{
    Free,
    Micro,
    High
}

/// <summary>
/// Contexte de mise d'une partie. Le mode gratuit emprunte le même chemin de code
/// que le mode payant, avec une mise nulle.
/// </summary>
public sealed record StakeContext(StakeTier Tier, Money EntryFee, string Currency)
{
    public static StakeContext Free { get; } = new(StakeTier.Free, Money.Zero, "NONE");

    public static StakeContext Usdg(StakeTier tier, decimal units) =>
        new(tier, Money.FromUnits(units), "USDG");
}
