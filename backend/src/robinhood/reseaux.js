/**
 * LES RESEAUX — Robinhood Chain, en deux versions, plus les doublures de test.
 *
 * Robinhood Chain est un Layer 2 d'Ethereum (Arbitrum Orbit) : le gaz se paie en ETH, les
 * contrats sont des contrats EVM ordinaires, l'explorateur est un Blockscout. Ces valeurs
 * sont PUBLIQUES et ne changent qu'avec le reseau ; tout le reste (adresses des contrats,
 * cles) vit dans l'environnement.
 *
 * Le meme objet part vers le navigateur (`GET /moi` → `chaine`) : c'est avec lui que le
 * portefeuille du joueur ajoute le reseau a MetaMask (`wallet_addEthereumChain`). Une
 * seule source pour les deux cotes, sinon le jeu et le wallet finiraient sur deux chaines.
 */

export const RESEAUX = {
  testnet: {
    id: 'testnet',
    nom: 'Robinhood Chain Testnet',
    chainId: 46630,
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorateur: 'https://explorer.testnet.chain.robinhood.com',
    faucet: 'https://faucet.testnet.chain.robinhood.com',
    monnaie: { nom: 'Ether', symbole: 'ETH', decimales: 18 },
  },
  mainnet: {
    id: 'mainnet',
    nom: 'Robinhood Chain',
    chainId: 4663,
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorateur: 'https://robinhoodchain.blockscout.com',
    faucet: null,
    monnaie: { nom: 'Ether', symbole: 'ETH', decimales: 18 },
  },
  /** anvil (Foundry), pour `npm run cycle:local`. */
  local: {
    id: 'local',
    nom: 'anvil (local)',
    chainId: 31337,
    rpc: 'http://127.0.0.1:8545',
    explorateur: null,
    faucet: null,
    monnaie: { nom: 'Ether', symbole: 'ETH', decimales: 18 },
  },
  /** La chaine en memoire des tests : aucun RPC. */
  factice: {
    id: 'factice',
    nom: 'factice',
    chainId: 0,
    rpc: null,
    explorateur: null,
    faucet: null,
    monnaie: { nom: 'Ether', symbole: 'ETH', decimales: 18 },
  },
};

export function reseauDe(id) {
  const r = RESEAUX[id];
  if (!r) throw new Error(`reseau inconnu « ${id} » : ${Object.keys(RESEAUX).join(', ')}`);
  return r;
}
