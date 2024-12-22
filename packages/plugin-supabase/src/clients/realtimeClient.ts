import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { TokenUpdate } from '../types';
import { TokenProcessingClient } from './tokenProcessingClient';
import { elizaLogger } from '@ai16z/eliza';

export class TokenUpdateClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isConnected: boolean = false;

    constructor(
        private url: string,
        private apiKey: string
    ) {
        super();
    }


    private setupHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, 30000);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    connect(): void {
        if (this.isConnected) {
            elizaLogger.warn('Already connected to Supabase');
            return;
        }

        const wsUrl = new URL(`${this.url}/realtime/v1`);
        wsUrl.searchParams.set('apikey', this.apiKey);
        wsUrl.searchParams.set('vsn', '1.0.0');

        elizaLogger.info('Attempting to connect to Supabase:', wsUrl.toString());

        this.ws = new WebSocket(wsUrl.toString());

        this.ws.onopen = () => {
            this.isConnected = true;
            elizaLogger.info('Connected to Supabase WebSocket');
            elizaLogger.debug('WebSocket state:', this.ws?.readyState);
            this.setupHeartbeat();
            this.subscribeToUpdates();
        };

        this.ws.onmessage = (event) => {
            elizaLogger.debug('WebSocket message received:', event.data.toString());
            try {
                const data = JSON.parse(event.data.toString());

                if (data.event === 'postgres_changes') {
                    const change = data.payload?.data;

                    if (!change) {
                        elizaLogger.warn('Received empty change data');
                        return;
                    }

                    elizaLogger.info('Received database change:', {
                        type: change.type,
                        table: change.table,
                        schema: change.schema,
                        processing_stage: change.record?.processing_stage
                    });

                    if (change.type === 'UPDATE' && change.record?.processing_stage === 'completed') {
                        const tokenUpdate: TokenUpdate = {
                            record: change.record,
                            oldRecord: change.old_record,
                            timestamp: change.commit_timestamp
                        };

                        elizaLogger.info('Emitting token update:', {
                            tokenId: change.record.id,
                            stage: change.record.processing_stage,
                            record: change.record
                        });

                        this.emit('tokenUpdate', tokenUpdate);
                    }
                }
            } catch (error: any) {
                elizaLogger.error('Error processing WebSocket message:', {
                    error: error?.message || 'Unknown error',
                    data: event.data.toString()
                });
            }
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this.clearHeartbeat();
            elizaLogger.warn('Supabase connection closed, attempting to reconnect...');

            // Implement exponential backoff
            const reconnectDelay = 5000;
            this.clearReconnectTimeout();
            this.reconnectTimeout = setTimeout(() => this.connect(), reconnectDelay);
        };

        this.ws.onerror = (error) => {
            elizaLogger.error('WebSocket error:', error);
        };
    }

    private subscribeToUpdates(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            elizaLogger.error('Cannot subscribe: WebSocket is not open');
            return;
        }

        const subscription = {
            type: 'phx_join',
            topic: 'realtime:public:new_tokens',
            event: 'phx_join',
            payload: {
                config: {
                    postgres_changes: [{
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'new_tokens'
                    }]
                }
            },
            ref: Date.now()
        };

        try {
            this.ws.send(JSON.stringify(subscription));
            elizaLogger.info('Subscribed to token updates');
        } catch (error) {
            elizaLogger.error('Failed to subscribe to updates:', error);
        }
    }

    disconnect(): void {
        this.clearHeartbeat();
        this.clearReconnectTimeout();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        elizaLogger.info('Disconnected from Supabase');
    }
}

// Singleton instance
let supabaseClientInstance: SupabaseClientWrapper | null = null;

export class SupabaseClientWrapper {
    private client: TokenUpdateClient;
    private processingClient: TokenProcessingClient;
    private initialized: boolean = false;

    private constructor(private runtime: any) {
        this.processingClient = new TokenProcessingClient(runtime);

        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error('Missing Supabase credentials in environment variables');
        }

        this.client = new TokenUpdateClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY
        );

        this.client.on('tokenUpdate', async (update: TokenUpdate) => {
            elizaLogger.info('Token update received:', {
                tokenId: update.record.id,
                timestamp: update.timestamp
            });

            try {
                await this.processingClient.processTokenUpdate(update);
            } catch (error) {
                elizaLogger.error('Failed to process token update:', error);
            }
        });
    }

    static getInstance(runtime: any): SupabaseClientWrapper {
        if (!supabaseClientInstance) {
            supabaseClientInstance = new SupabaseClientWrapper(runtime);
        }
        return supabaseClientInstance;
    }

    async start(): Promise<void> {
        if (this.initialized) {
            elizaLogger.warn('SupabaseClientWrapper already initialized');
            return;
        }

        this.client.connect();
        this.initialized = true;
        elizaLogger.info('SupabaseClientWrapper initialized');
    }

    async stop(): Promise<void> {
        this.client.disconnect();
        this.initialized = false;
        elizaLogger.info('SupabaseClientWrapper stopped');
    }
}