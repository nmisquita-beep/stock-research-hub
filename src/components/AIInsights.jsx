import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle, BarChart3, CheckCircle, Target, Lightbulb, ChevronRight, Newspaper, DollarSign } from 'lucide-react'

const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'
const YAHOO_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/yahoo'

// Yahoo Finance API helper
const yahooFetch = async (symbol, type = 'quote', options = {}) => {
  let url = `${YAHOO_PROXY_URL}?symbol=${encodeURIComponent(symbol)}`
  if (type !== 'quote') url += `&type=${type}`
  if (options.range) url += `&range=${options.range}`
  if (options.interval) url += `&interval=${options.interval}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Yahoo API Error: ${response.status}`)
  return await response.json()
}

// Normalize Yahoo quote data
const normalizeYahooQuote = (data) => {
  if (!data) return null
  return {
    c: data.regularMarketPrice || data.price || 0,
    pc: data.regularMarketPreviousClose || data.previousClose || 0,
    h: data.regularMarketDayHigh || data.dayHigh || 0,
    l: data.regularMarketDayLow || data.dayLow || 0,
    o: data.regularMarketOpen || data.open || 0,
    change: data.regularMarketChange || 0,
    changePercent: data.regularMarketChangePercent || 0,
    volume: data.regularMarketVolume || 0,
    marketCap: data.marketCap || 0,
    peRatio: data.trailingPE || data.forwardPE || null,
    eps: data.trailingEps || null,
    weekHigh52: data.fiftyTwoWeekHigh || null,
    weekLow52: data.fiftyTwoWeekLow || null,
    name: data.shortName || data.longName || '',
    exchange: data.exchange || ''
  }
}

// Parse markdown-style formatting to JSX
const parseMarkdown = (text) => {
  if (!text) return null
  const parts = text.split(/\*\*([^*]+)\*\*/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <strong key={i} className="font-semibold text-white">{part}</strong>
    }
    return part.replace(/\*/g, '')
  })
}

// Debounce helper
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

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
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('ai_analysis_history', JSON.stringify(history.slice(0, 5)))
  }, [history])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchStocks = useCallback(debounce(async (q) => {
    if (!q.trim() || q.length < 1) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    setSearchLoading(true)
    try {
      // Use Yahoo search - no rate limits
      const data = await yahooFetch(q, 'search')
      let results = []
      if (data && data.quotes && Array.isArray(data.quotes)) {
        results = data.quotes
          .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
          .slice(0, 8)
          .map(r => ({
            symbol: r.symbol,
            name: r.shortname || r.longname || r.symbol,
            type: r.quoteType || 'EQUITY'
          }))
      }
      setSearchResults(results)
      setShowDropdown(true)
      setSelectedIndex(0)
    } catch {
      setSearchResults([])
    }
    setSearchLoading(false)
  }, 200), [])

  useEffect(() => {
    if (symbol.length >= 1) {
      searchStocks(symbol)
    } else {
      setSearchResults([])
      setShowDropdown(false)
    }
  }, [symbol, searchStocks])

  const handleKeyDown = (e) => {
    if (!showDropdown || searchResults.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault()
        analyzeStock()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchResults[selectedIndex]) {
        selectStock(searchResults[selectedIndex].symbol)
      } else {
        analyzeStock()
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const selectStock = (sym) => {
    setSymbol(sym)
    setShowDropdown(false)
    setSearchResults([])
    setTimeout(() => analyzeStock(sym), 100)
  }

  const analyzeStock = async (stockSymbol) => {
    const sym = (stockSymbol || symbol).toUpperCase().trim()
    if (!sym) return

    setLoading(true)
    setError(null)
    setCurrentAnalysis(null)
    setShowDropdown(false)

    try {
      // Fetch quote data from Yahoo (no rate limits!)
      const yahooData = await yahooFetch(sym)
      const quote = normalizeYahooQuote(yahooData)
      if (!quote || quote.c === 0) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      // Fetch 1-month chart data for trend analysis
      let chartTrend = 'N/A'
      let chartPrices = []
      try {
        const chartData = await yahooFetch(sym, 'chart', { range: '1mo', interval: '1d' })
        if (chartData?.chart?.result?.[0]) {
          const result = chartData.chart.result[0]
          const closes = result.indicators?.quote?.[0]?.close || []
          chartPrices = closes.filter(c => c !== null)
          if (chartPrices.length >= 2) {
            const startPrice = chartPrices[0]
            const endPrice = chartPrices[chartPrices.length - 1]
            const monthChange = ((endPrice - startPrice) / startPrice * 100).toFixed(1)
            chartTrend = `${monthChange >= 0 ? '+' : ''}${monthChange}% over past month`

            // Calculate if trending up or down
            const midPoint = chartPrices[Math.floor(chartPrices.length / 2)]
            if (endPrice > midPoint && midPoint > startPrice) {
              chartTrend += ' (strong uptrend)'
            } else if (endPrice < midPoint && midPoint < startPrice) {
              chartTrend += ' (strong downtrend)'
            } else if (endPrice > startPrice) {
              chartTrend += ' (recovery/choppy)'
            }
          }
        }
      } catch {}

      // Fetch company news from Finnhub (still works well for news)
      const today = new Date()
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      const fromDate = weekAgo.toISOString().split('T')[0]
      const toDate = today.toISOString().split('T')[0]

      let news = []
      try {
        const newsData = await finnhubFetch(`/company-news?symbol=${sym}&from=${fromDate}&to=${toDate}`)
        if (Array.isArray(newsData)) {
          news = newsData.slice(0, 5)
        } else if (newsData && typeof newsData === 'object') {
          news = Object.values(newsData).filter(n => n && n.headline).slice(0, 5)
        }
      } catch {}

      const change = quote.changePercent || 0
      const weekHigh52 = quote.weekHigh52
      const weekLow52 = quote.weekLow52
      const peRatio = quote.peRatio
      const eps = quote.eps
      const marketCap = quote.marketCap

      // Calculate position in 52-week range
      let pricePosition = null
      if (weekHigh52 && weekLow52 && quote.c) {
        const range = weekHigh52 - weekLow52
        if (range > 0) {
          pricePosition = ((quote.c - weekLow52) / range * 100).toFixed(0)
        }
      }

      // Build comprehensive stock data for AI
      const stockData = {
        symbol: sym,
        name: quote.name || sym,
        currentPrice: quote.c,
        previousClose: quote.pc,
        dayHigh: quote.h,
        dayLow: quote.l,
        openPrice: quote.o,
        changePercent: change.toFixed(2),
        weekHigh52,
        weekLow52,
        pricePositionIn52WeekRange: pricePosition ? `${pricePosition}%` : 'N/A',
        peRatio: peRatio ? peRatio.toFixed(1) : 'N/A',
        eps: eps ? eps.toFixed(2) : 'N/A',
        marketCapBillions: marketCap ? (marketCap / 1e9).toFixed(1) : 'N/A',
        chartTrend,
        recentNewsHeadlines: news.map(n => n.headline).filter(Boolean)
      }

      // JSON AI prompt for structured response
      const prompt = `Analyze ${sym}: $${quote.c?.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}% today), P/E: ${peRatio ? peRatio.toFixed(1) : 'N/A'}, 52W Range: $${weekLow52?.toFixed(2) || '?'}-$${weekHigh52?.toFixed(2) || '?'} (at ${pricePosition || '?'}%), Trend: ${chartTrend}.
${news.length > 0 ? 'News: ' + news.slice(0,3).map(n => n.headline).join(' | ') : ''}

Respond with ONLY this JSON, no other text:
{
  "rating": "BULLISH" or "BEARISH" or "NEUTRAL",
  "summary": "1-2 sentence overview of the stock",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "keyMetrics": "Brief note on valuation - is it cheap/expensive and why",
  "catalyst": "What could move this stock soon",
  "bottomLine": "BUY, HOLD, or AVOID - one decisive sentence"
}`

      const response = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, stockData })
      })

      if (!response.ok) {
        const errorText = await response.text()
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
      if (!data || !data.insight) {
        throw new Error('No analysis generated')
      }

      // Clean asterisks from response
      const rawText = (data.insight || '').replace(/\*\*/g, '').replace(/\*/g, '').trim()

      // Try to parse JSON response
      let aiJson = null
      let sentiment = 'neutral'
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          aiJson = JSON.parse(jsonMatch[0])
          if (aiJson.rating) {
            sentiment = aiJson.rating.toLowerCase()
          }
        }
      } catch (e) {
        console.log('JSON parse failed, using text fallback')
      }

      // Fallback: extract from text if no JSON
      if (!aiJson) {
        const ratingMatch = rawText.match(/RATING:\s*(BULLISH|BEARISH|NEUTRAL)/i)
        if (ratingMatch) {
          sentiment = ratingMatch[1].toLowerCase()
        } else {
          const lower = rawText.toLowerCase()
          if (lower.includes('bullish') || lower.includes('buy')) sentiment = 'bullish'
          else if (lower.includes('bearish') || lower.includes('avoid') || lower.includes('sell')) sentiment = 'bearish'
        }
      }

      const analysis = {
        symbol: sym,
        name: quote.name || sym,
        price: quote.c,
        previousClose: quote.pc,
        dayHigh: quote.h,
        dayLow: quote.l,
        change,
        weekHigh52,
        weekLow52,
        pricePosition,
        peRatio,
        eps,
        marketCap,
        chartTrend,
        news: news.slice(0, 3),
        analysis: rawText,
        aiJson, // Parsed JSON data
        sentiment,
        timestamp: new Date().toISOString()
      }

      setCurrentAnalysis(analysis)
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

  const getSentimentDisplay = (sentiment) => {
    switch (sentiment) {
      case 'bullish':
        return { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30', label: 'BULLISH', bgSolid: 'bg-green-600' }
      case 'bearish':
        return { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30', label: 'BEARISH', bgSolid: 'bg-red-600' }
      default:
        return { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', label: 'NEUTRAL', bgSolid: 'bg-yellow-600' }
    }
  }

  const s = currentAnalysis ? getSentimentDisplay(currentAnalysis.sentiment) : null

  // Parse sections from analysis
  const parseSection = (text, header) => {
    const regex = new RegExp(`${header}:?\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'is')
    const match = text.match(regex)
    return match ? match[1].trim().replace(/\*\*/g, '') : null
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Brain className="w-7 h-7 text-purple-400" />
          AI Stock Analysis
        </h2>
        <p className="text-gray-400 mt-1">Get opinionated, actionable insights on any stock</p>
      </div>

      {/* Search Bar */}
      <div className="relative" ref={dropdownRef}>
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
            onKeyDown={handleKeyDown}
            onFocus={() => symbol.length >= 1 && searchResults.length > 0 && setShowDropdown(true)}
            placeholder="Search stock symbol (e.g., AAPL, MSFT, TSLA)"
            className={`flex-1 bg-transparent outline-none text-lg ${
              darkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
            }`}
            disabled={loading}
          />
          {searchLoading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
          <button
            type="button"
            onClick={() => analyzeStock()}
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

        {/* Autocomplete */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-xl border border-gray-700 shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
            {searchResults.map((item, i) => (
              <button
                key={item.symbol}
                onClick={() => selectStock(item.symbol)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                  i === selectedIndex ? 'bg-purple-600/30' : 'hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-bold text-white">{item.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                    item.type === 'ETF' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {item.type}
                  </span>
                  <span className="text-gray-400 text-sm truncate">{item.name}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Analysis Failed</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="p-8 rounded-xl border bg-gray-800/50 border-gray-700 text-center">
          <RefreshCw className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white font-medium">Analyzing {symbol}...</p>
          <p className="text-gray-400 text-sm mt-1">Fetching financials, news, and generating insights</p>
        </div>
      )}

      {/* Analysis Result */}
      {currentAnalysis && !loading && (
        <div className="space-y-4">
          {/* Header Card with Rating */}
          <div className={`rounded-xl border ${s.border} ${s.bg} p-5`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-2xl font-bold text-white">{currentAnalysis.symbol}</h3>
                  <span className={`px-4 py-1.5 rounded-lg text-sm font-bold text-white ${s.bgSolid}`}>
                    {s.label}
                  </span>
                </div>
                <p className="text-gray-300">{currentAnalysis.name}</p>
                {currentAnalysis.industry && (
                  <p className="text-gray-500 text-sm">{currentAnalysis.industry}</p>
                )}
              </div>
              <button onClick={() => setCurrentAnalysis(null)} className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Price & Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-gray-400">Current Price</div>
                <div className="text-2xl font-bold text-white">${currentAnalysis.price?.toFixed(2)}</div>
                <div className={`text-sm font-medium ${currentAnalysis.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {currentAnalysis.change >= 0 ? '+' : ''}{currentAnalysis.change?.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">52-Week Range</div>
                <div className="text-white font-medium">
                  ${currentAnalysis.weekLow52?.toFixed(2) || 'N/A'} - ${currentAnalysis.weekHigh52?.toFixed(2) || 'N/A'}
                </div>
                {currentAnalysis.pricePosition && (
                  <div className="text-sm text-gray-400">{currentAnalysis.pricePosition}% of range</div>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-400">P/E Ratio</div>
                <div className="text-white font-medium">{currentAnalysis.peRatio?.toFixed(1) || 'N/A'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Market Cap</div>
                <div className="text-white font-medium">
                  {currentAnalysis.marketCap ? `$${(currentAnalysis.marketCap / 1000).toFixed(1)}B` : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          {/* Analysis Sections - JSON format */}
          {currentAnalysis.aiJson ? (
            <>
              {/* Summary */}
              {currentAnalysis.aiJson.summary && (
                <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                  <p className="text-gray-200 text-base leading-relaxed">{currentAnalysis.aiJson.summary}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Strengths */}
                {currentAnalysis.aiJson.strengths && currentAnalysis.aiJson.strengths.length > 0 && (
                  <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <h4 className="font-semibold text-green-400">Strengths</h4>
                    </div>
                    <ul className="space-y-2">
                      {currentAnalysis.aiJson.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-green-400 mt-0.5">+</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks */}
                {currentAnalysis.aiJson.risks && currentAnalysis.aiJson.risks.length > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      <h4 className="font-semibold text-red-400">Risks</h4>
                    </div>
                    <ul className="space-y-2">
                      {currentAnalysis.aiJson.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-red-400 mt-0.5">!</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Metrics */}
                {currentAnalysis.aiJson.keyMetrics && (
                  <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <DollarSign className="w-5 h-5 text-blue-400" />
                      <h4 className="font-semibold text-white">Valuation</h4>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentAnalysis.aiJson.keyMetrics}</p>
                  </div>
                )}

                {/* Catalyst */}
                {currentAnalysis.aiJson.catalyst && (
                  <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Lightbulb className="w-5 h-5 text-yellow-400" />
                      <h4 className="font-semibold text-white">Upcoming Catalyst</h4>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentAnalysis.aiJson.catalyst}</p>
                  </div>
                )}
              </div>

              {/* Bottom Line */}
              {currentAnalysis.aiJson.bottomLine && (
                <div className={`rounded-xl border ${s.border} ${s.bg} p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-5 h-5 ${s.color}" />
                    <h4 className="font-semibold text-white">Bottom Line</h4>
                  </div>
                  <p className="text-white font-medium">{currentAnalysis.aiJson.bottomLine}</p>
                </div>
              )}
            </>
          ) : (
            /* Fallback: Text-based display */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {parseSection(currentAnalysis.analysis, 'PRICE ASSESSMENT') && (
                <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-5 h-5 text-blue-400" />
                    <h4 className="font-semibold text-white">Price Assessment</h4>
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    {parseSection(currentAnalysis.analysis, 'PRICE ASSESSMENT')}
                  </p>
                </div>
              )}

              {parseSection(currentAnalysis.analysis, 'KEY OPPORTUNITY') && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <h4 className="font-semibold text-green-400">Opportunity</h4>
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    {parseSection(currentAnalysis.analysis, 'KEY OPPORTUNITY')}
                  </p>
                </div>
              )}

              {parseSection(currentAnalysis.analysis, 'KEY RISK') && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <h4 className="font-semibold text-red-400">Risk</h4>
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    {parseSection(currentAnalysis.analysis, 'KEY RISK')}
                  </p>
                </div>
              )}

              {parseSection(currentAnalysis.analysis, 'BOTTOM LINE') && (
                <div className={`rounded-xl border ${s.border} ${s.bg} p-4 md:col-span-2`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-5 h-5" />
                    <h4 className="font-semibold text-white">Bottom Line</h4>
                  </div>
                  <p className="text-white font-medium">
                    {parseSection(currentAnalysis.analysis, 'BOTTOM LINE')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* News Headlines Used */}
          {currentAnalysis.news && currentAnalysis.news.length > 0 && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-4">
              <h4 className="text-sm font-medium text-gray-400 mb-3">Recent News Analyzed</h4>
              <div className="space-y-2">
                {currentAnalysis.news.map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-gray-300 hover:text-blue-400 truncate"
                  >
                    • {article.headline}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-center justify-between text-xs text-gray-500 px-1">
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>AI-generated analysis, not financial advice. Do your own research.</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{new Date(currentAnalysis.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && !loading && !currentAnalysis && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400">Recent Analyses</h3>
            <button
              onClick={() => { setHistory([]); localStorage.removeItem('ai_analysis_history') }}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.map((item) => {
              const hs = getSentimentDisplay(item.sentiment)
              return (
                <button
                  key={`${item.symbol}-${item.timestamp}`}
                  onClick={() => setCurrentAnalysis(item)}
                  className="p-4 rounded-xl border bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800 text-left transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-white text-lg">{item.symbol}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${hs.bgSolid}`}>
                      {hs.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-300">${item.price?.toFixed(2)}</span>
                    <span className={item.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {item.change >= 0 ? '+' : ''}{item.change?.toFixed(2)}%
                    </span>
                  </div>
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
            Search for any stock to get opinionated AI analysis with clear buy/hold/avoid recommendations.
          </p>
        </div>
      )}
    </div>
  )
}
