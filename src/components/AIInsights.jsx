import { useState, useEffect, useCallback } from 'react'
import { Brain, Sparkles, AlertTriangle, TrendingUp, TrendingDown, RefreshCw, Lightbulb, Shield, Eye, BarChart3, HelpCircle, X, Zap } from 'lucide-react'

// Sentiment analysis helper
const POSITIVE_WORDS = ['surge', 'jump', 'gain', 'rise', 'rally', 'soar', 'boom', 'growth', 'profit', 'beat', 'exceed', 'bullish', 'upgrade', 'buy', 'outperform', 'strong', 'positive', 'record', 'high', 'breakout', 'momentum', 'optimistic', 'success']
const NEGATIVE_WORDS = ['fall', 'drop', 'plunge', 'crash', 'decline', 'loss', 'miss', 'cut', 'bearish', 'downgrade', 'sell', 'weak', 'negative', 'low', 'fear', 'concern', 'risk', 'warning', 'slump', 'tumble', 'worry', 'trouble', 'fail']

const analyzeSentiment = (text) => {
  if (!text) return { score: 0, label: 'neutral', confidence: 50 }
  const lower = text.toLowerCase()
  let positiveCount = 0, negativeCount = 0
  POSITIVE_WORDS.forEach(word => { if (lower.includes(word)) positiveCount++ })
  NEGATIVE_WORDS.forEach(word => { if (lower.includes(word)) negativeCount++ })
  const total = positiveCount + negativeCount
  const confidence = total > 0 ? Math.min(100, 50 + total * 10) : 50
  if (positiveCount > negativeCount) return { score: positiveCount - negativeCount, label: 'bullish', confidence }
  if (negativeCount > positiveCount) return { score: negativeCount - positiveCount, label: 'bearish', confidence }
  return { score: 0, label: 'neutral', confidence: 50 }
}

// Info tooltip component
function InfoTooltip({ text, darkMode }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className={`p-0.5 rounded-full ${darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {show && (
        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs rounded-lg shadow-lg z-50 w-48 ${darkMode ? 'bg-gray-700 text-gray-100' : 'bg-gray-900 text-white'}`}>
          {text}
          <div className={`absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent ${darkMode ? 'border-t-gray-700' : 'border-t-gray-900'}`}></div>
        </div>
      )}
    </div>
  )
}

// Section explanation component
function SectionExplainer({ title, description, darkMode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`mb-4 p-3 rounded-lg ${darkMode ? 'bg-blue-900/20 border border-blue-500/30' : 'bg-blue-50 border border-blue-100'}`}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 w-full text-left">
        <Lightbulb className="w-4 h-4 text-blue-400" />
        <span className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>{title}</span>
        <span className={`text-xs ml-auto ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{expanded ? 'Hide' : 'What is this?'}</span>
      </button>
      {expanded && (
        <p className={`mt-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{description}</p>
      )}
    </div>
  )
}

export default function AIInsights({ watchlist = [], darkMode, finnhubFetch }) {
  const [marketMood, setMarketMood] = useState(50)
  const [insights, setInsights] = useState([])
  const [watchlistSummary, setWatchlistSummary] = useState(null)
  const [riskAlerts, setRiskAlerts] = useState([])
  const [stocksToWatch, setStocksToWatch] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(null)
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [error, setError] = useState(null)
  const [stockDataCache, setStockDataCache] = useState({})

  // Safe watchlist
  const safeWatchlist = Array.isArray(watchlist) ? watchlist : []

  // Generate rule-based insights
  const generateInsights = useCallback(async () => {
    if (safeWatchlist.length === 0) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const newInsights = []
    const alerts = []
    const toWatch = []

    try {
      // Fetch data for watchlist stocks
      const stockData = {}
      for (const symbol of safeWatchlist.slice(0, 10)) {
        try {
          const quote = await finnhubFetch(`/quote?symbol=${symbol}`)
          if (quote && typeof quote.c === 'number') {
            stockData[symbol] = quote
          }
        } catch (err) {
          console.warn(`Failed to fetch ${symbol}:`, err)
        }
      }

      // Cache stock data for AI analysis
      setStockDataCache(stockData)

      // Analyze each stock
      for (const [symbol, data] of Object.entries(stockData)) {
        if (!data || !data.c) continue

        const change = data.pc ? ((data.c - data.pc) / data.pc) * 100 : 0

        // Large moves
        if (Math.abs(change) > 5) {
          alerts.push({
            symbol,
            type: change > 0 ? 'surge' : 'drop',
            message: `${symbol} ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% today`,
            severity: Math.abs(change) > 10 ? 'high' : 'medium'
          })
        }

        // Near highs/lows
        if (data.h && data.c >= data.h * 0.99) {
          toWatch.push({ symbol, reason: 'Trading near daily high', type: 'bullish' })
        }
        if (data.l && data.c <= data.l * 1.01) {
          toWatch.push({ symbol, reason: 'Trading near daily low', type: 'bearish' })
        }
      }

      // Calculate market mood based on watchlist performance
      const changes = Object.values(stockData).filter(d => d && d.pc).map(d => ((d.c - d.pc) / d.pc) * 100)
      if (changes.length > 0) {
        const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length
        const newMood = Math.max(0, Math.min(100, 50 + avgChange * 10))
        setMarketMood(newMood)

        // Generate summary
        const gainers = Object.entries(stockData).filter(([, d]) => d && d.pc && d.c > d.pc).length
        const losers = Object.entries(stockData).filter(([, d]) => d && d.pc && d.c < d.pc).length
        setWatchlistSummary({
          total: Object.keys(stockData).length,
          gainers,
          losers,
          avgChange: avgChange.toFixed(2),
          bestPerformer: Object.entries(stockData).sort((a, b) => {
            const changeA = a[1]?.pc ? ((a[1].c - a[1].pc) / a[1].pc) * 100 : 0
            const changeB = b[1]?.pc ? ((b[1].c - b[1].pc) / b[1].pc) * 100 : 0
            return changeB - changeA
          })[0]?.[0],
          worstPerformer: Object.entries(stockData).sort((a, b) => {
            const changeA = a[1]?.pc ? ((a[1].c - a[1].pc) / a[1].pc) * 100 : 0
            const changeB = b[1]?.pc ? ((b[1].c - b[1].pc) / b[1].pc) * 100 : 0
            return changeA - changeB
          })[0]?.[0]
        })
      }

      // Generate insights based on patterns
      if (changes.filter(c => c > 0).length > changes.length * 0.7) {
        newInsights.push({
          type: 'positive',
          title: 'Strong Watchlist Performance',
          message: 'Most of your watchlist stocks are in the green today, indicating positive momentum.'
        })
      } else if (changes.filter(c => c < 0).length > changes.length * 0.7) {
        newInsights.push({
          type: 'negative',
          title: 'Watchlist Under Pressure',
          message: 'Most of your watchlist stocks are down today. Consider reviewing your positions.'
        })
      }

      setInsights(newInsights)
      setRiskAlerts(alerts)
      setStocksToWatch(toWatch)
    } catch (err) {
      console.error('Error generating insights:', err)
      setError('Failed to generate insights. Please try again.')
    }

    setLoading(false)
  }, [safeWatchlist, finnhubFetch])

  useEffect(() => {
    generateInsights()
  }, [generateInsights])

  // AI Analysis with Gemini (free, no API key required)
  const analyzeWithAI = async (symbol) => {
    setAnalyzing(symbol)
    setAiAnalysis(null)

    try {
      // Get cached quote data or fetch fresh
      let quote = stockDataCache[symbol]
      if (!quote) {
        quote = await finnhubFetch(`/quote?symbol=${symbol}`)
      }

      // Fetch additional data for analysis
      const [news, profile] = await Promise.all([
        finnhubFetch(`/company-news?symbol=${symbol}&from=${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}`).catch(() => []),
        finnhubFetch(`/stock/profile2?symbol=${symbol}`).catch(() => ({}))
      ])

      const newsHeadlines = (news || []).slice(0, 5).map(n => n.headline)
      const change = quote?.pc ? ((quote.c - quote.pc) / quote.pc * 100).toFixed(2) : 0

      // Prepare stock data for Gemini
      const stockData = {
        symbol,
        name: profile?.name || symbol,
        industry: profile?.finnhubIndustry || 'Unknown',
        currentPrice: quote?.c,
        previousClose: quote?.pc,
        dayHigh: quote?.h,
        dayLow: quote?.l,
        changePercent: change,
        recentNews: newsHeadlines
      }

      // Call Gemini proxy
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Analyze ${symbol} stock. What are the key things investors should know right now?`,
          stockData
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'AI analysis failed')
      }

      const data = await response.json()
      setAiAnalysis({
        symbol,
        analysis: data.insight,
        timestamp: new Date().toISOString()
      })
    } catch (err) {
      console.error('AI analysis error:', err)
      setAiAnalysis({
        symbol,
        error: err.message || 'Failed to generate AI analysis. Please try again.',
        timestamp: new Date().toISOString()
      })
    }

    setAnalyzing(null)
  }

  const getMoodLabel = (mood) => {
    if (mood <= 25) return { text: 'Very Bearish', color: 'text-red-400', emoji: '🐻' }
    if (mood <= 40) return { text: 'Bearish', color: 'text-orange-400', emoji: '📉' }
    if (mood <= 60) return { text: 'Neutral', color: 'text-yellow-400', emoji: '➖' }
    if (mood <= 75) return { text: 'Bullish', color: 'text-lime-400', emoji: '📈' }
    return { text: 'Very Bullish', color: 'text-green-400', emoji: '🐂' }
  }

  const moodLabel = getMoodLabel(marketMood)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>AI Insights</h2>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Smart analysis of your watchlist and market trends</p>
        </div>
        <button
          onClick={generateInsights}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors ${darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'}`}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <SectionExplainer
        title="About AI Insights"
        description="This section uses AI and data analysis to provide insights about your watchlist stocks. It analyzes price movements, news sentiment, and patterns to help you make informed decisions. This is not financial advice."
        darkMode={darkMode}
      />

      {error && (
        <div className={`p-3 rounded-lg ${darkMode ? 'bg-red-900/20 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-700'}`}>{error}</p>
        </div>
      )}

      {safeWatchlist.length === 0 ? (
        <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <Brain className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No stocks to analyze</h3>
          <p className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Add stocks to your watchlist to see AI insights</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Market Mood */}
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-5 h-5 text-purple-400" />
                <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Market Mood</h3>
                <InfoTooltip text="Based on the average performance of your watchlist stocks today" darkMode={darkMode} />
              </div>
              <div className="text-center">
                <div className="text-4xl mb-2">{moodLabel.emoji}</div>
                <div className={`text-xl font-bold ${moodLabel.color}`}>{moodLabel.text}</div>
                <div className="relative h-3 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full mt-4">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-800 transition-all duration-500"
                    style={{ left: `calc(${marketMood}% - 8px)` }}
                  />
                </div>
                <p className={`text-xs mt-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Based on your watchlist performance
                </p>
              </div>
            </div>

            {/* Watchlist Summary */}
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-blue-400" />
                <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist Summary</h3>
              </div>
              {watchlistSummary ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Stocks Tracked</span>
                    <span className={darkMode ? 'text-white' : 'text-gray-900'}>{watchlistSummary.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-400">Gainers</span>
                    <span className="text-green-400">{watchlistSummary.gainers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-400">Losers</span>
                    <span className="text-red-400">{watchlistSummary.losers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Avg Change</span>
                    <span className={parseFloat(watchlistSummary.avgChange) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {parseFloat(watchlistSummary.avgChange) >= 0 ? '+' : ''}{watchlistSummary.avgChange}%
                    </span>
                  </div>
                  {watchlistSummary.bestPerformer && (
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Best Today</span>
                      <span className="text-green-400">{watchlistSummary.bestPerformer}</span>
                    </div>
                  )}
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className={`w-6 h-6 animate-spin ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </div>
              ) : (
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Add stocks to your watchlist to see summary
                </p>
              )}
            </div>

            {/* AI Analysis - Now Free! */}
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-purple-900/20 to-gray-800 border-purple-500/30' : 'bg-purple-50 border-purple-100'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>AI Stock Analysis</h3>
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Free
                </span>
              </div>
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Get instant AI-powered analysis of any stock in your watchlist.
              </p>
              <div className="space-y-2">
                {safeWatchlist.slice(0, 4).map(symbol => (
                  <button
                    key={symbol}
                    onClick={() => analyzeWithAI(symbol)}
                    disabled={analyzing === symbol}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:bg-gray-50 border border-gray-200'}`}
                  >
                    <span className={darkMode ? 'text-white' : 'text-gray-900'}>{symbol}</span>
                    {analyzing === symbol ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                    ) : (
                      <span className="text-purple-400 text-sm font-medium">Analyze</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* AI Analysis Result */}
          {aiAnalysis && (
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>AI Analysis: {aiAnalysis.symbol}</h3>
                </div>
                <button onClick={() => setAiAnalysis(null)} className={`p-1 rounded-lg ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              {aiAnalysis.error ? (
                <p className="text-red-400 text-sm">{aiAnalysis.error}</p>
              ) : (
                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {aiAnalysis.analysis}
                </p>
              )}
              <p className={`text-xs mt-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Generated at {new Date(aiAnalysis.timestamp).toLocaleString()}
              </p>
            </div>
          )}

          {/* Risk Alerts */}
          {riskAlerts.length > 0 && (
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-red-900/20 border-red-500/30' : 'bg-red-50 border-red-100'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-red-400" />
                <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Risk Alerts</h3>
                <InfoTooltip text="Stocks in your watchlist with significant price movements today" darkMode={darkMode} />
              </div>
              <div className="space-y-2">
                {riskAlerts.map((alert, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-white'}`}>
                    {alert.type === 'surge' ? (
                      <TrendingUp className="w-4 h-4 text-green-400 flex-shrink-0" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400 flex-shrink-0" />
                    )}
                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{alert.symbol}</span>
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{alert.message}</span>
                    {alert.severity === 'high' && (
                      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">High</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stocks to Watch */}
          {stocksToWatch.length > 0 && (
            <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Eye className="w-5 h-5 text-blue-400" />
                <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Stocks to Watch</h3>
                <InfoTooltip text="Stocks showing interesting patterns or trading near significant levels" darkMode={darkMode} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {stocksToWatch.map((stock, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{stock.symbol}</span>
                    <span className={`text-sm ${stock.type === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                      {stock.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Disclaimer */}
      <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'}`}>
        <p className={`text-xs text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          AI Insights are generated using automated analysis and AI models. This is not financial advice.
          Always do your own research before making investment decisions. Data may be delayed up to 15 minutes.
        </p>
      </div>
    </div>
  )
}
