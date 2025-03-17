export interface BundleInfo {
    bundle_analysis: {
        category_breakdown: {
            new_wallet: number;
            regular: number;
            sniper: number;
        };
        primary_category: string;
    };
    holding_amount: number;
    holding_percentage: number;
    token_percentage: number;
    total_sol: number;
    total_tokens: number;
    unique_wallets: number;
}

export interface TrenchBundleResponse {
    success: boolean;
    data?: {
        total_bundles: number;
        total_sol_spent: number;
        total_holding_percentage: number;
        total_percentage_bundled: number;
        bundles: { [key: string]: BundleInfo };
        creator_analysis: {
            address: string;
            current_holdings: number;
            history: {
                average_market_cap: number;
                high_risk: boolean;
                previous_coins: Array<{
                    created_at: number;
                    is_rug: boolean;
                    market_cap: number;
                    mint: string;
                    symbol: string;
                }>;
                recent_rugs: number;
                rug_count: number;
                rug_percentage: number;
                total_coins_created: number;
            };
            holding_percentage: number;
            risk_level: string;
            warning_flags: (string | null)[];
        };
    };
    error?: string;
}