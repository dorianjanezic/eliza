import type { UUID } from '@ai16z/eliza';
import type { TokenData, TokenPrediction } from './index';

export interface PredictionMemory {
    id: UUID;
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    content: {
        text: string;
        metadata: {
            analysis: {
                token_details: {
                    address: string;
                    [key: string]: any;
                };
                prediction: TokenPrediction;
                [key: string]: any;
            };
            originalToken: TokenData;
            [key: string]: any;
        };
    };
    createdAt: number;
}