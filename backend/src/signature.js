/**
 * SIGNATURES Ed25519 — ce par quoi le serveur de jeu prouve au backend qu'un resultat
 * vient de lui, et pas d'un navigateur.
 *
 * C'etait le trou n° 1 de la liste d'avant-mainnet : `POST /partie/regler` croyait le
 * client sur son rang, son mode et sa graine de roue. Depuis le 2 septembre 2026, le
 * navigateur ne parle plus d'argent au backend. Le serveur de jeu — qui SAIT qui a fini
 * ou, parce qu'il a simule la partie — signe le classement avec sa cle, et le backend
 * verifie la signature avant d'ecrire une ligne au grand livre.
 *
 * Ce qui est signe couvre TOUT ce qui decide du paiement : la partie, le mode, la mise,
 * l'effectif, la graine de roue et le classement. Une signature qui ne couvrirait pas la
 * graine laisserait un intermediaire en essayer jusqu'a tomber sur JACKPOT. Un horodatage
 * y figure aussi, pour qu'un message intercepte ne se rejoue pas indefiniment.
 *
 * AUCUNE DEPENDANCE : Node sait faire de l'Ed25519 nativement depuis la version 12. La
 * cle est un germe de 32 octets en base58 ; on accepte aussi la forme longue de 64 octets
 * (germe + publique), par commodite.
 *
 * Le fichier est partage tel quel avec `serveur/src/signature.js`, qui le reexporte : une
 * copie de chaque cote finirait par diverger sur la canonisation, et une signature qui ne
 * se verifie plus se remarque au premier reglement refuse — pas avant.
 */

import { createPrivateKey, createPublicKey, sign, verify, randomBytes } from 'node:crypto';
import bs58 from 'bs58';

/*
 * Node veut des cles au format DER. Pour Ed25519 l'enveloppe est constante : ces deux
 * prefixes, puis les 32 octets bruts. On les ecrit une fois pour n'importer aucune
 * bibliotheque ASN.1.
 */
const DER_PRIVEE = Buffer.from('302e020100300506032b657004220420', 'hex');
const DER_PUBLIQUE = Buffer.from('302a300506032b6570032100', 'hex');

function germe(secrete) {
  const octets = Buffer.from(bs58.decode(secrete));
  // 64 octets : la forme longue (germe + publique). On n'a besoin que du germe.
  if (octets.length === 64) return octets.subarray(0, 32);
  if (octets.length !== 32) throw new Error(`cle secrete : ${octets.length} octets, attendu 32 ou 64`);
  return octets;
}

function clePrivee(secrete) {
  return createPrivateKey({ key: Buffer.concat([DER_PRIVEE, germe(secrete)]), format: 'der', type: 'pkcs8' });
}

function clePublique(publique) {
  const octets = Buffer.from(bs58.decode(publique));
  if (octets.length !== 32) throw new Error(`cle publique : ${octets.length} octets, attendu 32`);
  return createPublicKey({ key: Buffer.concat([DER_PUBLIQUE, octets]), format: 'der', type: 'spki' });
}

/** Une paire neuve. Le germe est tire au hasard cryptographique. */
export function genererCle() {
  const secrete = bs58.encode(randomBytes(32));
  return { secrete, publique: publiqueDe(secrete) };
}

/** La cle publique (base58) qui correspond a une cle secrete. */
export function publiqueDe(secrete) {
  const der = clePrivee(secrete);
  const pub = createPublicKey(der).export({ type: 'spki', format: 'der' });
  return bs58.encode(pub.subarray(pub.length - 32));
}

/**
 * La forme CANONIQUE d'un objet : cles triees, sans espace, recursivement.
 *
 * `JSON.stringify` seul depend de l'ordre d'insertion des proprietes, donc du code qui a
 * construit l'objet. Deux programmes qui decrivent le meme resultat produiraient deux
 * chaines, donc deux signatures. Trier rend la forme unique — c'est la seule facon de
 * signer un objet plutot qu'un texte.
 */
export function canonique(valeur) {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur);
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(',')}]`;
  const cles = Object.keys(valeur).filter((k) => valeur[k] !== undefined).sort();
  return `{${cles.map((k) => `${JSON.stringify(k)}:${canonique(valeur[k])}`).join(',')}}`;
}

/** Signe un objet. Rend la signature en base58. */
export function signer(objet, secrete) {
  return bs58.encode(sign(null, Buffer.from(canonique(objet), 'utf8'), clePrivee(secrete)));
}

/** Verifie la signature d'un objet. Ne jette jamais : une signature illisible est fausse. */
export function verifier(objet, signature, publique) {
  try {
    return verify(null, Buffer.from(canonique(objet), 'utf8'), clePublique(publique), Buffer.from(bs58.decode(signature)));
  } catch {
    return false;
  }
}

/**
 * Un message signe pret a partir : `{ corps, signature }`.
 *
 * L'horodatage est ajoute ICI, pas par l'appelant — pour qu'il soit impossible d'en
 * oublier un, et que tout message signe puisse etre refuse une fois vieux.
 */
export function sceller(corps, secrete) {
  const date = { ...corps, horodatage: new Date().toISOString() };
  return { corps: date, signature: signer(date, secrete) };
}

/**
 * Ouvre un message scelle : signature valide, ET recent.
 *
 * @returns {{ok: true, corps: object} | {ok: false, raison: string}}
 */
export function ouvrir({ corps, signature } = {}, publique, { fraicheurMs = 5 * 60 * 1000, maintenant = Date.now() } = {}) {
  if (!corps || typeof corps !== 'object' || typeof signature !== 'string') {
    return { ok: false, raison: 'MESSAGE_ILLISIBLE' };
  }
  if (!verifier(corps, signature, publique)) return { ok: false, raison: 'SIGNATURE_INVALIDE' };
  const age = maintenant - Date.parse(corps.horodatage ?? '');
  if (!(age >= -60_000 && age <= fraicheurMs)) return { ok: false, raison: 'MESSAGE_PERIME' };
  return { ok: true, corps };
}
