/**
 * ABI codec for the two structs HongbaoGame.sol exchanges with the host.
 *
 * Both are static tuples, so they encode as plain 32-byte words — no dynamic
 * offsets, no library needed. Keeping this hand-rolled means the game frontend
 * ships with zero runtime dependencies beyond the SDK bridge itself.
 *
 *   HongbaoState { uint256 pot; uint256 remaining; uint256 banked; uint8 opened; }
 *   OpenAction   { bool keep; }
 */

const WORD = 64; // 32 bytes as hex characters

function words(hex) {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = [];
  for (let i = 0; i + WORD <= body.length; i += WORD) out.push(body.slice(i, i + WORD));
  return out;
}

/** Decode `abi.encode(HongbaoState)` as returned in `session.raw.gameState`. */
export function decodeState(hex) {
  const w = words(hex);
  if (w.length < 4) return null;
  return {
    pot: BigInt("0x" + w[0]),
    remaining: BigInt("0x" + w[1]),
    banked: BigInt("0x" + w[2]),
    opened: Number(BigInt("0x" + w[3])),
  };
}

function boolWord(value) {
  return "0x" + (value ? "1" : "0").padStart(WORD, "0");
}

/** `abi.encode(OpenAction({keep: false}))` — open the next envelope. */
export function encodeOpen() {
  return boolWord(false);
}

/** `abi.encode(OpenAction({keep: true}))` — bank the grabs and settle. */
export function encodeKeep() {
  return boolWord(true);
}
