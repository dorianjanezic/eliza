// src/memory.ts

import { IAgentRuntime, Memory, Content, UUID } from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { TokenUpdate } from "./types";

export async function createTokenCompletedMemory(
    runtime: IAgentRuntime,
    update: TokenUpdate,
    roomId: UUID
): Promise<Memory> {
    console.log('Creating token completed memory:', update);
    const { record, oldRecord, timestamp } = update;

    const content: Content = {
        text: `Token processing completed for token ID: ${record.id}`,
        source: "token_updates",
        metadata: {
            type: "token_completed",
            tokenId: record.id,
            timestamp
        }
    };

    const memory: Memory = {
        id: stringToUuid(`token-${record.id}-completed`),
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId,
        content,
        createdAt: Date.parse(timestamp)
    };

    return await runtime.messageManager.addEmbeddingToMemory(memory);
}