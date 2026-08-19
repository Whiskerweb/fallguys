# Noyau de règles de partie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le noyau de règles de partie (structure de manches, élimination, classement, calcul des payouts et du rake) en C# pur, sans aucune dépendance à Unity, entièrement couvert par des tests unitaires.

**Architecture:** Assembly `Game.Rules` du spec — la seule couche qui ne référence rien. Elle sera consommée telle quelle par le serveur Unity (`Game.Simulation`) et par le backend de paiement, ce qui garantit qu'un payout calculé en jeu et un payout calculé au règlement sont produits par le même code. Tout l'argent est manipulé en entiers (micro-unités), jamais en flottants.

**Tech Stack:** .NET 9 (SDK installé en user-space dans `~/.dotnet`), C# 13, xUnit. Aucune dépendance externe au-delà du framework de test.

**Spec:** `docs/superpowers/specs/2026-08-19-party-game-mises-reelles-design.md`

## Global Constraints

- **Aucune référence à UnityEngine** dans `Game.Rules`. Le projet doit compiler avec un simple `dotnet build`, hors de tout moteur.
- **Aucun flottant pour l'argent.** Tous les montants sont des `long` en micro-unités (1 USDC = 1 000 000 micros). Un `double` ou `float` dans un calcul de payout est un défaut bloquant.
- **Invariant monétaire absolu :** `somme(payouts) + rake == pot`, exactement, pour toute configuration. Aucune unité ne peut être créée ni perdue par un arrondi.
- **Structure de partie de référence :** 16 joueurs, survivants par manche `[8, 4, 1]`, rake 1500 points de base (15 %), poids de bonus finalistes `[35, 15, 5, 1]`.
- **Le mode gratuit emprunte le même chemin de code** que le mode payant, avec une mise à zéro.
- **Généricité obligatoire :** la même configuration doit fonctionner à 12 et 24 joueurs sans changement de code (tout est exprimé en nombres de survivants, pas en constantes).
- Namespace racine : `Fallguys.Rules`. Framework cible : `net9.0`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `Fallguys.sln` | Solution regroupant le noyau et ses tests |
| `src/Fallguys.Rules/Fallguys.Rules.csproj` | Projet bibliothèque, `net9.0`, aucune dépendance |
| `src/Fallguys.Rules/Money.cs` | Montant entier en micro-unités, arithmétique sûre |
| `src/Fallguys.Rules/PlayerId.cs` | Identifiant joueur stable |
| `src/Fallguys.Rules/StakeContext.cs` | Palier de mise, montant d'entrée, devise |
| `src/Fallguys.Rules/MatchConfiguration.cs` | Forme de la partie + validation des invariants |
| `src/Fallguys.Rules/PayoutTable.cs` | Résultat du calcul : pot, rake, gain par rang |
| `src/Fallguys.Rules/PayoutPolicy.cs` | Calcul des payouts gradués |
| `src/Fallguys.Rules/Standings.cs` | Classement cumulé au fil des manches |
| `src/Fallguys.Rules/MatchStateMachine.cs` | Cycle de vie d'une partie et transitions légales |
| `tests/Fallguys.Rules.Tests/*.cs` | Un fichier de tests par unité ci-dessus |

---

### Task 1: Solution, projets et type Money

**Files:**
- Create: `Fallguys.sln`
- Create: `src/Fallguys.Rules/Fallguys.Rules.csproj`
- Create: `src/Fallguys.Rules/Money.cs`
- Test: `tests/Fallguys.Rules.Tests/MoneyTests.cs`

**Interfaces:**
- Consumes: rien.
- Produces: `readonly record struct Money(long Micros)` avec `Money.Zero`, `Money.FromUnits(decimal)`, `ToUnits()`, opérateurs `+`, `-`, `*` (par `int`), `MultiplyByBasisPoints(int)`, et `IComparable<Money>`.

- [x] **Step 1: Créer la solution et les projets**

```bash
cd "/Users/lucasroncey/Desktop/Projets/Projet Saas/Avance/Fallguys"
export PATH="$HOME/.dotnet:$PATH"
dotnet new sln -n Fallguys
dotnet new classlib -n Fallguys.Rules -o src/Fallguys.Rules -f net9.0
dotnet new xunit -n Fallguys.Rules.Tests -o tests/Fallguys.Rules.Tests -f net9.0
rm -f src/Fallguys.Rules/Class1.cs tests/Fallguys.Rules.Tests/UnitTest1.cs
dotnet sln add src/Fallguys.Rules/Fallguys.Rules.csproj tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
dotnet add tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj reference src/Fallguys.Rules/Fallguys.Rules.csproj
```

- [x] **Step 2: Écrire le test qui échoue**

Créer `tests/Fallguys.Rules.Tests/MoneyTests.cs` :

```csharp
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
        // 16 USDC * 15% = 2.40 USDC exactement
        Assert.Equal(Money.FromUnits(2.40m), Money.FromUnits(16m).MultiplyByBasisPoints(1500));
        // 1 micro * 15% = 0.15 micro -> tronque a 0, jamais d'arrondi superieur
        Assert.Equal(Money.Zero, new Money(1).MultiplyByBasisPoints(1500));
    }

    [Fact]
    public void Zero_est_neutre_et_comparable()
    {
        Assert.Equal(Money.Zero, Money.FromUnits(0m));
        Assert.True(Money.FromUnits(1m) > Money.Zero);
    }
}
```

- [x] **Step 3: Lancer le test et vérifier qu'il échoue**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : échec de compilation, `The type or namespace name 'Money' could not be found`.

- [x] **Step 4: Implémenter Money**

Créer `src/Fallguys.Rules/Money.cs` :

```csharp
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
```

- [x] **Step 5: Lancer les tests et vérifier qu'ils passent**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : 5 tests réussis.

- [x] **Step 6: Commit**

```bash
git add Fallguys.sln src/Fallguys.Rules tests/Fallguys.Rules.Tests
git commit -m "feat(rules): type Money en micro-unites entieres"
```

---

### Task 2: Identité joueur, palier de mise et configuration de partie

**Files:**
- Create: `src/Fallguys.Rules/PlayerId.cs`
- Create: `src/Fallguys.Rules/StakeContext.cs`
- Create: `src/Fallguys.Rules/MatchConfiguration.cs`
- Test: `tests/Fallguys.Rules.Tests/MatchConfigurationTests.cs`

**Interfaces:**
- Consumes: `Money` (Task 1).
- Produces:
  - `readonly record struct PlayerId(string Value)`
  - `enum StakeTier { Free, Micro, High }`
  - `sealed record StakeContext(StakeTier Tier, Money EntryFee, string Currency)` avec `StakeContext.Free`
  - `sealed record MatchConfiguration(int PlayerCount, IReadOnlyList<int> RoundSurvivors, int RakeBasisPoints, IReadOnlyList<int> FinalistBonusWeights)` avec `MatchConfiguration.Default`, `int RoundCount`, `int RefundThreshold`, `int FinalistCount`, `void Validate()`

- [x] **Step 1: Écrire le test qui échoue**

Créer `tests/Fallguys.Rules.Tests/MatchConfigurationTests.cs` :

```csharp
using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class MatchConfigurationTests
{
    [Fact]
    public void Default_correspond_a_la_structure_de_reference_du_spec()
    {
        var config = MatchConfiguration.Default;
        Assert.Equal(16, config.PlayerCount);
        Assert.Equal(new[] { 8, 4, 1 }, config.RoundSurvivors);
        Assert.Equal(1500, config.RakeBasisPoints);
        Assert.Equal(3, config.RoundCount);
        Assert.Equal(8, config.RefundThreshold);   // survivants de la manche 1
        Assert.Equal(4, config.FinalistCount);     // entrants de la derniere manche
    }

    [Theory]
    [InlineData(12, 6, 3)]
    [InlineData(24, 12, 6)]
    public void La_structure_tourne_a_12_et_24_joueurs(int players, int afterRound1, int finalists)
    {
        var config = new MatchConfiguration(players, new[] { afterRound1, finalists, 1 }, 1500, new[] { 35, 15, 5, 1, 1, 1 });
        config.Validate();
        Assert.Equal(afterRound1, config.RefundThreshold);
        Assert.Equal(finalists, config.FinalistCount);
    }

    [Fact]
    public void Validate_refuse_une_progression_non_decroissante()
    {
        var config = new MatchConfiguration(16, new[] { 4, 8, 1 }, 1500, new[] { 35, 15, 5, 1 });
        var ex = Assert.Throws<ArgumentException>(() => config.Validate());
        Assert.Contains("decroissante", ex.Message);
    }

    [Fact]
    public void Validate_refuse_une_derniere_manche_sans_vainqueur_unique()
    {
        var config = new MatchConfiguration(16, new[] { 8, 4, 2 }, 1500, new[] { 35, 15, 5, 1 });
        Assert.Throws<ArgumentException>(() => config.Validate());
    }

    [Fact]
    public void Validate_refuse_un_rake_qui_rend_le_remboursement_impossible()
    {
        // Rembourser 8 joueurs sur 16 coute 50 % du pot : un rake de 60 % le rend impossible.
        var config = new MatchConfiguration(16, new[] { 8, 4, 1 }, 6000, new[] { 35, 15, 5, 1 });
        var ex = Assert.Throws<ArgumentException>(() => config.Validate());
        Assert.Contains("rake", ex.Message);
    }

    [Fact]
    public void Validate_refuse_des_poids_de_bonus_qui_ne_couvrent_pas_les_finalistes()
    {
        var config = new MatchConfiguration(16, new[] { 8, 4, 1 }, 1500, new[] { 35, 15 });
        Assert.Throws<ArgumentException>(() => config.Validate());
    }

    [Fact]
    public void StakeContext_Free_a_une_mise_nulle()
    {
        Assert.Equal(StakeTier.Free, StakeContext.Free.Tier);
        Assert.Equal(Money.Zero, StakeContext.Free.EntryFee);
    }
}
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : échec de compilation, `MatchConfiguration` introuvable.

- [x] **Step 3: Implémenter PlayerId et StakeContext**

Créer `src/Fallguys.Rules/PlayerId.cs` :

```csharp
namespace Fallguys.Rules;

/// <summary>Identifiant joueur stable, attribué dès la première partie même en mode gratuit.</summary>
public readonly record struct PlayerId(string Value)
{
    public override string ToString() => Value;
}
```

Créer `src/Fallguys.Rules/StakeContext.cs` :

```csharp
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

    public static StakeContext Usdc(StakeTier tier, decimal units) =>
        new(tier, Money.FromUnits(units), "USDC");
}
```

- [x] **Step 4: Implémenter MatchConfiguration**

Créer `src/Fallguys.Rules/MatchConfiguration.cs` :

```csharp
namespace Fallguys.Rules;

/// <summary>
/// Forme d'une partie : combien de joueurs entrent, combien survivent à chaque manche,
/// quel rake s'applique, comment le bonus se répartit entre finalistes.
/// Tout est exprimé en nombres de survivants — jamais en constantes — pour que la même
/// structure tourne de 12 à 24 joueurs sans changement de code.
/// </summary>
public sealed record MatchConfiguration(
    int PlayerCount,
    IReadOnlyList<int> RoundSurvivors,
    int RakeBasisPoints,
    IReadOnlyList<int> FinalistBonusWeights)
{
    /// <summary>Structure de référence du spec : 16 joueurs, 3 manches, rake 15 %.</summary>
    public static MatchConfiguration Default { get; } =
        new(16, new[] { 8, 4, 1 }, 1500, new[] { 35, 15, 5, 1 });

    public int RoundCount => RoundSurvivors.Count;

    /// <summary>Rang au-delà duquel le joueur ne récupère plus sa mise : les survivants de la manche 1.</summary>
    public int RefundThreshold => RoundSurvivors[0];

    /// <summary>Nombre de joueurs qui entrent dans la dernière manche.</summary>
    public int FinalistCount => RoundSurvivors[RoundCount - 2];

    public void Validate()
    {
        if (PlayerCount < 2)
            throw new ArgumentException("PlayerCount doit valoir au moins 2.");

        if (RoundCount < 2)
            throw new ArgumentException("Une partie doit compter au moins 2 manches.");

        if (RoundSurvivors[0] >= PlayerCount)
            throw new ArgumentException("La manche 1 doit eliminer au moins un joueur.");

        for (var i = 1; i < RoundCount; i++)
        {
            if (RoundSurvivors[i] >= RoundSurvivors[i - 1])
                throw new ArgumentException(
                    $"La progression des survivants doit etre strictement decroissante (manche {i + 1}).");
        }

        if (RoundSurvivors[RoundCount - 1] != 1)
            throw new ArgumentException("La derniere manche doit designer un vainqueur unique.");

        if (RakeBasisPoints is < 0 or > 10_000)
            throw new ArgumentException("Le rake doit etre compris entre 0 et 10000 points de base.");

        // Rembourser les survivants de la manche 1 coute RefundThreshold / PlayerCount du pot.
        // Le rake ne doit pas rendre ce remboursement impossible.
        var refundShareBasisPoints = (long)RefundThreshold * 10_000L / PlayerCount;
        if (10_000L - RakeBasisPoints < refundShareBasisPoints)
            throw new ArgumentException(
                $"Le rake de {RakeBasisPoints} points de base ne laisse pas de quoi rembourser " +
                $"les {RefundThreshold} survivants de la manche 1.");

        if (FinalistBonusWeights.Count < FinalistCount)
            throw new ArgumentException(
                $"Il faut au moins {FinalistCount} poids de bonus pour {FinalistCount} finalistes.");

        if (FinalistBonusWeights.Take(FinalistCount).Any(w => w < 0))
            throw new ArgumentException("Les poids de bonus doivent etre positifs ou nuls.");

        if (FinalistBonusWeights.Take(FinalistCount).Sum() <= 0)
            throw new ArgumentException("La somme des poids de bonus doit etre strictement positive.");
    }
}
```

- [x] **Step 5: Lancer les tests et vérifier qu'ils passent**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : tous les tests réussis (5 de Task 1 + 8 de Task 2).

- [x] **Step 6: Commit**

```bash
git add src/Fallguys.Rules tests/Fallguys.Rules.Tests
git commit -m "feat(rules): identite joueur, palier de mise et configuration de partie validee"
```

---

### Task 3: Calcul des payouts gradués

**Files:**
- Create: `src/Fallguys.Rules/PayoutTable.cs`
- Create: `src/Fallguys.Rules/PayoutPolicy.cs`
- Test: `tests/Fallguys.Rules.Tests/PayoutPolicyTests.cs`

**Interfaces:**
- Consumes: `Money`, `StakeContext`, `MatchConfiguration`.
- Produces:
  - `sealed record PayoutTable(Money Pot, Money Rake, IReadOnlyList<Money> PayoutByRank)` avec `Money ForRank(int rank)` (rang 1-based) et `Money TotalDistributed`
  - `static class PayoutPolicy` avec `static PayoutTable Compute(MatchConfiguration config, StakeContext stake)`

Règle métier, exprimée en une phrase : **les survivants de la manche 1 récupèrent leur mise ; ce qui reste après le rake est réparti en bonus entre les finalistes.**

- [x] **Step 1: Écrire le test qui échoue**

Créer `tests/Fallguys.Rules.Tests/PayoutPolicyTests.cs` :

```csharp
using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class PayoutPolicyTests
{
    private static readonly StakeContext OneDollar = StakeContext.Usdc(StakeTier.Micro, 1m);

    [Fact]
    public void Reproduit_exactement_la_table_de_reference_du_spec()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);

        Assert.Equal(Money.FromUnits(16m), table.Pot);
        Assert.Equal(Money.FromUnits(2.40m), table.Rake);

        Assert.Equal(Money.FromUnits(4.50m), table.ForRank(1));
        Assert.Equal(Money.FromUnits(2.50m), table.ForRank(2));
        Assert.Equal(Money.FromUnits(1.50m), table.ForRank(3));
        Assert.Equal(Money.FromUnits(1.10m), table.ForRank(4));

        // Rangs 5 a 8 : mise remboursee exactement
        for (var rank = 5; rank <= 8; rank++)
            Assert.Equal(Money.FromUnits(1m), table.ForRank(rank));

        // Rangs 9 a 16 : rien
        for (var rank = 9; rank <= 16; rank++)
            Assert.Equal(Money.Zero, table.ForRank(rank));
    }

    [Fact]
    public void Invariant_monetaire_aucune_unite_creee_ni_perdue()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
    }

    [Theory]
    [InlineData(0.25)]
    [InlineData(1)]
    [InlineData(5)]
    [InlineData(0.37)]   // montant qui ne tombe pas juste : l'invariant doit tenir quand meme
    public void Invariant_monetaire_tient_pour_toute_mise(decimal units)
    {
        var stake = StakeContext.Usdc(StakeTier.Micro, units);
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, stake);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
    }

    [Theory]
    [InlineData(12, 6, 3)]
    [InlineData(24, 12, 6)]
    public void Invariant_monetaire_tient_a_12_et_24_joueurs(int players, int afterRound1, int finalists)
    {
        var config = new MatchConfiguration(players, new[] { afterRound1, finalists, 1 }, 1500, new[] { 35, 15, 5, 1, 1, 1 });
        var table = PayoutPolicy.Compute(config, OneDollar);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
        Assert.Equal(players, table.PayoutByRank.Count);
    }

    [Fact]
    public void Les_survivants_de_la_manche_1_recuperent_au_moins_leur_mise()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        for (var rank = 1; rank <= MatchConfiguration.Default.RefundThreshold; rank++)
            Assert.True(table.ForRank(rank) >= OneDollar.EntryFee, $"rang {rank}");
    }

    [Fact]
    public void Les_gains_sont_strictement_decroissants_chez_les_finalistes()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        for (var rank = 1; rank < MatchConfiguration.Default.FinalistCount; rank++)
            Assert.True(table.ForRank(rank) > table.ForRank(rank + 1), $"rang {rank}");
    }

    [Fact]
    public void Mode_gratuit_ne_distribue_rien_et_ne_prend_aucun_rake()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, StakeContext.Free);
        Assert.Equal(Money.Zero, table.Pot);
        Assert.Equal(Money.Zero, table.Rake);
        Assert.Equal(Money.Zero, table.TotalDistributed);
        Assert.All(table.PayoutByRank, m => Assert.Equal(Money.Zero, m));
    }

    [Fact]
    public void Compute_valide_la_configuration_recue()
    {
        var invalide = new MatchConfiguration(16, new[] { 8, 4, 2 }, 1500, new[] { 35, 15, 5, 1 });
        Assert.Throws<ArgumentException>(() => PayoutPolicy.Compute(invalide, OneDollar));
    }

    [Fact]
    public void ForRank_rejette_un_rang_hors_bornes()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        Assert.Throws<ArgumentOutOfRangeException>(() => table.ForRank(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => table.ForRank(17));
    }
}
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : échec de compilation, `PayoutPolicy` introuvable.

- [x] **Step 3: Implémenter PayoutTable**

Créer `src/Fallguys.Rules/PayoutTable.cs` :

```csharp
namespace Fallguys.Rules;

/// <summary>
/// Résultat du calcul de payouts pour une configuration et une mise données.
/// <paramref name="PayoutByRank"/> est indexé à partir de 0 pour le rang 1.
/// </summary>
public sealed record PayoutTable(Money Pot, Money Rake, IReadOnlyList<Money> PayoutByRank)
{
    /// <summary>Gain du rang donné (1 = vainqueur).</summary>
    public Money ForRank(int rank)
    {
        if (rank < 1 || rank > PayoutByRank.Count)
            throw new ArgumentOutOfRangeException(nameof(rank), rank,
                $"Rang attendu entre 1 et {PayoutByRank.Count}.");
        return PayoutByRank[rank - 1];
    }

    public Money TotalDistributed =>
        PayoutByRank.Aggregate(Money.Zero, static (sum, m) => sum + m);
}
```

- [x] **Step 4: Implémenter PayoutPolicy**

Créer `src/Fallguys.Rules/PayoutPolicy.cs` :

```csharp
namespace Fallguys.Rules;

/// <summary>
/// Payouts gradués. Règle unique : les survivants de la manche 1 récupèrent leur mise,
/// et ce qui reste après le rake est réparti en bonus entre les finalistes.
/// Ce choix place le seuil de non-perte exactement à la fin de la première manche —
/// c'est l'amortisseur du "mur des 95 % de perdants" décrit dans le spec.
/// </summary>
public static class PayoutPolicy
{
    public static PayoutTable Compute(MatchConfiguration config, StakeContext stake)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(stake);
        config.Validate();

        var pot = stake.EntryFee * config.PlayerCount;
        var rake = pot.MultiplyByBasisPoints(config.RakeBasisPoints);
        var distributable = pot - rake;

        var payouts = new Money[config.PlayerCount];
        Array.Fill(payouts, Money.Zero);

        // 1. Remboursement de la mise aux survivants de la manche 1.
        for (var rank = 1; rank <= config.RefundThreshold; rank++)
            payouts[rank - 1] = stake.EntryFee;

        var refundTotal = stake.EntryFee * config.RefundThreshold;
        var bonusPool = distributable - refundTotal;

        // 2. Répartition du bonus entre finalistes, au prorata des poids.
        var finalistCount = config.FinalistCount;
        var weights = config.FinalistBonusWeights.Take(finalistCount).ToArray();
        var weightSum = weights.Sum();

        var allocated = Money.Zero;
        for (var i = 0; i < finalistCount; i++)
        {
            var share = new Money(bonusPool.Micros * weights[i] / weightSum);
            payouts[i] += share;
            allocated += share;
        }

        // 3. Le reste de division entière revient au vainqueur : aucune unité ne se perd.
        var remainder = bonusPool - allocated;
        if (remainder.Micros != 0)
            payouts[0] += remainder;

        return new PayoutTable(pot, rake, payouts);
    }
}
```

- [x] **Step 5: Lancer les tests et vérifier qu'ils passent**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : tous les tests réussis. Si le test `Reproduit_exactement_la_table_de_reference_du_spec` échoue sur le rang 1, vérifier que le reste de division est bien ajouté au vainqueur (Step 4, point 3).

- [x] **Step 6: Commit**

```bash
git add src/Fallguys.Rules tests/Fallguys.Rules.Tests
git commit -m "feat(rules): payouts gradues avec remboursement a la manche 1"
```

---

### Task 4: Classement cumulé au fil des manches

**Files:**
- Create: `src/Fallguys.Rules/Standings.cs`
- Test: `tests/Fallguys.Rules.Tests/StandingsTests.cs`

**Interfaces:**
- Consumes: `PlayerId`, `MatchConfiguration`.
- Produces:
  - `sealed record RoundOutcome(int RoundIndex, IReadOnlyList<PlayerId> FinishOrder)` — ordre d'arrivée des joueurs encore en lice, du meilleur au moins bon.
  - `sealed class Standings` avec `Standings(MatchConfiguration config, IReadOnlyList<PlayerId> entrants)`, `IReadOnlyList<PlayerId> Active`, `void ApplyRound(RoundOutcome outcome)`, `IReadOnlyList<PlayerId> FinalRanking()`, `bool IsComplete`.

Principe de classement : un joueur éliminé tard se classe devant un joueur éliminé tôt ; à élimination égale, l'ordre d'arrivée de la manche fatale départage.

- [x] **Step 1: Écrire le test qui échoue**

Créer `tests/Fallguys.Rules.Tests/StandingsTests.cs` :

```csharp
using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class StandingsTests
{
    private static readonly MatchConfiguration Config =
        new(4, new[] { 2, 1 }, 1500, new[] { 35, 15 });

    private static readonly PlayerId A = new("A");
    private static readonly PlayerId B = new("B");
    private static readonly PlayerId C = new("C");
    private static readonly PlayerId D = new("D");

    private static Standings NewStandings() => new(Config, new[] { A, B, C, D });

    [Fact]
    public void Au_depart_tous_les_entrants_sont_actifs()
    {
        var standings = NewStandings();
        Assert.Equal(new[] { A, B, C, D }, standings.Active);
        Assert.False(standings.IsComplete);
    }

    [Fact]
    public void Une_manche_elimine_les_derniers_arrives()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        Assert.Equal(new[] { C, A }, standings.Active);
    }

    [Fact]
    public void Le_classement_final_place_les_survivants_devant_les_elimines()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        standings.ApplyRound(new RoundOutcome(1, new[] { A, C }));

        Assert.True(standings.IsComplete);
        // A gagne la finale, C second ; D elimine 3e en manche 1, B dernier.
        Assert.Equal(new[] { A, C, D, B }, standings.FinalRanking());
    }

    [Fact]
    public void ApplyRound_refuse_un_ordre_qui_ne_couvre_pas_les_joueurs_actifs()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D })));
    }

    [Fact]
    public void ApplyRound_refuse_un_joueur_inconnu()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, new PlayerId("Z") })));
    }

    [Fact]
    public void ApplyRound_refuse_une_manche_hors_sequence()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(1, new[] { C, A, D, B })));
    }

    [Fact]
    public void FinalRanking_refuse_une_partie_inachevee()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        Assert.Throws<InvalidOperationException>(() => standings.FinalRanking());
    }

    [Fact]
    public void ApplyRound_refuse_une_manche_apres_la_fin()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        standings.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        Assert.Throws<InvalidOperationException>(() =>
            standings.ApplyRound(new RoundOutcome(2, new[] { A })));
    }
}
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : échec de compilation, `Standings` introuvable.

- [x] **Step 3: Implémenter Standings**

Créer `src/Fallguys.Rules/Standings.cs` :

```csharp
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
```

- [x] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : tous les tests réussis.

- [x] **Step 5: Commit**

```bash
git add src/Fallguys.Rules tests/Fallguys.Rules.Tests
git commit -m "feat(rules): classement cumule au fil des manches"
```

---

### Task 5: Cycle de vie de partie et résultat signable

**Files:**
- Create: `src/Fallguys.Rules/MatchStateMachine.cs`
- Create: `src/Fallguys.Rules/MatchResult.cs`
- Test: `tests/Fallguys.Rules.Tests/MatchStateMachineTests.cs`

**Interfaces:**
- Consumes: `PlayerId`, `StakeContext`, `MatchConfiguration`, `Standings`, `RoundOutcome`, `PayoutPolicy`, `PayoutTable`, `Money`.
- Produces:
  - `enum MatchPhase { Lobby, InProgress, Settled }`
  - `sealed record PlayerPayout(PlayerId Player, int Rank, Money Amount)`
  - `sealed record MatchResult(string MatchId, string BuildVersion, string ReplayHash, StakeContext Stake, Money Pot, Money Rake, IReadOnlyList<PlayerPayout> Payouts)`
  - `sealed class MatchStateMachine` avec `MatchStateMachine(string matchId, MatchConfiguration config, StakeContext stake)`, `MatchPhase Phase`, `void Start(IReadOnlyList<PlayerId> entrants)`, `void ApplyRound(RoundOutcome outcome)`, `MatchResult Settle(string buildVersion, string replayHash)`.

- [x] **Step 1: Écrire le test qui échoue**

Créer `tests/Fallguys.Rules.Tests/MatchStateMachineTests.cs` :

```csharp
using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class MatchStateMachineTests
{
    private static readonly MatchConfiguration Config =
        new(4, new[] { 2, 1 }, 1500, new[] { 35, 15 });

    private static readonly StakeContext Stake = StakeContext.Usdc(StakeTier.Micro, 1m);

    private static readonly PlayerId A = new("A");
    private static readonly PlayerId B = new("B");
    private static readonly PlayerId C = new("C");
    private static readonly PlayerId D = new("D");

    private static MatchStateMachine NewMatch() => new("match-1", Config, Stake);

    private static MatchStateMachine PlayedToTheEnd()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        match.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        return match;
    }

    [Fact]
    public void Une_partie_commence_en_lobby()
    {
        Assert.Equal(MatchPhase.Lobby, NewMatch().Phase);
    }

    [Fact]
    public void Start_fait_passer_la_partie_en_cours()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Equal(MatchPhase.InProgress, match.Phase);
    }

    [Fact]
    public void ApplyRound_avant_Start_est_refuse()
    {
        var match = NewMatch();
        Assert.Throws<InvalidOperationException>(() =>
            match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B })));
    }

    [Fact]
    public void Start_deux_fois_est_refuse()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Throws<InvalidOperationException>(() => match.Start(new[] { A, B, C, D }));
    }

    [Fact]
    public void Settle_avant_la_fin_des_manches_est_refuse()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Throws<InvalidOperationException>(() => match.Settle("1.0.0", "hash"));
    }

    [Fact]
    public void Settle_produit_un_resultat_complet_et_passe_en_regle()
    {
        var match = PlayedToTheEnd();
        var result = match.Settle("1.0.0", "abc123");

        Assert.Equal(MatchPhase.Settled, match.Phase);
        Assert.Equal("match-1", result.MatchId);
        Assert.Equal("1.0.0", result.BuildVersion);
        Assert.Equal("abc123", result.ReplayHash);
        Assert.Equal(4, result.Payouts.Count);

        Assert.Equal(A, result.Payouts[0].Player);
        Assert.Equal(1, result.Payouts[0].Rank);
        Assert.Equal(C, result.Payouts[1].Player);
        Assert.Equal(D, result.Payouts[2].Player);
        Assert.Equal(B, result.Payouts[3].Player);
    }

    [Fact]
    public void Le_resultat_respecte_l_invariant_monetaire()
    {
        var result = PlayedToTheEnd().Settle("1.0.0", "abc123");
        var distributed = result.Payouts.Aggregate(Money.Zero, (sum, p) => sum + p.Amount);
        Assert.Equal(result.Pot, distributed + result.Rake);
    }

    [Fact]
    public void Les_montants_du_resultat_suivent_la_table_de_payouts()
    {
        var expected = PayoutPolicy.Compute(Config, Stake);
        var result = PlayedToTheEnd().Settle("1.0.0", "abc123");
        foreach (var payout in result.Payouts)
            Assert.Equal(expected.ForRank(payout.Rank), payout.Amount);
    }

    [Fact]
    public void Settle_deux_fois_est_refuse()
    {
        var match = PlayedToTheEnd();
        match.Settle("1.0.0", "abc123");
        Assert.Throws<InvalidOperationException>(() => match.Settle("1.0.0", "abc123"));
    }

    [Fact]
    public void Une_partie_gratuite_se_regle_avec_des_montants_nuls()
    {
        var match = new MatchStateMachine("match-free", Config, StakeContext.Free);
        match.Start(new[] { A, B, C, D });
        match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        match.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        var result = match.Settle("1.0.0", "hash");

        Assert.Equal(Money.Zero, result.Pot);
        Assert.All(result.Payouts, p => Assert.Equal(Money.Zero, p.Amount));
        Assert.Equal(4, result.Payouts.Count);
    }
}
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : échec de compilation, `MatchStateMachine` introuvable.

- [x] **Step 3: Implémenter MatchResult**

Créer `src/Fallguys.Rules/MatchResult.cs` :

```csharp
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
```

- [x] **Step 4: Implémenter MatchStateMachine**

Créer `src/Fallguys.Rules/MatchStateMachine.cs` :

```csharp
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
```

- [x] **Step 5: Lancer les tests et vérifier qu'ils passent**

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet test tests/Fallguys.Rules.Tests/Fallguys.Rules.Tests.csproj
```

Attendu : l'ensemble de la suite réussit (Tasks 1 à 5).

- [x] **Step 6: Commit**

```bash
git add src/Fallguys.Rules tests/Fallguys.Rules.Tests
git commit -m "feat(rules): cycle de vie de partie et resultat signable"
```

---

## Ce que ce plan ne fait pas

- Aucune signature cryptographique du `MatchResult` : la structure la porte (`ReplayHash`, `BuildVersion`), la signature appartient au plan Backend.
- Aucune notion de temps, de tick ou de physique : `RoundOutcome` est fourni par la simulation, ce noyau ne fait que l'interpréter.
- Aucune persistance : ces objets sont purement en mémoire.
- Aucun `IWalletService` ni `IEntryFeeProvider` : ces interfaces appartiennent à `Game.Platform`, hors périmètre de ce plan.
