namespace Fallguys.Rules;

/// <summary>Identifiant joueur stable, attribué dès la première partie même en mode gratuit.</summary>
public readonly record struct PlayerId(string Value)
{
    public override string ToString() => Value;
}
