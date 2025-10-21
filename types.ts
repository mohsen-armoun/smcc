import { Time } from 'lightweight-charts';

export interface Candle {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SwingPoint {
    time: Time;
    price: number;
    type: 'high' | 'low';
    confirmationTime: Time;
}

export interface BOS {
    time: Time;
    price: number;
}

export interface POI {
    startTime: Time;
    endTime: Time;
    top: number;
    bottom: number;
    confirmationTime: Time;
}

export interface CHoCH {
    time: Time;
    price: number;
}

export interface Drawing {
    type: 'BOS' | 'POI' | 'CHoCH';
    data: any;
}

export interface TradeSignal {
    entryTime: Time;
    triggerTime: Time; // The time the signal was confirmed (e.g., CHoCH time)
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    type: 'Bullish' | 'Bearish';
}

export interface ExecutedTrade {
    signalTime: Time;
    entryTime: Time | null;
    exitTime: Time | null;
    entryPrice: number;
    exitPrice: number | null;
    outcome: 'Win' | 'Loss' | 'Open';
    pnl: number;
    equity: number;
    type: 'Bullish' | 'Bearish';
    slPrice: number;
    tpPrice: number;
    returnOnEquityPercent: number;
    leverage: number;
}

export interface BacktestResults {
    trades: ExecutedTrade[];
    maxDrawdown: number;
    maxDrawdownAmount: number;
    netProfitPercent: number;
    winRate: number;
    profitFactor: number;
    finalEquity: number;
    totalTrades: number;
}

export interface SMCAnalysisResult {
    trades: TradeSignal[];
    drawings: Drawing[];
}

export interface ChartData {
    htf: Candle[];
    mtf: Candle[];
    ltf: Candle[];
}

// FIX: Moved Optimizer types before Settings to allow nesting.
// --- Optimizer Types ---
export interface OptimizerParameter {
    enabled: boolean;
    start: number;
    end: number;
    step: number;
}

export interface OptimizerSettings {
    htfSwingLookback: OptimizerParameter;
    ltfChochLookback: OptimizerParameter;
    discountZone: OptimizerParameter;
    rrRatio: OptimizerParameter;
    targetMetric: keyof BacktestResults;
}

export interface Settings {
    // New setting to differentiate between Crypto and Forex
    marketType: 'crypto' | 'forex';
    dataSource: string;
    symbol: string;
    startDate: string;
    endDate: string;
    useProxy: boolean;
    theme: 'dark' | 'light';
    timezone: string;
    // Timeframe settings
    htfInterval: string;
    mtfInterval: string;
    ltfInterval: string;
    // New setting for entry model
    entryModel: 'structure_poi' | 'liquidity_sweep';
    // SMC parameters
    htfSwingLookback: number;
    ltfChochLookback: number;
    discountZone: number; // e.g., 0.5 for 50%
    // Liquidity Target settings for the new model
    usePdlPdhLiquidity: boolean;
    useAsianRange: boolean;
    asianStartTime: string; // "HH:MM" format
    asianEndTime: string;   // "HH:MM" format
    useVolumeInflowFilter: boolean;
    volumeLookbackPeriod: number;
    volumeMultiplier: number;
    useFvgFilter: boolean; // For POI model
    useLiquiditySweepFvgFilter: boolean; // For Liquidity Sweep model
    useAiStopLoss: boolean;
    useAiTakeProfit: boolean;
    useLiquiditySweepFilter: boolean;
    useConfluenceFilter: boolean;
    confluenceProximityPercent: number; // e.g., 0.05 for 5%
    useMtfCandlestickFilter: boolean;
    mtfCandlestickPatterns: string[];
    useLtfCandlestickFilter: boolean;
    ltfCandlestickPatterns: string[];
    useAdxFilter: boolean;
    adxPeriod: number;
    adxThreshold: number;
    // Backtest parameters
    initialCapital: number;
    orderSizePercent: number;
    rrRatio: number;
    commissionPercent: number;
    filterByCommission: boolean;
    slType: 'structure' | 'previous_structure' | 'fixed' | 'atr' | 'order_block' | 'fvg';
    slBufferPercent: number;
    fixedSlValue: number;
    atrPeriod: number;
    atrMultiplier: number;
    leverage: number;
    leverageType: 'fixed' | 'dynamic';
    useMaxDailyLossesFilter: boolean;
    maxDailyLosses: number;
    useMaxConsecutiveLossesFilter: boolean;
    maxConsecutiveLosses: number;
    maxSignalAgeCandles: number;
    // Automation
    signalOnCandleClose: boolean;
    // Other
    telegramEnabled: boolean;
    telegramToken: string;
    telegramChatId: string;
    discordEnabled: boolean;
    discordWebhookUrl: string;
    // Exchange Integration
    orderExecutionExchange: 'none' | 'coinex' | 'binance';
    coinexAccessId: string;
    coinexSecretKey: string;
    useCoinExTestnet: boolean;
    binanceAccessId: string;
    binanceSecretKey: string;
    useBinanceTestnet: boolean;
    // FIX: Added optimizerSettings to the Settings interface.
    optimizerSettings: OptimizerSettings;
}

export interface OrderStatus {
    id: string;
    symbol: string;
    type: 'Bullish' | 'Bearish';
    status: 'sending' | 'success' | 'error';
    message: string;
    timestamp: number;
}

export interface OptimizationResultRow {
    params: Partial<Settings>;
    results: BacktestResults;
    id: number;
}

export interface OptimizationResults {
    runs: OptimizationResultRow[];
    bestRun: OptimizationResultRow | null;
}