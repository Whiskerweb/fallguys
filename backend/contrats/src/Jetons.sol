// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * LES JETONS DU JEU — un ERC-20 qui accepte des AUTORISATIONS SIGNEES (EIP-3009).
 *
 * Pourquoi EIP-3009 et pas un simple `transfer` : sur une chaine EVM, c'est l'expediteur
 * qui paie le gaz. Or les wallets des joueurs et des pots sont DERIVES et ne detiennent
 * jamais d'ETH — comme sur la version precedente, ou un autre compte payait les frais.
 * Avec `transferWithAuthorization`, le proprietaire SIGNE (hors chaine, gratuit) et la
 * CAISSE soumet la transaction et paie le gaz. USDC de Circle implemente exactement cette
 * interface sur toutes les chaines EVM : le jour du mainnet, le meme code signe les memes
 * autorisations contre le vrai jeton.
 *
 * Le `nonce` d'une autorisation est un bytes32 LIBRE, pas un compteur : le backend y met
 * le hache de sa cle d'idempotence (objet:ref). Rejouer la meme operation est donc refuse
 * PAR LE CONTRAT, quelle que soit la transaction qui la porte.
 */
abstract contract JetonAutorise {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) private _autorisations;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    bytes32 private constant _TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private immutable _NAME_HASH;
    uint256 private immutable _CHAIN_ID;
    bytes32 private immutable _DOMAIN;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
        _NAME_HASH = keccak256(bytes(n));
        _CHAIN_ID = block.chainid;
        _DOMAIN = _calculerDomaine();
    }

    function version() external pure returns (string memory) { return "1"; }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _CHAIN_ID ? _DOMAIN : _calculerDomaine();
    }

    function _calculerDomaine() private view returns (bytes32) {
        return keccak256(abi.encode(_TYPE_HASH, _NAME_HASH, keccak256("1"), block.chainid, address(this)));
    }

    // ---- ERC-20 ----

    function transfer(address to, uint256 value) external returns (bool) {
        _transferer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance insuffisante");
            allowance[from][msg.sender] = a - value;
        }
        _transferer(from, to, value);
        return true;
    }

    // ---- EIP-3009 ----

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _autorisations[authorizer][nonce];
    }

    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
        ));
        _consommer(from, validAfter, validBefore, nonce, structHash, v, r, s);
        _transferer(from, to, value);
    }

    function _consommer(
        address signataire, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes32 structHash,
        uint8 v, bytes32 r, bytes32 s
    ) internal {
        require(block.timestamp > validAfter, "autorisation pas encore valide");
        require(block.timestamp < validBefore, "autorisation expiree");
        require(!_autorisations[signataire][nonce], "autorisation deja utilisee");
        // Une signature (r, s) et (r, n - s) designent le meme signataire : on n'accepte que la
        // moitie basse, sinon une autorisation pourrait etre presentee deux fois sous deux formes.
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "signature malleable");
        address recouvre = ecrecover(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash)), v, r, s);
        require(recouvre != address(0) && recouvre == signataire, "signature invalide");
        _autorisations[signataire][nonce] = true;
        emit AuthorizationUsed(signataire, nonce);
    }

    // ---- interne ----

    function _transferer(address from, address to, uint256 value) internal {
        require(to != address(0), "vers l'adresse zero");
        uint256 b = balanceOf[from];
        require(b >= value, "solde insuffisant");
        unchecked { balanceOf[from] = b - value; }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _frapper(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _bruler(address from, uint256 value) internal {
        uint256 b = balanceOf[from];
        require(b >= value, "solde insuffisant");
        unchecked { balanceOf[from] = b - value; totalSupply -= value; }
        emit Transfer(from, address(0), value);
    }
}

/**
 * L'USDC D'ESSAI — sur le testnet seulement.
 *
 * Robinhood Chain Testnet n'a pas d'USDC public : le jeu deploie le sien, six decimales,
 * que son PROPRIETAIRE (le contrat Lot, donc la caisse) peut frapper a volonte. C'est ce
 * qui remplace le robinet d'un tiers : `POST /robinet` donne des USDC d'essai a un joueur.
 * Sur mainnet, `USDC_ADRESSE` designe le vrai jeton et ce contrat n'est jamais deploye.
 */
contract USDCTest is JetonAutorise {
    address public immutable proprietaire;

    constructor(address p) JetonAutorise("USD Coin (test)", "USDC", 6) {
        proprietaire = p;
    }

    function frapper(address to, uint256 value) external {
        require(msg.sender == proprietaire, "proprietaire seul");
        _frapper(to, value);
    }
}

/**
 * BABY GUY (BG) — un milliard, frappe UNE FOIS au constructeur, vers le pool ; il n'existe
 * aucune fonction de frappe. L'offre ne peut que baisser : `burn` et surtout
 * `burnWithAuthorization`, la meme mecanique signee que le virement, pour que la caisse
 * puisse bruler DEPUIS LE POOL sans que le pool ait d'ETH.
 */
contract BabyGuy is JetonAutorise {
    bytes32 public constant BURN_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("BurnWithAuthorization(address from,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    constructor(address pool) JetonAutorise("Baby Guy", "BG", 6) {
        _frapper(pool, 1_000_000_000 * 10 ** 6);
    }

    function burn(uint256 value) external {
        _bruler(msg.sender, value);
    }

    function burnWithAuthorization(
        address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        bytes32 structHash = keccak256(abi.encode(
            BURN_WITH_AUTHORIZATION_TYPEHASH, from, value, validAfter, validBefore, nonce
        ));
        _consommer(from, validAfter, validBefore, nonce, structHash, v, r, s);
        _bruler(from, value);
    }
}
