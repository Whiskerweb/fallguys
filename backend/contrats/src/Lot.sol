// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * LE LOT — plusieurs appels dans UNE transaction, tout ou rien.
 *
 * C'est ce qui rend un reglement ATOMIQUE sur une chaine EVM : seize gains, le rake, et
 * s'il le faut le rachat-brulage passent dans une seule transaction ; si un appel echoue,
 * aucun n'a eu lieu. Les mises d'une partie partent de la meme facon : si UNE mise ne
 * passe pas, aucune n'est partie, et il n'y a rien a rendre sur la chaine.
 *
 * Seule la CAISSE peut l'appeler. Le contrat ne detient rien et ne signe rien : chaque
 * appel qu'il relaie est un `transferWithAuthorization` deja signe par le proprietaire
 * des fonds. L'index de l'appel fautif remonte dans l'erreur, pour que le backend sache
 * QUI a fait echouer le lot.
 */
contract Lot {
    address public immutable proprietaire;

    struct Appel {
        address cible;
        bytes donnees;
    }

    error AppelRate(uint256 index, bytes raison);

    constructor(address p) {
        proprietaire = p;
    }

    function executer(Appel[] calldata appels) external {
        require(msg.sender == proprietaire, "proprietaire seul");
        for (uint256 i = 0; i < appels.length; i++) {
            (bool ok, bytes memory r) = appels[i].cible.call(appels[i].donnees);
            if (!ok) revert AppelRate(i, r);
        }
    }
}
