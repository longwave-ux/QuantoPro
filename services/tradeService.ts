import { TradeSetup } from '../types';

export interface TradeResponse {
    success: boolean;
    orderId?: string;
    message?: string;
}

export const executeLimitOrder = async (
    symbol: string, 
    setup: TradeSetup, 
    investmentAmountUsd: number,
    exchange: 'MEXC' | 'HYPERLIQUID' = 'MEXC'
): Promise<TradeResponse> => {
    
    // 1. Calculate Quantity
    // Logic: Quantity = USD Amount / Entry Price
    // We apply a rough precision fix (4 decimals) to avoid scientific notation, 
    // though real exchanges need specific stepSizes.
    const quantity = (investmentAmountUsd / setup.entry).toFixed(4);
    const endpoint = exchange === 'HYPERLIQUID' ? '/api/trade/hyperliquid' : '/api/trade/mexc';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                symbol: symbol,
                side: setup.side === 'LONG' ? 'BUY' : 'SELL',
                type: 'LIMIT',
                quantity: quantity,
                price: setup.entry.toFixed(4) // Ensure string format for API
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return { 
                success: false, 
                message: data.msg || data.error || 'Unknown Exchange Error' 
            };
        }

        return {
            success: true,
            orderId: data.orderId,
            message: exchange === 'HYPERLIQUID' ? data.message : 'Limit Order Placed Successfully'
        };

    } catch (error: any) {
        return {
            success: false,
            message: error.message || 'Network Error'
        };
    }
};

export const executeMexcLimitOrder = (s: string, st: TradeSetup, a: number) => executeLimitOrder(s, st, a, 'MEXC');