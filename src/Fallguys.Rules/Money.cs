namespace Fallguys.Rules;

/// <summary>
/// Montant monétaire en micro-unités entières (1 unité = 1 000 000 micros).
/// Jamais de flottant : tout calcul d'argent doit rester exact et reproductible
/// entre le serveur de jeu et le backend de règlement.
/// </summary>
public readonly record struct Money(long Micros) : IComparable<Money>
{
    public const long MicrosPerUnit = 1_000_000L;

    public static Money Zero => new(0L);

    public static Money FromUnits(decimal units) => new((long)(units * MicrosPerUnit));

    public decimal ToUnits() => (decimal)Micros / MicrosPerUnit;

    /// <summary>Applique un pourcentage exprimé en points de base (1500 = 15 %), tronqué vers le bas.</summary>
    public Money MultiplyByBasisPoints(int basisPoints)
    {
        if (basisPoints < 0) throw new ArgumentOutOfRangeException(nameof(basisPoints));
        return new Money(Micros * basisPoints / 10_000L);
    }

    public static Money operator +(Money a, Money b) => new(a.Micros + b.Micros);
    public static Money operator -(Money a, Money b) => new(a.Micros - b.Micros);
    public static Money operator *(Money a, int factor) => new(a.Micros * factor);

    public static bool operator <(Money a, Money b) => a.Micros < b.Micros;
    public static bool operator >(Money a, Money b) => a.Micros > b.Micros;
    public static bool operator <=(Money a, Money b) => a.Micros <= b.Micros;
    public static bool operator >=(Money a, Money b) => a.Micros >= b.Micros;

    public int CompareTo(Money other) => Micros.CompareTo(other.Micros);

    public override string ToString() => ToUnits().ToString("0.######");
}
