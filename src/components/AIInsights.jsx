import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle, BarChart3, CheckCircle, Target, Lightbulb, ChevronRight, Newspaper, DollarSign } from 'lucide-react'

const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'

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
      const data = await finnhubFetch(`/search?q=${encodeURIComponent(q)}`)
      const results = data && Array.isArray(data.result) ? data.result : []
      setSearchResults(results.slice(0, 6).map(r => ({ symbol: r.symbol, name: r.description })))
      setShowDropdown(true)
      setSelectedIndex(0)
    } catch {
      setSearchResults([])
    }
    setSearchLoading(false)
  }, 200), [finnhubFetch])

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
      // Fetch quote data
      const quote = await finnhubFetch(`/quote?symbol=${sym}`)
      if (!quote || (quote.c === 0 && quote.h === 0 && quote.l === 0)) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      // Fetch company profile
      const profile = await finnhubFetch(`/stock/profile2?symbol=${sym}`).catch(() => ({}))

      // Fetch basic financials (includes 52-week high/low, PE ratio, etc.)
      let metrics = {}
      try {
        const financials = await finnhubFetch(`/stock/metric?symbol=${sym}&metric=all`)
        metrics = financials?.metric || {}
      } catch {}

      // Fetch company news
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

      const change = quote.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0
      const weekHigh52 = metrics['52WeekHigh'] || null
      const weekLow52 = metrics['52WeekLow'] || null
      const peRatio = metrics['peBasicExclExtraTTM'] || metrics['peTTM'] || null
      const eps = metrics['epsBasicExclExtraItemsTTM'] || null
      const marketCap = profile?.marketCapitalization || null

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
        name: profile?.name || sym,
        industry: profile?.finnhubIndustry || 'Unknown',
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
        marketCapBillions: marketCap ? (marketCap / 1000).toFixed(1) : 'N/A',
        recentNewsHeadlines: news.map(n => n.headline).filter(Boolean)
      }

      // Opinionated AI prompt
      const prompt = `You are an opinionated stock analyst. Be decisive and give clear recommendations. Based on this data for ${sym}:

PRICE DATA:
- Current: $${quote.c?.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}% today)
- 52-Week High: $${weekHigh52?.toFixed(2) || 'N/A'} | 52-Week Low: $${weekLow52?.toFixed(2) || 'N/A'}
- Position in 52-week range: ${pricePosition ? pricePosition + '%' : 'N/A'} (0%=at low, 100%=at high)

FUNDAMENTALS:
- P/E Ratio: ${peRatio ? peRatio.toFixed(1) : 'N/A'}
- EPS: $${eps ? eps.toFixed(2) : 'N/A'}
- Market Cap: $${marketCap ? (marketCap / 1000).toFixed(1) + 'B' : 'N/A'}
- Industry: ${profile?.finnhubIndustry || 'Unknown'}

RECENT NEWS:
${news.length > 0 ? news.map(n => '- ' + n.headline).join('\n') : '- No recent news'}

Give your analysis in this EXACT format:

RATING: [BULLISH/BEARISH/NEUTRAL] - Pick ONE, be decisive!

PRICE ASSESSMENT: Is the current price attractive? Compare to 52-week range. One sentence.

RECENT CATALYSTS: What's driving the stock based on news? One sentence.

KEY RISK: The #1 thing that could go wrong. One sentence.

KEY OPPORTUNITY: The #1 reason to be optimistic. One sentence.

BOTTOM LINE: Would you BUY, HOLD, or AVOID? One decisive sentence.`

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

      // Extract rating from response
      const analysisText = data.insight
      const ratingMatch = analysisText.match(/RATING:\s*(BULLISH|BEARISH|NEUTRAL)/i)
      let sentiment = 'neutral'
      if (ratingMatch) {
        sentiment = ratingMatch[1].toLowerCase()
      } else {
        const lower = analysisText.toLowerCase()
        if (lower.includes('bullish') || lower.includes('buy')) sentiment = 'bullish'
        else if (lower.includes('bearish') || lower.includes('avoid') || lower.includes('sell')) sentiment = 'bearish'
      }

      const analysis = {
        symbol: sym,
        name: profile?.name || sym,
        industry: profile?.finnhubIndustry || '',
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
        news: news.slice(0, 3),
        analysis: analysisText,
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
          <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-xl border border-gray-700 shadow-2xl z-50 overflow-hidden">
            {searchResults.map((item, i) => (
              <button
                key={item.symbol}
                onClick={() => selectStock(item.symbol)}
                className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                  i === selectedIndex ? 'bg-purple-600/20' : 'hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-white">{item.symbol}</span>
                  <span className="text-gray-400 text-sm truncate max-w-[200px]">{item.name}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
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

          {/* Analysis Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Price Assessment */}
            {parseSection(currentAnalysis.analysis, 'PRICE ASSESSMENT') && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-5 h-5 text-blue-400" />
                  <h4 className="font-semibold text-white">Price Assessment</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(parseSection(currentAnalysis.analysis, 'PRICE ASSESSMENT'))}
                </p>
              </div>
            )}

            {/* Recent Catalysts */}
            {parseSection(currentAnalysis.analysis, 'RECENT CATALYSTS') && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Newspaper className="w-5 h-5 text-purple-400" />
                  <h4 className="font-semibold text-white">Recent Catalysts</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(parseSection(currentAnalysis.analysis, 'RECENT CATALYSTS'))}
                </p>
              </div>
            )}

            {/* Key Opportunity */}
            {parseSection(currentAnalysis.analysis, 'KEY OPPORTUNITY') && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <h4 className="font-semibold text-green-400">Key Opportunity</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(parseSection(currentAnalysis.analysis, 'KEY OPPORTUNITY'))}
                </p>
              </div>
            )}

            {/* Key Risk */}
            {parseSection(currentAnalysis.analysis, 'KEY RISK') && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <h4 className="font-semibold text-red-400">Key Risk</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(parseSection(currentAnalysis.analysis, 'KEY RISK'))}
                </p>
              </div>
            )}
          </div>

          {/* Bottom Line */}
          {parseSection(currentAnalysis.analysis, 'BOTTOM LINE') && (
            <div className={`rounded-xl border ${s.border} ${s.bg} p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-5 h-5" style={{ color: s.color.replace('text-', '') }} />
                <h4 className="font-semibold text-white">Bottom Line</h4>
              </div>
              <p className="text-white font-medium">
                {parseMarkdown(parseSection(currentAnalysis.analysis, 'BOTTOM LINE'))}
              </p>
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
