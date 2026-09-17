const solc = require("/home/hashino/Projects/arc-metered-channel/node_modules/solc");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "contracts/HongbaoGame.sol"), "utf8");
const findImport = p => ({ contents: fs.readFileSync(path.join(ROOT, p), "utf8") });
const input = {
  language: "Solidity",
  sources: { "HongbaoGame.sol": { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errs = (out.errors || []).filter(e => e.severity === "error");
if (errs.length) { errs.forEach(e => console.log(e.formattedMessage)); process.exit(1); }
(out.errors || []).forEach(e => console.log("warn:", e.formattedMessage.slice(0, 160)));
const c = out.contracts["HongbaoGame.sol"].HongbaoGame;
console.log("OK bytecode:", c.evm.bytecode.object.length / 2, "bytes");
