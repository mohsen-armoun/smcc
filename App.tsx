
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, ChartData, SMCAnalysisResult, BacktestResults, OptimizerSettings, OptimizationResults, ExecutedTrade, TradeSignal, Candle, OrderStatus, Drawing } from './types';
import Controls from './components/Controls';
import ChartContainer, { ChartHandle } from './components/ChartContainer';
import ResultsPanel from './components/ResultsPanel';
import { 
    fetchAllData, analyzeSMC, runBacktest, runOptimizer, 
    sendTelegramNotification, sendOrderToCoinEx, fetchCurrentPrice,
    sendOrderToBinance, retry, resampleCandles, 
    fetchCandles, formatSignalTimestamp, getUTCOffset,
    intervalToSeconds, sendDiscordNotification, 
    broadcastNewSignal, broadcastTradeResult
} from './services/smcService';
import { Time } from 'lightweight-charts';
import * as xlsx from 'xlsx';


const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
};

const today = new Date();
const oneMonthAgo = new Date();
oneMonthAgo.setMonth(today.getMonth() - 1);

const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
    htfSwingLookback: { enabled: false, start: 3, end: 10, step: 1 },
    ltfChochLookback: { enabled: false, start: 2, end: 7, step: 1 },
    discountZone: { enabled: false, start: 0.4, end: 0.7, step: 0.1 },
    rrRatio: { enabled: false, start: 2, end: 5, step: 0.5 },
    targetMetric: 'netProfitPercent',
};

const DEFAULT_SETTINGS: Settings = {
    marketType: 'crypto',
    dataSource: 'binance',
    symbol: 'BTCUSDT.P',
    startDate: formatDate(oneMonthAgo),
    endDate: formatDate(today),
    useProxy: false,
    theme: 'dark',
    timezone: 'Asia/Tehran',
    htfInterval: '1h',
    mtfInterval: '15m',
    ltfInterval: '1m',
    entryModel: 'liquidity_sweep',
    htfSwingLookback: 5,
    ltfChochLookback: 3,
    discountZone: 0.5,
    usePdlPdhLiquidity: true,
    useAsianRange: true,
    asianStartTime: '00:00',
    asianEndTime: '08:00',
    useVolumeInflowFilter: true,
    volumeLookbackPeriod: 20,
    volumeMultiplier: 2,
    useFvgFilter: true,
    useLiquiditySweepFvgFilter: true,
    useAiStopLoss: false,
    useAiTakeProfit: false,
    useLiquiditySweepFilter: false,
    useConfluenceFilter: true,
    confluenceProximityPercent: 0.05,
    useMtfCandlestickFilter: false,
    mtfCandlestickPatterns: ['engulfing', 'hammer'],
    useLtfCandlestickFilter: false,
    ltfCandlestickPatterns: ['engulfing', 'hammer'],
    useAdxFilter: false,
    adxPeriod: 14,
    adxThreshold: 25,
    initialCapital: 200,
    orderSizePercent: 3,
    rrRatio: 4,
    commissionPercent: 0.03,
    filterByCommission: true,
    slType: 'structure',
    slBufferPercent: 0,
    fixedSlValue: 0.3,
    atrPeriod: 14,
    atrMultiplier: 2,
    leverage: 10,
    leverageType: 'dynamic',
    useMaxDailyLossesFilter: false,
    maxDailyLosses: 2,
    useMaxConsecutiveLossesFilter: false,
    maxConsecutiveLosses: 3,
    maxSignalAgeCandles: 5,
    signalOnCandleClose: true,
    telegramEnabled: true,
    telegramToken: '8236486211:AAG3VE9kCsmysgH5tJlI_bPehwWRag4D_T0',
    telegramChatId: '@masaud1363',
    discordEnabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/1416704982542979072/zyDL4cYWg1oLU6v8Yd9UtvzESDvHfUiFG6UciaguX6IRn2DQPdRvKBNCBkkgNHENV28L',
    orderExecutionExchange: 'coinex',
    coinexAccessId: '44C11C48D9D2441C966D1115DB87690C',
    coinexSecretKey: '98EB3F0BB502D364CD9F9FB4513AD55FF57196C7502F6C63',
    useCoinExTestnet: false,
    binanceAccessId: '',
    binanceSecretKey: '',
    useBinanceTestnet: false,
    optimizerSettings: DEFAULT_OPTIMIZER_SETTINGS,
};

const getSignalEventHash = (signal: TradeSignal) => `${signal.triggerTime}-${signal.type}-${signal.entryPrice.toFixed(5)}`;
const getTradeId = (trade: ExecutedTrade) => `${trade.signalTime}-${trade.type}-${trade.entryPrice.toFixed(5)}`;
const getDrawingKey = (d: Drawing) => {
    if (d.type === 'POI') return `${d.type}-${d.data.startTime}-${d.data.top}-${d.data.bottom}`;
    return `${d.type}-${d.data.time}-${d.data.price}`;
};

const calculateBacktestMetrics = (trades: ExecutedTrade[], initialCapital: number): Omit<BacktestResults, 'trades'> => {
    const closedTrades = trades.filter(t => t.outcome !== 'Open');
    const totalTrades = closedTrades.length;

    // Use the last trade's equity (open or closed) as the final equity. If no trades, use initial capital.
    const lastEquity = trades.length > 0 ? trades[trades.length - 1].equity : initialCapital;

    if (totalTrades === 0) {
        return { 
            maxDrawdown: 0, 
            maxDrawdownAmount: 0, 
            netProfitPercent: ((lastEquity - initialCapital) / initialCapital) * 100, 
            winRate: 0, 
            profitFactor: 0, 
            finalEquity: lastEquity, 
            totalTrades: 0 
        };
    }

    let peakEquity = initialCapital;
    let maxDrawdown = 0;
    let maxDrawdownAmount = 0;
    
    // Calculate drawdown based on the full equity curve (all trades)
    trades.forEach(trade => {
        const equityAfterTrade = trade.equity;
        if (equityAfterTrade > peakEquity) {
            peakEquity = equityAfterTrade;
        }
        const drawdown = peakEquity > 0 ? ((peakEquity - equityAfterTrade) / peakEquity) * 100 : 0;
        const drawdownAmount = peakEquity - equityAfterTrade;

        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
        if (drawdownAmount > maxDrawdownAmount) {
            maxDrawdownAmount = drawdownAmount;
        }
    });

    const finalEquity = lastEquity;
    
    const wins = closedTrades.filter(t => t.outcome === 'Win').length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const netProfitPercent = initialCapital > 0 ? ((finalEquity - initialCapital) / initialCapital) * 100 : 0;

    const totalWinPnl = closedTrades.filter(t => t.outcome === 'Win').reduce((sum, t) => sum + t.pnl, 0);
    const totalLossPnl = Math.abs(closedTrades.filter(t => t.outcome === 'Loss').reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : Infinity;

    return {
        maxDrawdown,
        maxDrawdownAmount,
        netProfitPercent,
        winRate,
        profitFactor,
        finalEquity,
        totalTrades
    };
}


const App: React.FC = () => {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [draftSettings, setDraftSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [chartData, setChartData] = useState<ChartData | null>(null);
    const [analysisData, setAnalysisData] = useState<ChartData | null>(null);

    const [smcResult, setSMCResult] = useState<SMCAnalysisResult | null>(null);
    const [initialSmcResult, setInitialSmcResult] = useState<SMCAnalysisResult | null>(null);
    const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null);
    const [initialBacktestResults, setInitialBacktestResults] = useState<BacktestResults | null>(null);
    const [optimizerResults, setOptimizerResults] = useState<OptimizationResults | null>(null);
    const [isOptimizing, setIsOptimizing] = useState(false);
    
    const [isReplayMode, setIsReplayMode] = useState(false);
    const [isWaitingForReplayStart, setIsWaitingForReplayStart] = useState(false);
    const [replayCandleData, setReplayCandleData] = useState<Candle[]>([]);
    const [replayIndex, setReplayIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [replaySpeedMultiplier, setReplaySpeedMultiplier] = useState(1);
    
    const [isLiveMode, setIsLiveMode] = useState(false);
    const [orderStatuses, setOrderStatuses] = useState<OrderStatus[]>([]);

    const [forexData, setForexData] = useState<{ ask: Candle[], bid: Candle[] } | null>(null);
    
    const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
    const [resultsPanelHeight, setResultsPanelHeight] = useState(300);

    const chartHandle = useRef<ChartHandle>(null);
    const liveSignalHashesRef = useRef<Set<string>>(new Set());
    const smcResultRef = useRef<SMCAnalysisResult | null>(null);
    
    // Store the full, raw data history for live analysis
    const fullLiveLtfDataRef = useRef<Candle[]>([]);

    const settingsRef = useRef(settings);
    const isLiveModeRef = useRef(isLiveMode);
    const backtestResultsRef = useRef(backtestResults);
    const updateLiveDataRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const isUpdatingLiveRef = useRef(false);

    useEffect(() => { settingsRef.current = settings; }, [settings]);
    useEffect(() => { isLiveModeRef.current = isLiveMode; }, [isLiveMode]);
    useEffect(() => { backtestResultsRef.current = backtestResults; }, [backtestResults]);
    useEffect(() => { smcResultRef.current = smcResult; }, [smcResult]);


    const handleDraftSettingsChange = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        setDraftSettings(prev => ({ ...prev, [key]: value }));
    }, []);
    
    const handleToggleControlsCollapse = useCallback(() => {
        setIsControlsCollapsed(prev => !prev);
    }, []);

    const handleResultsPanelHeightChange = useCallback((newHeight: number) => {
        setResultsPanelHeight(newHeight);
    }, []);

    const handleApplySettings = useCallback(() => {
        setSettings(draftSettings);
    }, [draftSettings]);

    useEffect(() => {
        let dataToProcess: ChartData | null = null;
        if (settings.marketType === 'forex' && forexData) {
            const start = new Date(settings.startDate);
            start.setDate(start.getDate() - 1);
            const startDate = start.getTime();
            const end = new Date(settings.endDate);
            end.setHours(23, 59, 59, 999);
            const endDate = end.getTime();
            const filteredAsk = forexData.ask.filter(c => (c.time as number) * 1000 >= startDate && (c.time as number) * 1000 <= endDate);
            if(filteredAsk.length === 0) {
                setError("No data available in the uploaded file for the selected date range.");
                setAnalysisData({ htf: [], mtf: [], ltf: [] });
                setBacktestResults(null);
                setSMCResult(null);
                return;
            }
            dataToProcess = {
                htf: resampleCandles(filteredAsk, intervalToSeconds(settings.htfInterval)),
                mtf: resampleCandles(filteredAsk, intervalToSeconds(settings.mtfInterval)),
                ltf: resampleCandles(filteredAsk, intervalToSeconds(settings.ltfInterval)),
            };
        } else if (settings.marketType === 'crypto' && chartData) {
            dataToProcess = chartData;
        }

        if (dataToProcess && settings) {
            const run = async () => {
                setIsLoading(true);
                setError(null);
                try {
                    const analysis = await analyzeSMC(dataToProcess!, settings);
                    setSMCResult(analysis);

                    const userStartDate = new Date(settings.startDate).getTime();

                    const displayData: ChartData = {
                        htf: dataToProcess!.htf.filter(c => (c.time as number) * 1000 >= userStartDate),
                        mtf: dataToProcess!.mtf.filter(c => (c.time as number) * 1000 >= userStartDate),
                        ltf: dataToProcess!.ltf.filter(c => (c.time as number) * 1000 >= userStartDate),
                    };
                    setAnalysisData(displayData);

                    const backtestLtfData = dataToProcess!.ltf.filter(c => (c.time as number) * 1000 >= userStartDate);
                    
                    let bidAskForBacktest;
                    if (settings.marketType === 'forex' && forexData) {
                         bidAskForBacktest = {
                            ask: forexData.ask.filter(c => (c.time as number) * 1000 >= userStartDate),
                            bid: forexData.bid.filter(c => (c.time as number) * 1000 >= userStartDate),
                         }
                    }

                    const backtest = runBacktest(backtestLtfData, analysis.trades, settings, undefined, bidAskForBacktest);
                    setBacktestResults(backtest);
                } catch (e: any) {
                    setError(e.message);
                    console.error("Analysis or Backtest failed:", e);
                } finally {
                    setIsLoading(false);
                }
            };
            run();
        }
    }, [chartData, settings, forexData]);

    const handleRun = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setOptimizerResults(null);
        setForexData(null);
        setChartData(null);
        setAnalysisData(null);
        setBacktestResults(null);

        try {
            const data = await fetchAllData(settings);
            setChartData(data);
        } catch (e: any) {
            setError(e.message);
            console.error("Fetch data failed:", e);
            setIsLoading(false);
        }
    }, [settings]);

    useEffect(() => {
        if (settings.marketType === 'crypto') {
            handleRun();
        }
    }, []);

    useEffect(() => {
        document.documentElement.className = settings.theme;
    }, [settings.theme]);

    const handleOptimizerSettingsChange = useCallback(<K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) => {
        setOptimizerResults(null);
        setDraftSettings(prev => ({
            ...prev,
            optimizerSettings: { ...prev.optimizerSettings, [key]: value }
        }));
    }, []);

    const handleRunOptimizer = useCallback(async () => {
        if (!chartData) {
            setError("Please fetch data first before running the optimizer.");
            return;
        }

        // Check if AI stop loss is enabled in the DRAFT settings, which the user sees.
        if (draftSettings.useAiStopLoss) {
            const userConfirmed = window.confirm(
                "WARNING: 'AI Stop Loss' is enabled for this optimization.\n\n" +
                "Running the optimizer can result in a large number of API calls, which may quickly exhaust your daily AI service quota.\n\n" +
                "Are you sure you want to proceed?"
            );
            if (!userConfirmed) {
                return; // Abort if the user cancels.
            }
        }

        setIsOptimizing(true);
        setError(null);
        setOptimizerResults(null);
        try {
            // The optimizer runs with the applied `settings` as base, and draft `optimizerSettings`.
            const results = await runOptimizer(chartData, settings, draftSettings.optimizerSettings);
            setOptimizerResults(results);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsOptimizing(false);
        }
    }, [chartData, settings, draftSettings]);
    
    const parseExcelData = (file: File): Promise<Candle[]> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = e.target?.result;
                    const workbook = xlsx.read(data, { type: 'binary' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const json: any[] = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    const candles: Candle[] = json
                        .slice(1)
                        .map(row => {
                            const excelDate = parseFloat(row[0]);
                            const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
                            return {
                                time: (jsDate.getTime() / 1000) as Time,
                                open: parseFloat(row[1]),
                                high: parseFloat(row[2]),
                                low: parseFloat(row[3]),
                                close: parseFloat(row[4]),
                                volume: row[5] ? parseFloat(row[5]) : 0
                            };
                        })
                        .filter(c => c.time && !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close))
                        .sort((a, b) => (a.time as number) - (b.time as number));
                    
                    resolve(candles);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsBinaryString(file);
        });
    };

    const onAskFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsLoading(true);
        setError(null);
        try {
            const askData = await parseExcelData(file);
            setForexData(prev => ({ ...prev, ask: askData, bid: prev?.bid || askData }));
        } catch (err) {
            setError("Failed to parse ASK data file. Please check format.");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const onBidFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsLoading(true);
        setError(null);
        try {
            const bidData = await parseExcelData(file);
            setForexData(prev => ({ ...prev, ask: prev?.ask || bidData, bid: bidData }));
        } catch (err) {
            setError("Failed to parse BID data file. Please check format.");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStartReplay = () => {
        if (!analysisData?.ltf || analysisData.ltf.length === 0) {
            setError("No data available to start replay.");
            return;
        }
        setIsReplayMode(true);
        setIsWaitingForReplayStart(true);
    };

    const handleReplayStartClick = (startTime: Time) => {
        if (!analysisData?.ltf) return;
        
        const startIndex = analysisData.ltf.findIndex(c => c.time >= startTime);
        if (startIndex === -1) {
            setError("Could not find a starting point for replay.");
            return;
        }

        const initialCandles = analysisData.ltf.slice(0, startIndex);
        setReplayCandleData(initialCandles);
        setReplayIndex(startIndex);
        setIsWaitingForReplayStart(false);
    };

    const handleReplayNext = () => {
        if (!analysisData?.ltf || replayIndex >= analysisData.ltf.length) {
            setIsPlaying(false);
            return;
        }
        setReplayCandleData(prev => [...prev, analysisData.ltf[replayIndex]]);
        setReplayIndex(prev => prev + 1);
    };

    const handlePlayPause = () => setIsPlaying(prev => !prev);
    const handleExitReplay = () => {
        setIsReplayMode(false);
        setIsWaitingForReplayStart(false);
        setIsPlaying(false);
        setReplayCandleData([]);
        setReplayIndex(0);
        setAnalysisData(analysisData);
    };
    const handleSpeedChange = (multiplier: number) => setReplaySpeedMultiplier(multiplier);
    const handleJumpTo = (index: number) => {
         if (!analysisData?.ltf || index < 0 || index >= analysisData.ltf.length) return;
         setReplayCandleData(analysisData.ltf.slice(0, index));
         setReplayIndex(index);
    };

    useEffect(() => {
        if (isPlaying) {
            const intervalId = setInterval(handleReplayNext, 1000 / replaySpeedMultiplier);
            return () => clearInterval(intervalId);
        }
    }, [isPlaying, replaySpeedMultiplier, handleReplayNext]);

    useEffect(() => {
        if (isReplayMode && replayCandleData.length > 0) {
             setAnalysisData(prev => ({...prev!, ltf: replayCandleData}));
        }
    }, [replayCandleData, isReplayMode]);

    const addOrderStatus = (status: Omit<OrderStatus, 'id' | 'timestamp'>) => {
        const newStatus = { ...status, id: Date.now().toString(), timestamp: Date.now() };
        setOrderStatuses(prev => [...prev, newStatus]);
        return newStatus.id;
    };
    const updateOrderStatus = (id: string, status: Partial<OrderStatus>) => {
        setOrderStatuses(prev => prev.map(s => s.id === id ? { ...s, ...status } : s));
    };

    const handleTestTelegram = useCallback(async () => {
        if (!draftSettings.telegramEnabled || !draftSettings.telegramToken || !draftSettings.telegramChatId) return;
        const statusId = addOrderStatus({ symbol: 'TEST', type: 'Bullish', status: 'sending', message: 'Sending test message to Telegram...' });
        const result = await sendTelegramNotification('This is a test message from the SMC platform.', draftSettings.telegramToken, draftSettings.telegramChatId);
        updateOrderStatus(statusId, {
            status: result.success ? 'success' : 'error',
            message: result.success ? 'Test message sent successfully.' : `Failed to send message: ${result.description}`
        });
    }, [draftSettings]);

    const handleTestDiscord = useCallback(async () => {
        if (!draftSettings.discordEnabled || !draftSettings.discordWebhookUrl) return;
        const statusId = addOrderStatus({ symbol: 'TEST', type: 'Bullish', status: 'sending', message: 'Sending test message to Discord...' });
        const payload = {
            username: "SMC Test Bot",
            embeds: [{
                title: "Discord Webhook Test",
                description: "If you can see this, your webhook is configured correctly!",
                color: 5814783, // A nice blue color
                timestamp: new Date().toISOString()
            }]
        };
        const result = await sendDiscordNotification(draftSettings.discordWebhookUrl, payload);
        updateOrderStatus(statusId, {
            status: result.success ? 'success' : 'error',
            message: result.success ? 'Test message sent successfully.' : `Failed to send message: ${result.description}`
        });
    }, [draftSettings]);

    // --- LIVE MODE LOGIC ---
    const updateLiveData = useCallback(async () => {
        if (isUpdatingLiveRef.current || !isLiveModeRef.current) return;
        isUpdatingLiveRef.current = true;
        setError(null);
    
        try {
            const currentSettings = settingsRef.current;
            const lastCandleInState = fullLiveLtfDataRef.current[fullLiveLtfDataRef.current.length - 1];
    
            if (!lastCandleInState) {
                 console.warn("Live update: No historical data available to fetch from.");
                 isUpdatingLiveRef.current = false;
                 return;
            }
    
            // Fetch all candles from the start time of our last known candle.
            // This ensures we get any missed candles and prevent gaps.
            const fetchedCandles = await fetchCandles(
                currentSettings.symbol,
                currentSettings.ltfInterval,
                (lastCandleInState.time as number) * 1000, // API expects ms
                currentSettings.dataSource,
                currentSettings.useProxy
            );
    
            // Filter out candles we already have, except for the last one which might be an update.
            const lastKnownTime = lastCandleInState.time;
            const newCandlesToProcess = fetchedCandles.filter(c => (c.time as number) >= (lastKnownTime as number));
    
            if (newCandlesToProcess.length === 0) {
                isUpdatingLiveRef.current = false;
                return;
            }
    
            // Merge fetched candles into our full data ref
            let updatedLtf = [...fullLiveLtfDataRef.current];
            // Remove the last candle from state if its timestamp matches the first new one, to avoid duplication.
            if (updatedLtf.length > 0 && updatedLtf[updatedLtf.length - 1].time === newCandlesToProcess[0].time) {
                updatedLtf.pop();
            }
            updatedLtf.push(...newCandlesToProcess);
            fullLiveLtfDataRef.current = updatedLtf;
            
            // Update the chart UI with all new/updated candles via the ref handle
            if (chartHandle.current) {
                newCandlesToProcess.forEach(candle => {
                     chartHandle.current.updateLastCandle(candle);
                });
            }
    
            // For analysis and backtesting, we only use confirmed, closed candles to avoid repainting.
            const closedLtfForBacktest = fullLiveLtfDataRef.current.slice(0, -1);

            if (closedLtfForBacktest.length === 0) {
                console.warn("Live update: Not enough closed candles for analysis.");
                isUpdatingLiveRef.current = false;
                return;
            }

            // *** THE PERMANENT FIX FOR PHANTOM SIGNALS ***
            // To ensure 100% accuracy and consistency with the initial backtest,
            // we MUST analyze the full historical data context for all timeframes.
            // The performance issue this previously caused has been solved by
            // heavily optimizing the analysis algorithm itself in `smcService.ts`.
            const analysisChartData: ChartData = {
                htf: resampleCandles(closedLtfForBacktest, intervalToSeconds(currentSettings.htfInterval)),
                mtf: resampleCandles(closedLtfForBacktest, intervalToSeconds(currentSettings.mtfInterval)),
                ltf: closedLtfForBacktest, // Always use the full, correct LTF data
            };
            const newAnalysis = await analyzeSMC(analysisChartData, currentSettings);
    
            // The new analysis contains the full history of signals. We just need to find the ones that are new
            // compared to what we've already processed in this live session.
            const uniqueNewSignals = newAnalysis.trades.filter(s => !liveSignalHashesRef.current.has(getSignalEventHash(s)));

            // Update drawings in the UI from the full analysis result
            setSMCResult(newAnalysis);
            
            // Run the backtest on the full set of confirmed candle data as well.
            const newBacktest = runBacktest(
                closedLtfForBacktest,
                newAnalysis.trades,
                currentSettings,
                undefined,
                settings.marketType === 'forex' && forexData ? forexData : undefined
            );
            
            const currentEquity = newBacktest.trades.length > 0 ? newBacktest.trades[newBacktest.trades.length - 1].equity : currentSettings.initialCapital;
    
            for (const signal of uniqueNewSignals) {
                await broadcastNewSignal(signal, currentSettings, currentEquity, '');
                liveSignalHashesRef.current.add(getSignalEventHash(signal));
            }
    
            // --- Detect and broadcast newly closed trades ---
            const prevTradesMap = new Map<string, ExecutedTrade>();
            if (backtestResultsRef.current?.trades) {
                for (const trade of backtestResultsRef.current.trades) {
                    prevTradesMap.set(getTradeId(trade), trade);
                }
            }

            for (const currentTrade of newBacktest.trades) {
                const tradeId = getTradeId(currentTrade);
                const prevTrade = prevTradesMap.get(tradeId);

                const isNowClosed = currentTrade.outcome !== 'Open';
                const wasOpenOrNew = !prevTrade || prevTrade.outcome === 'Open';

                if (isNowClosed && wasOpenOrNew) {
                    await broadcastTradeResult(currentTrade, currentSettings);
                }
            }

            // By updating the ref immediately, we ensure that if another `updateLiveData` call
            // happens before the state re-renders, it will use the most up-to-date trade information,
            // preventing the same trade closure from being detected and notified again.
            backtestResultsRef.current = newBacktest;

            // Finally, update the state with the new backtest results for the next iteration.
            setBacktestResults(newBacktest);

        } catch (e: any) {
            console.error("Live update failed:", e);
            setError(`Live update failed: ${e.message}`);
        } finally {
            isUpdatingLiveRef.current = false;
        }
    }, [settings, forexData, isReplayMode]);

    useEffect(() => {
        updateLiveDataRef.current = updateLiveData;
    }, [updateLiveData]);

    const handleToggleLiveMode = useCallback(async () => {
        if (isLiveModeRef.current) {
            setIsLiveMode(false);
            if (initialSmcResult && initialBacktestResults && chartData) {
                setSMCResult(initialSmcResult);
                setBacktestResults(initialBacktestResults);
                const userStartDate = new Date(settings.startDate).getTime();
                setAnalysisData({
                    htf: chartData.htf.filter(c => (c.time as number) * 1000 >= userStartDate),
                    mtf: chartData.mtf.filter(c => (c.time as number) * 1000 >= userStartDate),
                    ltf: chartData.ltf.filter(c => (c.time as number) * 1000 >= userStartDate),
                });
            }
        } else {
            if (!chartData || chartData.ltf.length === 0) {
                setError("Cannot start live mode without historical data. Please fetch data first.");
                return;
            }
            
            // Save the initial state for when we stop live mode
            setInitialSmcResult(smcResult);
            setInitialBacktestResults(backtestResults);
            liveSignalHashesRef.current.clear(); // Start with a clean slate of sent signals
            fullLiveLtfDataRef.current = chartData.ltf; // Seed the live data with full history

            addOrderStatus({ symbol: settings.symbol, type: 'Bullish', status: 'sending', message: 'Starting Live Mode: Analyzing historical data to establish baseline...' });
            
            try {
                // 1. Run analysis on the full historical data to get a baseline
                const initialAnalysisChartData: ChartData = {
                    htf: resampleCandles(chartData.ltf, intervalToSeconds(settings.htfInterval)),
                    mtf: resampleCandles(chartData.ltf, intervalToSeconds(settings.mtfInterval)),
                    ltf: chartData.ltf,
                };
                const initialAnalysis = await analyzeSMC(initialAnalysisChartData, settings);

                // 2. Populate the hash set with all historical signals WITHOUT broadcasting them.
                // This prevents them from being sent when the live update loop starts.
                for (const signal of initialAnalysis.trades) {
                    liveSignalHashesRef.current.add(getSignalEventHash(signal));
                }
                
                addOrderStatus({ 
                    symbol: settings.symbol, 
                    type: 'Bullish', // Type doesn't matter for this status message
                    status: 'success', 
                    message: `Live Mode activated. Baseline established from ${initialAnalysis.trades.length} historical signals. Monitoring for new signals.` 
                });

                // Update the UI to show the historical analysis context
                setSMCResult(initialAnalysis);

                // Run an initial backtest to populate the results panel correctly
                const initialBacktest = runBacktest(chartData.ltf, initialAnalysis.trades, settings);
                setBacktestResults(initialBacktest);
                backtestResultsRef.current = initialBacktest; // Also update the ref for the next live update

                // 3. Officially start live mode and run the first update.
                setIsLiveMode(true);
                // This first call will fetch any new candles and its analysis will only
                // broadcast signals that are not in the now-populated hash set.
                await updateLiveDataRef.current();

            } catch (e: any) {
                setError(`Failed to start live mode: ${e.message}`);
                addOrderStatus({ symbol: settings.symbol, type: 'Bearish', status: 'error', message: `Failed to establish baseline: ${e.message}` });
                // Reset state if startup failed
                liveSignalHashesRef.current.clear();
                fullLiveLtfDataRef.current = [];
            }
        }
    }, [smcResult, backtestResults, chartData, settings]);

    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | null = null;
        if (isLiveMode) {
            const ltfIntervalSeconds = intervalToSeconds(settings.ltfInterval);
            const updateInterval = Math.max(ltfIntervalSeconds * 1000, 5000);
            intervalId = setInterval(() => {
                updateLiveDataRef.current();
            }, updateInterval);
        }
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isLiveMode, settings.ltfInterval]);

    const handleSendLiveTestSignal = useCallback(() => {
        if (!isLiveModeRef.current || fullLiveLtfDataRef.current.length === 0) {
            addOrderStatus({ symbol: settings.symbol, type: 'Bullish', status: 'error', message: 'Live mode not active or no chart data available.' });
            return;
        }
        const lastCandle = fullLiveLtfDataRef.current[fullLiveLtfDataRef.current.length - 1];
        const price = lastCandle.close;
        const isBullish = Math.random() > 0.5;
        const testSignal: TradeSignal = {
            entryTime: lastCandle.time, triggerTime: lastCandle.time, type: isBullish ? 'Bullish' : 'Bearish',
            entryPrice: price, stopLoss: isBullish ? price * 0.998 : price * 1.002, takeProfit: isBullish ? price * 1.008 : price * 0.992,
        };
        const currentEquity = backtestResultsRef.current?.finalEquity ?? settings.initialCapital;
        broadcastNewSignal(testSignal, settings, currentEquity, "<i>(This is a test signal)</i>");
        addOrderStatus({ symbol: settings.symbol, type: testSignal.type, status: 'success', message: 'Successfully sent a test signal to notification channels.' });
    }, [settings]);

    return (
        <div className="flex flex-col h-screen bg-bkg-light dark:bg-bkg text-text-primary-light dark:text-text-primary">
            <Controls
                settings={draftSettings}
                appliedSettings={settings}
                optimizerSettings={draftSettings.optimizerSettings}
                onSettingsChange={handleDraftSettingsChange}
                onOptimizerSettingsChange={handleOptimizerSettingsChange}
                onRun={handleRun}
                onApply={handleApplySettings}
                onAskFileUpload={onAskFileUpload}
                onBidFileUpload={onBidFileUpload}
                onStartReplay={handleStartReplay}
                onToggleLiveMode={handleToggleLiveMode}
                onRunOptimizer={handleRunOptimizer}
                onTestTelegram={handleTestTelegram}
                onTestDiscord={handleTestDiscord}
                onSendLiveTestSignal={handleSendLiveTestSignal}
                isLoading={isLoading}
                isReplayActive={isReplayMode}
                isLiveMode={isLiveMode}
                isOptimizing={isOptimizing}
                isCollapsed={isControlsCollapsed}
                onToggleCollapse={handleToggleControlsCollapse}
            />
            {error && <div className="p-2 bg-loss text-white text-center text-sm" onClick={() => setError(null)}>{error}</div>}
            <div className="flex-grow flex flex-col min-h-0">
                <div style={{ height: `calc(100% - ${resultsPanelHeight}px)` }} className="flex-grow">
                     <ChartContainer
                        ref={chartHandle}
                        settings={settings}
                        candleData={analysisData?.ltf || []}
                        trades={backtestResults?.trades || []}
                        drawings={smcResult?.drawings || []}
                        onReplayStartClick={handleReplayStartClick}
                        isReplayMode={isReplayMode}
                        isWaitingForReplayStart={isWaitingForReplayStart}
                        isPlaying={isPlaying}
                        replaySpeedMultiplier={replaySpeedMultiplier}
                        onPlayPause={handlePlayPause}
                        onNext={handleReplayNext}
                        onExitReplay={handleExitReplay}
                        onSpeedChange={handleSpeedChange}
                        onJumpTo={handleJumpTo}
                        replayIndex={replayIndex}
                        totalReplayCandles={analysisData?.ltf.length || 0}
                    />
                </div>
                <div style={{ height: `${resultsPanelHeight}px` }} className="flex-shrink-0">
                     <ResultsPanel
                        results={backtestResults}
                        optimizerResults={optimizerResults}
                        settings={settings}
                        orderStatuses={orderStatuses}
                        onHeightChange={handleResultsPanelHeightChange}
                        onApplySettings={(newSettings) => {
                            setDraftSettings(prev => ({ ...prev, ...newSettings }));
                            // Also apply them immediately for convenience after optimization
                            setSettings(prev => ({ ...prev, ...newSettings }));
                        }}
                        isOptimizing={isOptimizing}
                        isLiveMode={isLiveMode}
                    />
                </div>
            </div>
        </div>
    );
};

export default App;
