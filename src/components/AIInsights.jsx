import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle, BarChart3, CheckCircle, Target, Lightbulb, ChevronRight } from 'lucide-react'

const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'

// Parse markdown-style formatting to JSX
const parseMarkdown = (text) => {
  if (!text) return null

  // Split by double asterisks for bold
  const parts = text.split(/\*\*([^*]+)\*\*/g)

  return parts.map((part, i) => {
    // Odd indices are the bold parts (content between **)
    if (i % 2 === 1) {
      return <strong key={i} className="font-semibold text-white">{part}</strong>
    }
    // Clean up any remaining single asterisks
    return part.replace(/\*/g, '')
  })
}

// Extract sections from AI response
const parseAnalysisSections = (text) => {
  if (!text) return { summary: '', opportunities: [], risks: [], priceAction: '', keyPoints: [] }

  const lines = text.split('\n').filter(l => l.trim())
  const sections = {
    summary: '',
    opportunities: [],
    risks: [],
    priceAction: '',
    keyPoints: []
  }

  let currentSection = 'summary'

  lines.forEach(line => {
    const lower = line.toLowerCase()
    const cleanLine = line.replace(/^\*+\s*/, '').replace(/\*+$/, '').replace(/^[-•]\s*/, '').trim()

    // Detect section headers
    if (lower.includes('opportunit') || lower.includes('bullish') || lower.includes('positive')) {
      currentSection = 'opportunities'
      if (!lower.includes(':') && cleanLine.length > 20) {
        sections.opportunities.push(cleanLine)
      }
    } else if (lower.includes('risk') || lower.includes('bearish') || lower.includes('concern') || lower.includes('negative')) {
      currentSection = 'risks'
      if (!lower.includes(':') && cleanLine.length > 20) {
        sections.risks.push(cleanLine)
      }
    } else if (lower.includes('price action') || lower.includes('current price') || lower.includes('trading at')) {
      currentSection = 'priceAction'
      sections.priceAction = cleanLine
    } else if (lower.includes('summary') || lower.includes('conclusion') || lower.includes('overall')) {
      currentSection = 'summary'
      if (!lower.includes(':') && cleanLine.length > 20) {
        sections.summary = cleanLine
      }
    } else if (cleanLine.length > 10) {
      // Add to current section
      if (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('*')) {
        if (currentSection === 'opportunities') {
          sections.opportunities.push(cleanLine)
        } else if (currentSection === 'risks') {
          sections.risks.push(cleanLine)
        } else {
          sections.keyPoints.push(cleanLine)
        }
      } else if (currentSection === 'priceAction' && !sections.priceAction) {
        sections.priceAction = cleanLine
      } else if (currentSection === 'summary' && !sections.summary) {
        sections.summary = cleanLine
      } else if (!sections.summary && cleanLine.length > 50) {
        sections.summary = cleanLine
      }
    }
  })

  // If no structured content found, use first paragraph as summary
  if (!sections.summary && lines.length > 0) {
    sections.summary = lines[0].replace(/\*+/g, '').trim()
  }

  return sections
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

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('ai_analysis_history', JSON.stringify(history.slice(0, 5)))
  }, [history])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search stocks as user types
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
    // Auto-analyze after selection
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
      const quote = await finnhubFetch(`/quote?symbol=${sym}`)

      if (!quote || (quote.c === 0 && quote.h === 0 && quote.l === 0)) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      const profile = await finnhubFetch(`/stock/profile2?symbol=${sym}`).catch(() => ({}))

      const today = new Date()
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      const fromDate = weekAgo.toISOString().split('T')[0]
      const toDate = today.toISOString().split('T')[0]

      let news = []
      try {
        const newsData = await finnhubFetch(`/company-news?symbol=${sym}&from=${fromDate}&to=${toDate}`)
        news = Array.isArray(newsData) ? newsData.slice(0, 5) : []
      } catch {}

      const change = quote.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0

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

      const response = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Analyze ${sym} stock concisely. Structure your response with:

1. PRICE ACTION: One sentence on current price movement
2. OPPORTUNITIES: 2-3 bullet points on bullish factors
3. RISKS: 2-3 bullet points on bearish factors
4. SUMMARY: One sentence overall outlook with sentiment (Bullish/Neutral/Bearish)

Keep each point brief and actionable. No disclaimers needed.`,
          stockData
        })
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

      const analysisLower = data.insight.toLowerCase()
      let sentiment = 'neutral'
      if (analysisLower.includes('bullish') || analysisLower.includes('buy') || analysisLower.includes('positive outlook') || analysisLower.includes('upside')) {
        sentiment = 'bullish'
      } else if (analysisLower.includes('bearish') || analysisLower.includes('sell') || analysisLower.includes('negative outlook') || analysisLower.includes('downside')) {
        sentiment = 'bearish'
      }

      const analysis = {
        symbol: sym,
        name: profile?.name || sym,
        industry: profile?.finnhubIndustry || '',
        price: quote.c,
        previousClose: quote.pc,
        dayHigh: quote.h,
        dayLow: quote.l,
        change: change,
        analysis: data.insight,
        sections: parseAnalysisSections(data.insight),
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
        return { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30', label: 'Bullish' }
      case 'bearish':
        return { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30', label: 'Bearish' }
      default:
        return { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', label: 'Neutral' }
    }
  }

  const s = currentAnalysis ? getSentimentDisplay(currentAnalysis.sentiment) : null

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

      {/* Search Bar with Autocomplete */}
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

        {/* Autocomplete Dropdown */}
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

      {/* Current Analysis Result - Redesigned */}
      {currentAnalysis && !loading && (
        <div className="space-y-4">
          {/* Top Card - Stock Info + Sentiment */}
          <div className={`rounded-xl border ${s.border} ${s.bg} p-5`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-2xl font-bold text-white">{currentAnalysis.symbol}</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1.5 ${s.bg} ${s.color} border ${s.border}`}>
                    <s.icon className="w-4 h-4" />
                    {s.label}
                  </span>
                </div>
                <p className="text-gray-300">{currentAnalysis.name}</p>
                {currentAnalysis.industry && (
                  <p className="text-gray-500 text-sm">{currentAnalysis.industry}</p>
                )}
              </div>
              <button
                onClick={() => setCurrentAnalysis(null)}
                className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Price Info */}
            <div className="flex items-baseline gap-4 mt-4">
              <span className="text-3xl font-bold text-white">${currentAnalysis.price?.toFixed(2)}</span>
              <span className={`text-lg font-semibold ${currentAnalysis.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {currentAnalysis.change >= 0 ? '+' : ''}{currentAnalysis.change?.toFixed(2)}%
              </span>
            </div>
            <div className="flex gap-6 mt-2 text-sm text-gray-400">
              <span>Open: ${currentAnalysis.previousClose?.toFixed(2)}</span>
              <span>High: ${currentAnalysis.dayHigh?.toFixed(2)}</span>
              <span>Low: ${currentAnalysis.dayLow?.toFixed(2)}</span>
            </div>
          </div>

          {/* Analysis Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Price Action Card */}
            {currentAnalysis.sections.priceAction && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  <h4 className="font-semibold text-white">Price Action</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(currentAnalysis.sections.priceAction)}
                </p>
              </div>
            )}

            {/* Summary Card */}
            {currentAnalysis.sections.summary && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-yellow-400" />
                  <h4 className="font-semibold text-white">Key Takeaway</h4>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {parseMarkdown(currentAnalysis.sections.summary)}
                </p>
              </div>
            )}

            {/* Opportunities Card */}
            {currentAnalysis.sections.opportunities.length > 0 && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <h4 className="font-semibold text-green-400">Opportunities</h4>
                </div>
                <ul className="space-y-2">
                  {currentAnalysis.sections.opportunities.slice(0, 4).map((opp, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-green-400 mt-1">•</span>
                      <span>{parseMarkdown(opp)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks Card */}
            {currentAnalysis.sections.risks.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <h4 className="font-semibold text-red-400">Risks</h4>
                </div>
                <ul className="space-y-2">
                  {currentAnalysis.sections.risks.slice(0, 4).map((risk, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-red-400 mt-1">•</span>
                      <span>{parseMarkdown(risk)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Full Analysis (if sections didn't parse well) */}
          {currentAnalysis.sections.opportunities.length === 0 && currentAnalysis.sections.risks.length === 0 && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-purple-400" />
                <h4 className="font-semibold text-white">Analysis</h4>
              </div>
              <div className="text-gray-300 text-sm leading-relaxed space-y-2">
                {currentAnalysis.analysis.split('\n').filter(l => l.trim()).map((line, i) => (
                  <p key={i}>{parseMarkdown(line)}</p>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-gray-500 px-1">
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>AI-generated analysis, not financial advice</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{new Date(currentAnalysis.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Analyses History */}
      {history.length > 0 && !loading && !currentAnalysis && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400">Recent Analyses</h3>
            <button
              onClick={() => { setHistory([]); localStorage.removeItem('ai_analysis_history') }}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              Clear history
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
                    <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${hs.bg} ${hs.color}`}>
                      {hs.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <span className="text-gray-300">${item.price?.toFixed(2)}</span>
                    <span className={item.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {item.change >= 0 ? '+' : ''}{item.change?.toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(item.timestamp).toLocaleDateString()}
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
            Search for any stock symbol above to get AI-powered analysis including
            opportunities, risks, and actionable insights.
          </p>
        </div>
      )}
    </div>
  )
}
