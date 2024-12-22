export * from "./providers/token.ts";
export * from "./providers/wallet.ts";
export * from "./providers/trustScoreProvider.ts";
export * from "./evaluators/trust.ts";

import { Plugin, IAgentRuntime } from "@ai16z/eliza";
import { executeSwap } from "./actions/swap.ts";
import take_order from "./actions/takeOrder";
import pumpfun from "./actions/pumpfun.ts";
import { executeSwapForDAO } from "./actions/swapDao";
import transferToken from "./actions/transfer.ts";
import { walletProvider } from "./providers/wallet.ts";
import { trustScoreProvider } from "./providers/trustScoreProvider.ts";
import { trustEvaluator } from "./evaluators/trust.ts";
import { TokenProvider } from "./providers/token.ts";
import { WalletProvider } from "./providers/wallet.ts";
import { elizaLogger } from "@ai16z/eliza";

export { TokenProvider, WalletProvider };

elizaLogger.info("[Solana Plugin] Initializing with providers:", ["walletProvider", "trustScoreProvider", "pumpFunMessageProvider", "tokenAnalyzer"]);

export const solanaPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin for Eliza",
    actions: [
        executeSwap,
        pumpfun,
        transferToken,
        executeSwapForDAO,
        take_order,
    ],
    evaluators: [trustEvaluator],
    providers: [walletProvider, trustScoreProvider],
};

export default solanaPlugin;
