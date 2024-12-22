import { Provider, IAgentRuntime, Memory, State } from '@ai16z/eliza';
import { SupabaseClientWrapper } from '../clients/realtimeClient';
import { elizaLogger } from '@ai16z/eliza';

export const tokenProvider: Provider = {
    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string> => {
        try {
            const client = SupabaseClientWrapper.getInstance(runtime);
            await client.start();

            return "Supabase token provider initialized and listening for updates";
        } catch (error) {
            elizaLogger.error('Error initializing Supabase token provider:', error);
            return "Failed to initialize Supabase token provider";
        }
    },
};