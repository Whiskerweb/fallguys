using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class MoneyTests
{
    [Fact]
    public void FromUnits_convertit_en_micro_unites()
    {
        Assert.Equal(1_000_000L, Money.FromUnits(1m).Micros);
        Assert.Equal(250_000L, Money.FromUnits(0.25m).Micros);
        Assert.Equal(1_100_000L, Money.FromUnits(1.10m).Micros);
    }

    [Fact]
    public void Addition_et_soustraction_restent_exactes()
    {
        var a = Money.FromUnits(4.50m);
        var b = Money.FromUnits(2.50m);
        Assert.Equal(Money.FromUnits(7.00m), a + b);
        Assert.Equal(Money.FromUnits(2.00m), a - b);
    }

    [Fact]
    public void Multiplication_par_un_entier_est_exacte()
    {
        Assert.Equal(Money.FromUnits(16m), Money.FromUnits(1m) * 16);
    }

    [Fact]
    public void MultiplyByBasisPoints_tronque_vers_le_bas()
    {
        Assert.Equal(Money.FromUnits(2.40m), Money.FromUnits(16m).MultiplyByBasisPoints(1500));
        Assert.Equal(Money.Zero, new Money(1).MultiplyByBasisPoints(1500));
    }

    [Fact]
    public void Zero_est_neutre_et_comparable()
    {
        Assert.Equal(Money.Zero, Money.FromUnits(0m));
        Assert.True(Money.FromUnits(1m) > Money.Zero);
    }
}
