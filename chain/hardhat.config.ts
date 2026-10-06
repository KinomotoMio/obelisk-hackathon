import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// BOT Chain documents Cancun as its EVM target; compile and simulate against
// the same fork so local tests exercise the opcodes the real chain accepts.
const EVM = "cancun";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: EVM,
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // In-process simulated chain. `default` is what `hardhat test` uses;
    // `hardhat` is an explicit alias so `--network hardhat` works for deploys.
    default: { type: "edr-simulated", chainType: "l1", hardfork: EVM },
    hardhat: { type: "edr-simulated", chainType: "l1", hardfork: EVM },
    // The deployer key is a configuration variable: resolved only when one of
    // these networks is actually used, so tests run without it. Supply it as
    // the BOT_DEPLOYER_PRIVATE_KEY environment variable or store it with
    // `npx hardhat keystore set BOT_DEPLOYER_PRIVATE_KEY`.
    botTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 968,
      url: "https://rpc.bohr.life",
      accounts: [configVariable("BOT_DEPLOYER_PRIVATE_KEY")],
    },
    botMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 677,
      url: "https://rpc.botchain.ai",
      accounts: [configVariable("BOT_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
