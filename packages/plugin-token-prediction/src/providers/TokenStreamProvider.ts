// import WebSocket from "ws";
// import { elizaLogger } from "@ai16z/eliza";
// import { EventEmitter } from "events";
// import { IAgentRuntime } from "@ai16z/eliza";
// import { TokenUpdateEvent, TokenData } from "../types"; // Adjust path as needed

// export class TokenStreamProvider extends EventEmitter {
//   private ws: WebSocket | null = null;
//   private heartbeatInterval: NodeJS.Timeout | null = null;
//   private reconnectTimeout: NodeJS.Timeout | null = null;
//   private isConnected: boolean = false;
//   private reconnectAttempts: number = 0;
//   private maxReconnectAttempts: number = 10; // Increased from 5

//   constructor(private url: string, private apiKey: string, private runtime: IAgentRuntime) {
//     super();
//     this.connect(); // Start connection immediately
//   }

//   private setupHeartbeat(): void {
//     if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
//     this.heartbeatInterval = setInterval(() => {
//       if (this.ws?.readyState === WebSocket.OPEN) {
//         elizaLogger.info("Sending heartbeat...");
//         this.ws.send(
//           JSON.stringify({
//             type: "heartbeat",
//             topic: "phoenix",
//             event: "heartbeat",
//             payload: {},
//             ref: Date.now(),
//           })
//         );
//       } else {
//         elizaLogger.warn("Heartbeat failed - WebSocket not open. State:", {
//           state: this.ws?.readyState,
//         });
//         this.reconnect(); // Trigger reconnect if heartbeat fails
//       }
//     }, 30000); // Every 30s
//   }

//   private clearHeartbeat(): void {
//     if (this.heartbeatInterval) {
//       clearInterval(this.heartbeatInterval);
//       this.heartbeatInterval = null;
//     }
//   }

//   private clearReconnectTimeout(): void {
//     if (this.reconnectTimeout) {
//       clearTimeout(this.reconnectTimeout);
//       this.reconnectTimeout = null;
//     }
//   }

//   connect(): void {
//     if (this.isConnected) {
//       elizaLogger.warn("Already connected to Supabase");
//       return;
//     }

//     if (this.reconnectAttempts >= this.maxReconnectAttempts) {
//       elizaLogger.error("Max reconnection attempts reached. Token stream offline.");
//       this.emit("streamOffline"); // Notify listeners of permanent failure
//       return;
//     }

//     const wsUrl = new URL(`${this.url}/realtime/v1`);
//     wsUrl.searchParams.set("apikey", this.apiKey);
//     wsUrl.searchParams.set("vsn", "1.0.0");

//     elizaLogger.info("Attempting to connect to Supabase:", wsUrl.toString());
//     this.ws = new WebSocket(wsUrl.toString());

//     this.ws.onopen = () => {
//       this.isConnected = true;
//       this.reconnectAttempts = 0;
//       elizaLogger.info("WebSocket connected");
//       this.setupHeartbeat();
//       this.subscribeToUpdates();
//     };

//     this.ws.onmessage = async (event) => {
//       try {
//         const data = JSON.parse(event.data.toString());
//         elizaLogger.info("Received WebSocket message...");

//         if (data.type === "phx_reply" && data.event === "phx_join") {
//           elizaLogger.info("Successfully joined channel:", data);
//         } else if (data.type === "phx_reply" && data.event === "heartbeat") {
//           elizaLogger.info("Heartbeat reply received:", data);
//         }

//         if (data.type === "phx_error" || data.type === "phx_close") {
//           elizaLogger.error("Channel error or close:", data);
//           this.reconnect();
//         }

//         if (data.event === "postgres_changes") {
//           const change = data.payload?.data;
//           if (!change) {
//             elizaLogger.warn("Received empty change data");
//             return;
//           }

//           if (change.type === "UPDATE" && change.record?.processing_stage === "completed") {
//             const tokenId = change.record.token_id;
//             const address = change.record.mint;
//             const symbol = change.record.symbol || "UNKNOWN";


//             if (!address || !this.isValidSolanaAddress(address)) {
//               elizaLogger.warn("Invalid Solana address, skipping:", {
//                 tokenId,
//                 address,
//                 symbol
//               });
//               return;
//             }

//             if (change.record.status === "dead") {
//               elizaLogger.info("Skipping token with status 'dead':", { tokenId, address });
//               return;
//             }

//              // Construct enriched TokenData
//         const tokenData: TokenData = {
//             tokenId,
//             address,
//             symbol: change.record.symbol || "UNKNOWN",
//             name: change.record.name || "Unknown Token",
//             description: change.record.description || "",
//             createdAt: change.record.inception_datetime || "",
//             status: change.record.status || "unknown",
//             marketCap: change.record.market_cap || 0,
//             uniqueHolders: change.record.unique_holders || 0,
//             pairCreatedAt: change.record.pair_created_at || "",
//             top10Percentage: change.record.top_10_percentage || 0,
//             pumpfunTop10HoldersPercentage: change.record.pumpfun_top_10_holders_percentage || 0,
//             ogHoldersPercentage: change.record.og_holders_percentage || 0,
//             pumpfunTotalVolumeSol: change.record.pumpfun_total_volume_sol || 0,
//             pumpfunTotalTransactions: change.record.pumpfun_total_transactions || 0,
//             pumpfunUniqueTraders: change.record.pumpfun_unique_traders || 0,
//             pumpfunReplyCount: change.record.pumpfun_reply_count || 0,
//             numberOfBundles: change.record.number_of_bundles || 0,
//             bundleMaxPercentHeld: change.record.bundle_max_percent_held || 0,
//             numberOfBots: change.record.number_of_bots || 0,
//             devTokenPercentage: change.record.dev_token_percentage || 0,
//         };

//         elizaLogger.info("Raw Supabase record:", {
//             record: change.record,
//             token_info: change.record.token_info,
//             market_data: change.record.market_data,
//             holder_distribution: change.record.holder_distribution,
//             trading_activity: change.record.trading_activity,
//             bundle_info: change.record.bundle_info,
//             developer_info: change.record.developer_info
//         });

//         elizaLogger.info("Constructed token data with all fields:", { tokenData });

//         const tokenUpdate: TokenUpdateEvent = {
//             tokenData,
//             timestamp: change.commit_timestamp,
//         };
//               this.emit("tokenUpdate", tokenUpdate.tokenData);
//               elizaLogger.info("Token update emitted:", {
//                 ...tokenData,
//                 timestamp: change.commit_timestamp,
//               });
//             }
//         }
//       } catch (error: any) {
//         elizaLogger.error("Error processing WebSocket message:", {
//           error: error?.message || "Unknown error",
//           data: event.data.toString(),
//         });
//       }
//     };

//     this.ws.onclose = (event) => {
//       this.isConnected = false;
//       elizaLogger.warn("WebSocket connection closed:", {
//         code: event.code,
//         reason: event.reason || "No reason provided",
//         wasClean: event.wasClean,
//         state: this.ws?.readyState,
//         reconnectAttempts: this.reconnectAttempts,
//       });
//       this.clearHeartbeat();
//       this.reconnect();
//     };

//     this.ws.onerror = (error) => {
//       elizaLogger.error("WebSocket error:", {
//         error,
//         state: this.ws?.readyState,
//         connected: this.isConnected,
//       });
//     };
//   }

//   private reconnect(): void {
//     if (this.reconnectAttempts >= this.maxReconnectAttempts) {
//       elizaLogger.error("Max reconnection attempts reached. Token stream offline.");
//       this.emit("streamOffline");
//       return;
//     }

//     this.reconnectAttempts++;
//     const reconnectDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
//     elizaLogger.info("Planning reconnection:", {
//       attempt: this.reconnectAttempts,
//       maxAttempts: this.maxReconnectAttempts,
//       delayMs: reconnectDelay,
//     });

//     this.clearReconnectTimeout();
//     this.reconnectTimeout = setTimeout(() => {
//       if (!this.isConnected) {
//         if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
//           this.ws.close(); // Force close if not already closed
//         }
//         this.ws = null; // Reset to allow fresh connection
//         elizaLogger.info("Attempting to reconnect...");
//         this.connect();
//       } else {
//         elizaLogger.info("Reconnection skipped - already connected");
//       }
//     }, reconnectDelay);
//   }

//   private subscribeToUpdates(): void {
//     if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
//       elizaLogger.error("Cannot subscribe: WebSocket is not open");
//       return;
//     }

//     const subscription = {
//       type: "phx_join",
//       topic: "realtime:public:new_tokens",
//       event: "phx_join",
//       payload: {
//         config: { postgres_changes: [{ event: "UPDATE", schema: "public", table: "new_tokens" }] },
//       },
//       ref: Date.now().toString(),
//     };

//     try {
//       elizaLogger.info("Sending subscription request...");
//       this.ws.send(JSON.stringify(subscription));
//       elizaLogger.info("Subscription request sent");
//     } catch (error) {
//       elizaLogger.error("Failed to send subscription request:", error);
//     }
//   }

//   disconnect(): void {
//     this.clearHeartbeat();
//     this.clearReconnectTimeout();
//     if (this.ws) {
//       this.ws.close();
//       this.ws = null;
//     }
//     this.isConnected = false;
//     this.reconnectAttempts = 0; // Reset attempts on manual disconnect
//     elizaLogger.info("Disconnected from Supabase");
//   }

//   // Optional: Expose connection status for external monitoring
//   public getConnectionStatus(): { isConnected: boolean; reconnectAttempts: number } {
//     return { isConnected: this.isConnected, reconnectAttempts: this.reconnectAttempts };
//   }

//   private isValidSolanaAddress(address: string): boolean {
//     return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
//   }
// }