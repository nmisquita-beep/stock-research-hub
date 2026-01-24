import { useState, useRef, useEffect } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle } from 'lucide-react'

const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'

export default function AIInsights({ darkMode, finnhubFetch }) {
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentAnalysis, setCurrentAnalysis] = useState(null)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('ai_analysis_history')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('ai_analysis_history', JSON.stringify(history.slice(0, 5)))
  }, [history])

  const analyzeStock = async (stockSymbol) => {
    const sym = (stockSymbol || symbol).toUpperCase().trim()
    if (!sym) return

    setLoading(true)
    setError(null)
    setCurrentAnalysis(null)

    try {
      // Fetch stock data
      console.log('Fetching quote for:', sym)
      const quote = await finnhubFetch(`/quote?symbol=${sym}`)
      console.log('Quote response:', quote)

      if (!quote || (quote.c === 0 && quote.h === 0 && quote.l === 0)) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      // Fetch company profile
      console.log('Fetching profile for:', sym)
      const profile = await finnhubFetch(`/stock/profile2?symbol=${sym}`).catch(() => ({}))
      console.log('Profile response:', profile)

      // Fetch recent news
      const today = new Date()
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      const fromDate = weekAgo.toISOString().split('T')[0]
      const toDate = today.toISOString().split('T')[0]

      console.log('Fetching news for:', sym)
      let news = []
      try {
        const newsData = await finnhubFetch(`/company-news?symbol=${sym}&from=${fromDate}&to=${toDate}`)
        news = Array.isArray(newsData) ? newsData.slice(0, 5) : []
      } catch (e) {
        console.warn('News fetch failed:', e)
      }
      console.log('News response:', news)

      const change = quote.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0

      // Prepare data for Gemini
      const stockData = {
        symbol: sym,
        name: profile?.name || sym,
        industry: profile?.finnhubIndustry || 'Unknown',
        currentPrice: quote.c,
        previousClose: quote.pc,
        dayHigh: quote.h,
        dayLow: quote.l,
        openPrice: quote.o,
        changePercent: change.toFixed(2),
        recentNews: news.map(n => n.headline).filter(Boolean)
      }

      console.log('Calling Gemini with:', stockData)

      // Call Gemini API
      const response = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Provide a comprehensive analysis of ${sym} stock. Include:
1. A brief overview of the current price action
2. Key factors investors should consider
3. Recent news sentiment analysis
4. Potential risks and opportunities
5. A clear sentiment rating (Bullish, Neutral, or Bearish)

Be concise but thorough. Format with clear sections.`,
          stockData
        })
      })

      console.log('Gemini response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Gemini error response:', errorText)
        let errorMessage = 'AI analysis failed'
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = errorText || errorMessage
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      console.log('Gemini data:', data)

      if (!data || !data.insight) {
        throw new Error('No analysis generated')
      }

      // Determine sentiment from the analysis text
      const analysisLower = data.insight.toLowerCase()
      let sentiment = 'neutral'
      if (analysisLower.includes('bullish') || analysisLower.includes('buy') || analysisLower.includes('positive outlook')) {
        sentiment = 'bullish'
      } else if (analysisLower.includes('bearish') || analysisLower.includes('sell') || analysisLower.includes('negative outlook')) {
        sentiment = 'bearish'
      }

      const analysis = {
        symbol: sym,
        name: profile?.name || sym,
        price: quote.c,
        change: change,
        analysis: data.insight,
        sentiment,
        timestamp: new Date().toISOString()
      }

      setCurrentAnalysis(analysis)

      // Add to history (avoid duplicates)
      setHistory(prev => {
        const filtered = prev.filter(h => h.symbol !== sym)
        return [analysis, ...filtered].slice(0, 5)
      })

      setSymbol('')

    } catch (err) {
      console.error('Analysis error:', err)
      setError(err.message || 'Failed to analyze stock. Please try again.')
    }

    setLoading(false)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    analyzeStock()
  }

  const handleHistoryClick = (item) => {
    setCurrentAnalysis(item)
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('ai_analysis_history')
  }

  const getSentimentDisplay = (sentiment) => {
    switch (sentiment) {
      case 'bullish':
        return { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Bullish' }
      case 'bearish':
        return { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Bearish' }
      default:
        return { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Neutral' }
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-7 h-7 text-purple-400" />
          AI Stock Analysis
        </h2>
        <p className="text-gray-400 mt-1">Get instant AI-powered insights on any stock</p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSubmit} className="relative">
        <div className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
          darkMode
            ? 'bg-gray-800 border-gray-700 focus-within:border-purple-500'
            : 'bg-white border-gray-200 focus-within:border-purple-500'
        }`}>
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Enter stock symbol (e.g., AAPL, MSFT, TSLA)"
            className={`flex-1 bg-transparent outline-none text-lg ${
              darkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
            }`}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !symbol.trim()}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all ${
              loading || !symbol.trim()
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyze
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error Display */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Analysis Failed</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-8 rounded-xl border bg-gray-800/50 border-gray-700 text-center">
          <RefreshCw className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white font-medium">Analyzing {symbol}...</p>
          <p className="text-gray-400 text-sm mt-1">Gathering data and generating insights</p>
        </div>
      )}

      {/* Current Analysis Result */}
      {currentAnalysis && !loading && (
        <div className="rounded-xl border bg-gray-800 border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{currentAnalysis.symbol}</h3>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-300">{currentAnalysis.name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white font-medium">${currentAnalysis.price?.toFixed(2)}</span>
                  <span className={currentAnalysis.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {currentAnalysis.change >= 0 ? '+' : ''}{currentAnalysis.change?.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setCurrentAnalysis(null)}
              className="p-2 rounded-lg hover:bg-gray-700 text-gray-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Sentiment Badge */}
          {currentAnalysis.sentiment && (
            <div className="px-4 py-3 border-b border-gray-700">
              {(() => {
                const s = getSentimentDisplay(currentAnalysis.sentiment)
                return (
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${s.bg}`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                    <span className={`font-medium ${s.color}`}>{s.label}</span>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Analysis Content */}
          <div className="p-4">
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">
                {currentAnalysis.analysis}
              </p>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-700">
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" />
              This is AI-generated analysis, not financial advice. Always do your own research before investing.
            </p>
          </div>

          {/* Timestamp */}
          <div className="px-4 py-2 border-t border-gray-700">
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Generated {new Date(currentAnalysis.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Recent Analyses History */}
      {history.length > 0 && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400">Recent Analyses</h3>
            <button
              onClick={clearHistory}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              Clear history
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.map((item, i) => {
              const s = getSentimentDisplay(item.sentiment)
              const isActive = currentAnalysis?.symbol === item.symbol &&
                               currentAnalysis?.timestamp === item.timestamp
              return (
                <button
                  key={`${item.symbol}-${item.timestamp}`}
                  onClick={() => handleHistoryClick(item)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isActive
                      ? 'bg-purple-500/20 border-purple-500/50'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white">{item.symbol}</span>
                    <div className={`p-1 rounded ${s.bg}`}>
                      <s.icon className={`w-3 h-3 ${s.color}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-400">${item.price?.toFixed(2)}</span>
                    <span className={item.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {item.change >= 0 ? '+' : ''}{item.change?.toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {item.analysis?.substring(0, 80)}...
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!currentAnalysis && !loading && history.length === 0 && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Brain className="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">No analyses yet</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Enter a stock symbol above to get AI-powered analysis including price action,
            key factors, news sentiment, and investment considerations.
          </p>
        </div>
      )}
    </div>
  )
}
