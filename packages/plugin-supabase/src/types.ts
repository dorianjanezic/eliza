export interface TokenUpdate {
    record: {
        id: string;
        processing_stage: string;
        [key: string]: any;
    };
    oldRecord?: {
        id: string;
        processing_stage: string;
        [key: string]: any;
    };
    timestamp: string;
}

export interface ProcessedTokenAnalysis {
    summary: string;
    metrics: {
        [key: string]: any;
    };
    insights: string[];
    patterns: string[];
}

export interface TokenProcessingResult {
    tokenId: string;
    analysis: ProcessedTokenAnalysis;
    timestamp: string;
}