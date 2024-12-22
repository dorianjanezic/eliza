import { Plugin } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { tokenProvider } from "./providers/tokenProvider";
import { TokenUpdateClient, SupabaseClientWrapper } from "./clients/realtimeClient";
import { TokenProcessingClient } from "./clients/tokenProcessingClient";
import type { TokenUpdate, ProcessedTokenAnalysis, TokenProcessingResult } from "./types";

// Export types and classes for external use
export {
    TokenUpdateClient,
    SupabaseClientWrapper,
    TokenProcessingClient,
    TokenUpdate,
    ProcessedTokenAnalysis,
    TokenProcessingResult,
};

elizaLogger.info("[Supabase Plugin] Initializing with providers:", ["tokenProvider"]);

export const supabasePlugin: Plugin = {
    name: "supabase",
    description: "Supabase Plugin for Eliza - Handles token updates and processing",
    providers: [tokenProvider],
};

export default supabasePlugin;