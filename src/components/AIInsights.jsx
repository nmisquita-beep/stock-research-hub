import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle, BarChart3, CheckCircle, Target, Lightbulb, ChevronRight, Newspaper, DollarSign, Zap, Shield, Activity, PieChart, Award, ArrowUpRight, ArrowDownRight } from 'lucide-react'

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

// Normalize Yahoo quote data with enhanced fields
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
    avgVolume: data.averageDailyVolume10Day || data.averageVolume || 0,
    marketCap: data.marketCap || 0,
    peRatio: data.trailingPE || null,
    forwardPE: data.forwardPE || null,
    eps: data.trailingEps || null,
    weekHigh52: data.fiftyTwoWeekHigh || null,
    weekLow52: data.fiftyTwoWeekLow || null,
    fiftyDayAvg: data.fiftyDayAverage || null,
    twoHundredDayAvg: data.twoHundredDayAverage || null,
    dividendYield: data.dividendYield || data.trailingAnnualDividendYield || null,
    beta: data.beta || null,
    name: data.shortName || data.longName || '',
    exchange: data.exchange || '',
    sector: data.sector || '',
    industry: data.industry || '',
    targetPrice: data.targetMeanPrice || data.targetHighPrice || null,
    recommendation: data.recommendationKey || null,
    earningsDate: data.earningsTimestamp || null,
    bookValue: data.bookValue || null,
    priceToBook: data.priceToBook || null
  }
}

// Calculate technical indicators from price data
const calculateTechnicalIndicators = (prices) => {
  if (!prices || prices.length < 5) return null

  const latest = prices[prices.length - 1]
  const len = prices.length

  // Simple Moving Averages
  const sma5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5
  const sma10 = len >= 10 ? prices.slice(-10).reduce((a, b) => a + b, 0) / 10 : null
  const sma20 = len >= 20 ? prices.slice(-20).reduce((a, b) => a + b, 0) / 20 : null

  // Momentum (price change over last 5 days)
  const momentum = ((latest - prices[len - 5]) / prices[len - 5] * 100).toFixed(2)

  // Volatility (standard deviation of last 10 days)
  const recentPrices = prices.slice(-10)
  const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
  const variance = recentPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / recentPrices.length
  const volatility = (Math.sqrt(variance) / mean * 100).toFixed(2)

  // RSI approximation (simplified)
  let gains = 0, losses = 0
  for (let i = Math.max(0, len - 14); i < len - 1; i++) {
    const change = prices[i + 1] - prices[i]
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / 14
  const avgLoss = losses / 14
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  const rsi = Math.round(100 - (100 / (1 + rs)))

  // Trend detection
  let trend = 'sideways'
  if (latest > sma5 && sma5 > (sma10 || sma5)) trend = 'bullish'
  else if (latest < sma5 && sma5 < (sma10 || sma5)) trend = 'bearish'

  // Support/Resistance levels (simplified)
  const sortedPrices = [...prices].sort((a, b) => a - b)
  const support = sortedPrices[Math.floor(len * 0.1)]
  const resistance = sortedPrices[Math.floor(len * 0.9)]

  return {
    sma5: sma5.toFixed(2),
    sma10: sma10?.toFixed(2),
    sma20: sma20?.toFixed(2),
    momentum: parseFloat(momentum),
    volatility: parseFloat(volatility),
    rsi,
    trend,
    support: support.toFixed(2),
    resistance: resistance.toFixed(2),
    aboveSMA5: latest > sma5,
    aboveSMA20: sma20 ? latest > sma20 : null
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

export default function AIInsights({ finnhubFetch }) {
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
  const [loadingStep, setLoadingStep] = useState('')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const isSelectingRef = useRef(false) // Prevent dropdown flickering

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

  // Popular stocks for supplementing short searches
  const POPULAR_STOCKS = {
    'A': ['AAPL', 'AMZN', 'AMD', 'ABBV', 'AVGO', 'ADBE', 'ABT', 'ACN', 'ABNB', 'AXP'],
    'B': ['BRK-B', 'BAC', 'BA', 'BMY', 'BLK', 'BKNG', 'BX', 'BSX', 'BIIB', 'BDX'],
    'C': ['COST', 'CRM', 'CVX', 'CSCO', 'C', 'CAT', 'CMCSA', 'COP', 'CI', 'CRWD'],
    'D': ['DIS', 'DHR', 'DE', 'DXCM', 'DUK', 'D', 'DASH', 'DVN', 'DG', 'DKNG'],
    'E': ['XOM', 'ETN', 'EMR', 'ELV', 'EOG', 'ENPH', 'EL', 'EA', 'EW', 'EBAY'],
    'F': ['F', 'FDX', 'FCX', 'FSLR', 'FISV', 'FIS', 'FTNT', 'FI', 'FAST', 'FTV'],
    'G': ['GOOGL', 'GOOG', 'GS', 'GE', 'GM', 'GILD', 'GD', 'GPN', 'GIS', 'GLW'],
    'H': ['HD', 'HON', 'HUM', 'HCA', 'HPQ', 'HSBC', 'HLT', 'HPE', 'HAL', 'HOOD'],
    'I': ['INTC', 'IBM', 'INTU', 'ISRG', 'ICE', 'ITW', 'IDXX', 'IQV', 'IR', 'ILMN'],
    'J': ['JPM', 'JNJ', 'JBHT', 'JCI', 'JD', 'JWN', 'JNPR', 'J', 'JAZZ', 'JLL'],
    'K': ['KO', 'KHC', 'KLAC', 'KMB', 'KMI', 'KDP', 'K', 'KR', 'KSS', 'KEYS'],
    'L': ['LLY', 'LMT', 'LOW', 'LRCX', 'LIN', 'LVS', 'LULU', 'LUV', 'LYFT', 'LEN'],
    'M': ['MSFT', 'META', 'MA', 'MCD', 'MRK', 'MMM', 'MO', 'MS', 'MDLZ', 'MU'],
    'N': ['NVDA', 'NFLX', 'NKE', 'NOW', 'NEE', 'NEM', 'NSC', 'NDAQ', 'NOC', 'NUE'],
    'O': ['ORCL', 'OXY', 'ON', 'ODFL', 'OMC', 'ORLY', 'OKE', 'OTIS', 'O', 'OKTA'],
    'P': ['PG', 'PFE', 'PEP', 'PYPL', 'PM', 'PANW', 'PNC', 'PSX', 'PLD', 'PLTR'],
    'Q': ['QCOM', 'QQQ', 'QRVO', 'QSR'],
    'R': ['RTX', 'REGN', 'ROP', 'ROST', 'RCL', 'RSG', 'RIVN', 'RBLX', 'RF', 'RMD'],
    'S': ['SPY', 'SBUX', 'SCHW', 'SLB', 'SO', 'SNOW', 'SHOP', 'SQ', 'SNAP', 'SOFI'],
    'T': ['TSLA', 'T', 'TGT', 'TMO', 'TXN', 'TJX', 'TMUS', 'TTWO', 'TFC', 'TWLO'],
    'U': ['UNH', 'UPS', 'USB', 'UBER', 'ULTA', 'UAL', 'U', 'URI', 'UNP', 'UPST'],
    'V': ['V', 'VZ', 'VRTX', 'VLO', 'VMW', 'VFC', 'VRSK', 'VOO', 'VTI', 'VNQ'],
    'W': ['WMT', 'WFC', 'WBA', 'WBD', 'WM', 'WDAY', 'W', 'WDC', 'WST', 'WELL'],
    'X': ['XOM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLNX', 'XYL'],
    'Y': ['YUM', 'YELP', 'YUMC'],
    'Z': ['ZTS', 'ZM', 'ZS', 'Z', 'ZG', 'ZBH', 'ZBRA', 'ZI']
  }

  const searchStocks = useCallback(debounce(async (q) => {
    // Don't search if we're in the middle of selecting a stock
    if (isSelectingRef.current) return

    if (!q.trim() || q.length < 1) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    setSearchLoading(true)
    try {
      // Use Yahoo search - no rate limits
      const data = await yahooFetch(q, 'search')
      // Handle both API response formats
      const items = data?.results || data?.quotes || []
      let results = items
        .filter(r => {
          const itemType = r.type || r.quoteType
          return itemType === 'EQUITY' || itemType === 'ETF'
        })
        .map(r => ({
          symbol: r.symbol,
          name: r.name || r.shortname || r.longname || r.symbol,
          type: r.type || r.quoteType || 'EQUITY'
        }))

      // Supplement with popular stocks for short queries
      if (results.length < 5 && q.length <= 2) {
        const firstLetter = q.charAt(0).toUpperCase()
        const popularSymbols = POPULAR_STOCKS[firstLetter] || []
        const queryUpper = q.toUpperCase()

        const matchingPopular = popularSymbols
          .filter(sym => sym.startsWith(queryUpper))
          .filter(sym => !results.some(r => r.symbol === sym))
          .map(sym => ({ symbol: sym, name: sym, type: 'EQUITY' }))

        results = [...results, ...matchingPopular]
      }

      // Deduplicate and limit
      const seen = new Set()
      results = results.filter(r => {
        if (seen.has(r.symbol)) return false
        seen.add(r.symbol)
        return true
      }).slice(0, 10)

      // Only show dropdown if not selecting
      if (!isSelectingRef.current) {
        setSearchResults(results)
        setShowDropdown(true)
        setSelectedIndex(0)
      }
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
    // Prevent dropdown from reopening
    isSelectingRef.current = true
    setShowDropdown(false)
    setSearchResults([])
    setSymbol(sym)

    // Start analysis after a brief delay
    setTimeout(() => {
      analyzeStock(sym)
      // Reset the flag after analysis starts
      setTimeout(() => { isSelectingRef.current = false }, 500)
    }, 50)
  }

  const analyzeStock = async (stockSymbol) => {
    const sym = (stockSymbol || symbol).toUpperCase().trim()
    if (!sym) return

    setLoading(true)
    setError(null)
    setCurrentAnalysis(null)
    setShowDropdown(false)
    setLoadingStep('Fetching quote data...')

    try {
      // STEP 1: Fetch comprehensive quote data from Yahoo
      const yahooData = await yahooFetch(sym)
      const quote = normalizeYahooQuote(yahooData)
      if (!quote || quote.c === 0) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      setLoadingStep('Analyzing price history...')

      // STEP 2: Fetch 3-month chart data for comprehensive trend analysis
      let chartPrices = []
      let technicals = null
      let weekChange = 0, monthChange = 0, threeMonthChange = 0
      try {
        const chartData = await yahooFetch(sym, 'chart', { range: '3mo', interval: '1d' })
        if (chartData?.chart?.result?.[0]) {
          const result = chartData.chart.result[0]
          const closes = result.indicators?.quote?.[0]?.close || []
          chartPrices = closes.filter(c => c !== null)

          if (chartPrices.length >= 5) {
            const latest = chartPrices[chartPrices.length - 1]

            // Calculate performance over different periods
            if (chartPrices.length >= 5) {
              weekChange = ((latest - chartPrices[chartPrices.length - 5]) / chartPrices[chartPrices.length - 5] * 100)
            }
            if (chartPrices.length >= 21) {
              monthChange = ((latest - chartPrices[chartPrices.length - 21]) / chartPrices[chartPrices.length - 21] * 100)
            }
            if (chartPrices.length >= 63) {
              threeMonthChange = ((latest - chartPrices[0]) / chartPrices[0] * 100)
            }

            // Calculate technical indicators
            technicals = calculateTechnicalIndicators(chartPrices)
          }
        }
      } catch {}

      setLoadingStep('Gathering latest news...')

      // STEP 3: Fetch company news from Finnhub
      const today = new Date()
      const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
      const fromDate = twoWeeksAgo.toISOString().split('T')[0]
      const toDate = today.toISOString().split('T')[0]

      let news = []
      try {
        const newsData = await finnhubFetch(`/company-news?symbol=${sym}&from=${fromDate}&to=${toDate}`)
        if (Array.isArray(newsData)) {
          news = newsData.slice(0, 8)
        } else if (newsData && typeof newsData === 'object') {
          news = Object.values(newsData).filter(n => n && n.headline).slice(0, 8)
        }
      } catch {}

      setLoadingStep('Running AI analysis...')

      // Calculate key metrics
      const change = quote.changePercent || 0
      const weekHigh52 = quote.weekHigh52
      const weekLow52 = quote.weekLow52

      // Calculate position in 52-week range
      let pricePosition = null
      if (weekHigh52 && weekLow52 && quote.c) {
        const range = weekHigh52 - weekLow52
        if (range > 0) {
          pricePosition = Math.round((quote.c - weekLow52) / range * 100)
        }
      }

      // Volume analysis
      const volumeRatio = quote.avgVolume ? (quote.volume / quote.avgVolume) : null
      const volumeStatus = volumeRatio ? (volumeRatio > 1.5 ? 'heavy' : volumeRatio < 0.5 ? 'light' : 'normal') : 'unknown'

      // Distance from moving averages
      const distFrom50MA = quote.fiftyDayAvg ? ((quote.c - quote.fiftyDayAvg) / quote.fiftyDayAvg * 100).toFixed(1) : null
      const distFrom200MA = quote.twoHundredDayAvg ? ((quote.c - quote.twoHundredDayAvg) / quote.twoHundredDayAvg * 100).toFixed(1) : null

      // Build comprehensive stock context for AI
      const stockContext = {
        symbol: sym,
        name: quote.name || sym,
        sector: quote.sector || 'Unknown',
        industry: quote.industry || 'Unknown',
        price: {
          current: quote.c,
          open: quote.o,
          high: quote.h,
          low: quote.l,
          previousClose: quote.pc,
          changeToday: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
        },
        valuation: {
          marketCap: quote.marketCap ? `$${(quote.marketCap / 1e9).toFixed(1)}B` : 'N/A',
          peRatio: quote.peRatio?.toFixed(1) || 'N/A',
          forwardPE: quote.forwardPE?.toFixed(1) || 'N/A',
          eps: quote.eps?.toFixed(2) || 'N/A',
          priceToBook: quote.priceToBook?.toFixed(2) || 'N/A',
          dividendYield: quote.dividendYield ? `${(quote.dividendYield * 100).toFixed(2)}%` : 'None'
        },
        fiftyTwoWeek: {
          high: weekHigh52?.toFixed(2) || 'N/A',
          low: weekLow52?.toFixed(2) || 'N/A',
          positionInRange: pricePosition !== null ? `${pricePosition}%` : 'N/A',
          nearHigh: pricePosition !== null && pricePosition > 85,
          nearLow: pricePosition !== null && pricePosition < 15
        },
        movingAverages: {
          fiftyDay: quote.fiftyDayAvg?.toFixed(2) || 'N/A',
          twoHundredDay: quote.twoHundredDayAvg?.toFixed(2) || 'N/A',
          distanceFrom50MA: distFrom50MA ? `${distFrom50MA}%` : 'N/A',
          distanceFrom200MA: distFrom200MA ? `${distFrom200MA}%` : 'N/A',
          above50MA: quote.fiftyDayAvg ? quote.c > quote.fiftyDayAvg : null,
          above200MA: quote.twoHundredDayAvg ? quote.c > quote.twoHundredDayAvg : null
        },
        performance: {
          week: `${weekChange >= 0 ? '+' : ''}${weekChange.toFixed(1)}%`,
          month: `${monthChange >= 0 ? '+' : ''}${monthChange.toFixed(1)}%`,
          threeMonth: `${threeMonthChange >= 0 ? '+' : ''}${threeMonthChange.toFixed(1)}%`
        },
        technicals: technicals ? {
          rsi: technicals.rsi,
          rsiStatus: technicals.rsi > 70 ? 'overbought' : technicals.rsi < 30 ? 'oversold' : 'neutral',
          momentum: `${technicals.momentum >= 0 ? '+' : ''}${technicals.momentum}%`,
          volatility: `${technicals.volatility}%`,
          trend: technicals.trend,
          support: `$${technicals.support}`,
          resistance: `$${technicals.resistance}`
        } : null,
        volume: {
          today: quote.volume?.toLocaleString() || 'N/A',
          average: quote.avgVolume?.toLocaleString() || 'N/A',
          ratio: volumeRatio?.toFixed(2) || 'N/A',
          status: volumeStatus
        },
        risk: {
          beta: quote.beta?.toFixed(2) || 'N/A'
        },
        analystTargetPrice: quote.targetPrice?.toFixed(2) || null,
        analystRating: quote.recommendation || null,
        newsHeadlines: news.slice(0, 5).map(n => n.headline).filter(Boolean)
      }

      // Build a comprehensive, powerful AI prompt
      const prompt = `You are a senior Wall Street equity analyst. Provide a thorough, professional analysis of ${sym} (${quote.name || sym}).

=== CURRENT MARKET DATA ===
Price: $${quote.c?.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}% today)
Market Cap: ${stockContext.valuation.marketCap}
Sector: ${quote.sector || 'Unknown'} | Industry: ${quote.industry || 'Unknown'}

=== VALUATION METRICS ===
P/E Ratio: ${stockContext.valuation.peRatio} (Forward: ${stockContext.valuation.forwardPE})
EPS: $${stockContext.valuation.eps}
Price/Book: ${stockContext.valuation.priceToBook}
Dividend Yield: ${stockContext.valuation.dividendYield}

=== PRICE POSITION ===
52-Week Range: $${stockContext.fiftyTwoWeek.low} - $${stockContext.fiftyTwoWeek.high}
Position in Range: ${stockContext.fiftyTwoWeek.positionInRange}
Distance from 50-Day MA: ${stockContext.movingAverages.distanceFrom50MA}
Distance from 200-Day MA: ${stockContext.movingAverages.distanceFrom200MA}

=== PERFORMANCE ===
1 Week: ${stockContext.performance.week}
1 Month: ${stockContext.performance.month}
3 Month: ${stockContext.performance.threeMonth}

${technicals ? `=== TECHNICAL INDICATORS ===
RSI(14): ${technicals.rsi} (${technicals.rsi > 70 ? 'OVERBOUGHT' : technicals.rsi < 30 ? 'OVERSOLD' : 'neutral'})
5-Day Momentum: ${stockContext.technicals.momentum}
Volatility: ${stockContext.technicals.volatility}
Trend: ${technicals.trend.toUpperCase()}
Support: ${stockContext.technicals.support} | Resistance: ${stockContext.technicals.resistance}
` : ''}
=== VOLUME ANALYSIS ===
Today vs Avg: ${stockContext.volume.ratio}x (${volumeStatus} volume)

${quote.beta ? `=== RISK ===
Beta: ${quote.beta.toFixed(2)} (${quote.beta > 1.2 ? 'High volatility vs market' : quote.beta < 0.8 ? 'Lower volatility vs market' : 'Market-like volatility'})
` : ''}
${quote.targetPrice ? `=== ANALYST CONSENSUS ===
Target Price: $${quote.targetPrice.toFixed(2)} (${((quote.targetPrice - quote.c) / quote.c * 100).toFixed(1)}% ${quote.targetPrice > quote.c ? 'upside' : 'downside'})
Rating: ${quote.recommendation || 'N/A'}
` : ''}
${news.length > 0 ? `=== RECENT NEWS ===
${news.slice(0, 5).map((n, i) => `${i + 1}. ${n.headline}`).join('\n')}
` : ''}

Based on ALL the data above, provide a comprehensive analysis. Be specific, reference the actual numbers, and give actionable insights.

Respond with ONLY this JSON structure (no other text):
{
  "rating": "STRONG_BUY" or "BUY" or "HOLD" or "SELL" or "STRONG_SELL",
  "confidenceScore": <number 1-100>,
  "summary": "<2-3 sentence executive summary of the investment thesis>",
  "technicalAnalysis": "<2-3 sentences analyzing price action, trend, momentum, RSI, support/resistance>",
  "fundamentalAnalysis": "<2-3 sentences on valuation - is P/E reasonable? Growth outlook? Compare to sector>",
  "sentimentAnalysis": "<1-2 sentences on news sentiment and what it signals>",
  "strengths": ["<specific strength with data>", "<strength 2>", "<strength 3>"],
  "risks": ["<specific risk with data>", "<risk 2>", "<risk 3>"],
  "keyLevels": {
    "support": "<price level to watch>",
    "resistance": "<price level to watch>",
    "stopLoss": "<suggested stop loss level>"
  },
  "catalyst": "<What specific event/trigger could move this stock in the near term>",
  "timeHorizon": "<Is this a short-term trade or long-term hold and why>",
  "bottomLine": "<One decisive sentence: exactly what an investor should do and why>"
}`

      const response = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, stockData: stockContext })
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

      // Clean and parse response
      const rawText = (data.insight || '').replace(/\*\*/g, '').replace(/\*/g, '').trim()

      // Try to parse JSON response
      let aiJson = null
      let sentiment = 'neutral'
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          aiJson = JSON.parse(jsonMatch[0])
          if (aiJson.rating) {
            const rating = aiJson.rating.toLowerCase()
            if (rating.includes('strong_buy') || rating.includes('buy')) sentiment = 'bullish'
            else if (rating.includes('strong_sell') || rating.includes('sell')) sentiment = 'bearish'
            else sentiment = 'neutral'
          }
        }
      } catch (e) {
        console.log('JSON parse failed, using text fallback')
      }

      // Fallback: extract from text if no JSON
      if (!aiJson) {
        const lower = rawText.toLowerCase()
        if (lower.includes('strong buy') || lower.includes('bullish') || lower.includes('buy')) sentiment = 'bullish'
        else if (lower.includes('strong sell') || lower.includes('bearish') || lower.includes('sell') || lower.includes('avoid')) sentiment = 'bearish'
      }

      const analysis = {
        symbol: sym,
        name: quote.name || sym,
        sector: quote.sector,
        industry: quote.industry,
        price: quote.c,
        previousClose: quote.pc,
        dayHigh: quote.h,
        dayLow: quote.l,
        open: quote.o,
        change,
        volume: quote.volume,
        avgVolume: quote.avgVolume,
        weekHigh52,
        weekLow52,
        pricePosition,
        fiftyDayAvg: quote.fiftyDayAvg,
        twoHundredDayAvg: quote.twoHundredDayAvg,
        peRatio: quote.peRatio,
        forwardPE: quote.forwardPE,
        eps: quote.eps,
        marketCap: quote.marketCap,
        dividendYield: quote.dividendYield,
        beta: quote.beta,
        targetPrice: quote.targetPrice,
        priceToBook: quote.priceToBook,
        performance: {
          week: weekChange,
          month: monthChange,
          threeMonth: threeMonthChange
        },
        technicals,
        news: news.slice(0, 5),
        analysis: rawText,
        aiJson,
        sentiment,
        confidenceScore: aiJson?.confidenceScore || null,
        timestamp: new Date().toISOString()
      }

      setCurrentAnalysis(analysis)
      setHistory(prev => {
        const filtered = prev.filter(h => h.symbol !== sym)
        return [analysis, ...filtered].slice(0, 10)
      })
      setSymbol('')

    } catch (err) {
      console.error('Analysis error:', err)
      setError(err.message || 'Failed to analyze stock. Please try again.')
    }

    setLoading(false)
    setLoadingStep('')
  }

  const getSentimentDisplay = (sentiment, rating) => {
    // Map rating to display
    const ratingUpper = (rating || '').toUpperCase()
    if (ratingUpper.includes('STRONG_BUY') || ratingUpper === 'STRONG BUY') {
      return { icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', label: 'STRONG BUY', bgSolid: 'bg-emerald-600', gradient: 'from-emerald-600 to-green-600' }
    }
    if (ratingUpper === 'BUY' || sentiment === 'bullish') {
      return { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30', label: 'BUY', bgSolid: 'bg-green-600', gradient: 'from-green-600 to-green-500' }
    }
    if (ratingUpper.includes('STRONG_SELL') || ratingUpper === 'STRONG SELL') {
      return { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/40', label: 'STRONG SELL', bgSolid: 'bg-red-600', gradient: 'from-red-600 to-red-500' }
    }
    if (ratingUpper === 'SELL' || sentiment === 'bearish') {
      return { icon: TrendingDown, color: 'text-orange-400', bg: 'bg-orange-500/20', border: 'border-orange-500/30', label: 'SELL', bgSolid: 'bg-orange-600', gradient: 'from-orange-600 to-red-600' }
    }
    return { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', label: 'HOLD', bgSolid: 'bg-yellow-600', gradient: 'from-yellow-600 to-amber-600' }
  }

  const getRatingColor = (rating) => {
    const r = (rating || '').toUpperCase()
    if (r.includes('STRONG_BUY') || r === 'STRONG BUY') return 'text-emerald-400'
    if (r === 'BUY') return 'text-green-400'
    if (r.includes('STRONG_SELL') || r === 'STRONG SELL') return 'text-red-400'
    if (r === 'SELL') return 'text-orange-400'
    return 'text-yellow-400'
  }

  const getConfidenceColor = (score) => {
    if (score >= 80) return 'text-emerald-400'
    if (score >= 60) return 'text-green-400'
    if (score >= 40) return 'text-yellow-400'
    return 'text-orange-400'
  }

  const s = currentAnalysis ? getSentimentDisplay(currentAnalysis.sentiment, currentAnalysis.aiJson?.rating) : null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500">
              <Brain className="w-6 h-6 text-white" />
            </div>
            AI Stock Analysis
          </h2>
          <p className="text-gray-400 mt-2">Professional-grade analysis powered by AI. Technical, fundamental, and sentiment insights.</p>
        </div>
        {history.length > 0 && !currentAnalysis && !loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Sparkles className="w-4 h-4" />
            <span>{history.length} recent {history.length === 1 ? 'analysis' : 'analyses'}</span>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative" ref={dropdownRef} data-tour="ai-search">
        <div className="flex items-center gap-3 p-4 rounded-xl border transition-all bg-gray-800 border-gray-700 focus-within:border-purple-500">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onFocus={() => symbol.length >= 1 && searchResults.length > 0 && setShowDropdown(true)}
            placeholder="Search stock symbol (e.g., AAPL, MSFT, TSLA)"
            className="flex-1 bg-transparent outline-none text-lg text-white placeholder-gray-500"
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
        <div className="p-8 rounded-xl border bg-gradient-to-br from-gray-800/80 to-gray-900/80 border-purple-500/30 text-center">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/20"></div>
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin"></div>
            <Brain className="absolute inset-0 m-auto w-8 h-8 text-purple-400" />
          </div>
          <p className="text-white font-medium text-lg">Analyzing {symbol}...</p>
          <p className="text-purple-400 text-sm mt-2 animate-pulse">{loadingStep}</p>
          <div className="flex justify-center gap-2 mt-4">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      )}

      {/* Analysis Result */}
      {currentAnalysis && !loading && (
        <div className="space-y-4">
          {/* Hero Header Card */}
          <div className={`rounded-2xl border-2 ${s.border} bg-gradient-to-br ${s.bg} overflow-hidden`}>
            {/* Rating Banner */}
            <div className={`bg-gradient-to-r ${s.gradient} px-5 py-3 flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <s.icon className="w-6 h-6 text-white" />
                <span className="text-white font-bold text-lg tracking-wide">{s.label}</span>
                {currentAnalysis.confidenceScore && (
                  <span className="bg-white/20 px-2 py-0.5 rounded text-white text-sm">
                    {currentAnalysis.confidenceScore}% confidence
                  </span>
                )}
              </div>
              <button onClick={() => setCurrentAnalysis(null)} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              {/* Stock Info */}
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-3xl font-bold text-white mb-1">{currentAnalysis.symbol}</h3>
                  <p className="text-gray-300 text-lg">{currentAnalysis.name}</p>
                  {(currentAnalysis.sector || currentAnalysis.industry) && (
                    <p className="text-gray-500 text-sm mt-1">
                      {currentAnalysis.sector}{currentAnalysis.industry ? ` • ${currentAnalysis.industry}` : ''}
                    </p>
                  )}
                </div>
                <div className="text-left md:text-right">
                  <div className="text-3xl font-bold text-white">${currentAnalysis.price?.toFixed(2)}</div>
                  <div className={`text-lg font-semibold flex items-center gap-1 md:justify-end ${currentAnalysis.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {currentAnalysis.change >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                    {currentAnalysis.change >= 0 ? '+' : ''}{currentAnalysis.change?.toFixed(2)}% today
                  </div>
                </div>
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Market Cap</div>
                  <div className="text-white font-semibold">
                    {currentAnalysis.marketCap ? `$${(currentAnalysis.marketCap / 1e9).toFixed(1)}B` : 'N/A'}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">P/E Ratio</div>
                  <div className="text-white font-semibold">{currentAnalysis.peRatio?.toFixed(1) || 'N/A'}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">52W Position</div>
                  <div className="text-white font-semibold">{currentAnalysis.pricePosition || 'N/A'}%</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Beta</div>
                  <div className="text-white font-semibold">{currentAnalysis.beta?.toFixed(2) || 'N/A'}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Div Yield</div>
                  <div className="text-white font-semibold">
                    {currentAnalysis.dividendYield ? `${(currentAnalysis.dividendYield * 100).toFixed(2)}%` : 'None'}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Analyst Target</div>
                  <div className="text-white font-semibold">
                    {currentAnalysis.targetPrice ? `$${currentAnalysis.targetPrice.toFixed(0)}` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Performance & Technicals Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Performance Card */}
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-blue-400" />
                <h4 className="font-semibold text-white">Performance</h4>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-1">1 Week</div>
                  <div className={`font-bold ${currentAnalysis.performance?.week >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {currentAnalysis.performance?.week >= 0 ? '+' : ''}{currentAnalysis.performance?.week?.toFixed(1) || 0}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-1">1 Month</div>
                  <div className={`font-bold ${currentAnalysis.performance?.month >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {currentAnalysis.performance?.month >= 0 ? '+' : ''}{currentAnalysis.performance?.month?.toFixed(1) || 0}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-1">3 Month</div>
                  <div className={`font-bold ${currentAnalysis.performance?.threeMonth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {currentAnalysis.performance?.threeMonth >= 0 ? '+' : ''}{currentAnalysis.performance?.threeMonth?.toFixed(1) || 0}%
                  </div>
                </div>
              </div>
              {/* 52-Week Range Bar */}
              <div className="mt-4 pt-4 border-t border-gray-700">
                <div className="flex justify-between text-xs text-gray-400 mb-2">
                  <span>52W Low: ${currentAnalysis.weekLow52?.toFixed(2) || 'N/A'}</span>
                  <span>52W High: ${currentAnalysis.weekHigh52?.toFixed(2) || 'N/A'}</span>
                </div>
                <div className="relative h-2 bg-gray-700 rounded-full">
                  <div
                    className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full"
                    style={{ width: '100%' }}
                  ></div>
                  {currentAnalysis.pricePosition !== null && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full border-2 border-gray-900 shadow-lg"
                      style={{ left: `calc(${currentAnalysis.pricePosition}% - 6px)` }}
                    ></div>
                  )}
                </div>
              </div>
            </div>

            {/* Technicals Card */}
            {currentAnalysis.technicals && (
              <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-5 h-5 text-purple-400" />
                  <h4 className="font-semibold text-white">Technical Indicators</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">RSI (14)</div>
                    <div className={`font-bold ${
                      currentAnalysis.technicals.rsi > 70 ? 'text-red-400' :
                      currentAnalysis.technicals.rsi < 30 ? 'text-green-400' : 'text-gray-300'
                    }`}>
                      {currentAnalysis.technicals.rsi}
                      <span className="text-xs text-gray-500 ml-1">
                        ({currentAnalysis.technicals.rsi > 70 ? 'Overbought' : currentAnalysis.technicals.rsi < 30 ? 'Oversold' : 'Neutral'})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Trend</div>
                    <div className={`font-bold capitalize ${
                      currentAnalysis.technicals.trend === 'bullish' ? 'text-green-400' :
                      currentAnalysis.technicals.trend === 'bearish' ? 'text-red-400' : 'text-gray-300'
                    }`}>
                      {currentAnalysis.technicals.trend}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Momentum (5D)</div>
                    <div className={`font-bold ${currentAnalysis.technicals.momentum >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {currentAnalysis.technicals.momentum >= 0 ? '+' : ''}{currentAnalysis.technicals.momentum}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Volatility</div>
                    <div className="font-bold text-gray-300">{currentAnalysis.technicals.volatility}%</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between text-sm">
                  <span className="text-gray-400">Support: <span className="text-green-400 font-medium">${currentAnalysis.technicals.support}</span></span>
                  <span className="text-gray-400">Resistance: <span className="text-red-400 font-medium">${currentAnalysis.technicals.resistance}</span></span>
                </div>
              </div>
            )}
          </div>

          {/* AI Analysis Content */}
          {currentAnalysis.aiJson && (
            <>
              {/* Executive Summary */}
              {currentAnalysis.aiJson.summary && (
                <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5">
                  <div className="flex items-start gap-3">
                    <Brain className="w-6 h-6 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-purple-300 mb-2">AI Summary</h4>
                      <p className="text-gray-200 text-base leading-relaxed">{currentAnalysis.aiJson.summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Analysis Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Technical Analysis */}
                {currentAnalysis.aiJson.technicalAnalysis && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="w-5 h-5 text-blue-400" />
                      <h4 className="font-semibold text-blue-300">Technical Analysis</h4>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentAnalysis.aiJson.technicalAnalysis}</p>
                  </div>
                )}

                {/* Fundamental Analysis */}
                {currentAnalysis.aiJson.fundamentalAnalysis && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <PieChart className="w-5 h-5 text-cyan-400" />
                      <h4 className="font-semibold text-cyan-300">Fundamental Analysis</h4>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentAnalysis.aiJson.fundamentalAnalysis}</p>
                  </div>
                )}

                {/* Sentiment Analysis */}
                {currentAnalysis.aiJson.sentimentAnalysis && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Newspaper className="w-5 h-5 text-amber-400" />
                      <h4 className="font-semibold text-amber-300">News Sentiment</h4>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{currentAnalysis.aiJson.sentimentAnalysis}</p>
                  </div>
                )}
              </div>

              {/* Strengths & Risks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Strengths */}
                {currentAnalysis.aiJson.strengths && currentAnalysis.aiJson.strengths.length > 0 && (
                  <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <h4 className="font-semibold text-green-400">Strengths</h4>
                    </div>
                    <ul className="space-y-2">
                      {currentAnalysis.aiJson.strengths.map((str, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-green-400 mt-0.5 font-bold">+</span>
                          <span>{str}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks */}
                {currentAnalysis.aiJson.risks && currentAnalysis.aiJson.risks.length > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-5 h-5 text-red-400" />
                      <h4 className="font-semibold text-red-400">Risks</h4>
                    </div>
                    <ul className="space-y-2">
                      {currentAnalysis.aiJson.risks.map((risk, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                          <span className="text-red-400 mt-0.5 font-bold">!</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Key Levels & Catalyst Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Key Price Levels */}
                {currentAnalysis.aiJson.keyLevels && (
                  <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-5 h-5 text-purple-400" />
                      <h4 className="font-semibold text-white">Key Price Levels</h4>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Support</div>
                        <div className="text-green-400 font-bold">{currentAnalysis.aiJson.keyLevels.support || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Resistance</div>
                        <div className="text-red-400 font-bold">{currentAnalysis.aiJson.keyLevels.resistance || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Stop Loss</div>
                        <div className="text-orange-400 font-bold">{currentAnalysis.aiJson.keyLevels.stopLoss || 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Catalyst & Time Horizon */}
                <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                  <div className="space-y-4">
                    {currentAnalysis.aiJson.catalyst && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-yellow-400" />
                          <span className="text-xs text-gray-400 uppercase tracking-wide">Catalyst</span>
                        </div>
                        <p className="text-gray-300 text-sm">{currentAnalysis.aiJson.catalyst}</p>
                      </div>
                    )}
                    {currentAnalysis.aiJson.timeHorizon && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="w-4 h-4 text-blue-400" />
                          <span className="text-xs text-gray-400 uppercase tracking-wide">Time Horizon</span>
                        </div>
                        <p className="text-gray-300 text-sm">{currentAnalysis.aiJson.timeHorizon}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Line - Hero */}
              {currentAnalysis.aiJson.bottomLine && (
                <div className={`rounded-xl border-2 ${s.border} bg-gradient-to-r ${s.bg} p-5`}>
                  <div className="flex items-start gap-3">
                    <Award className={`w-7 h-7 ${s.color} flex-shrink-0`} />
                    <div>
                      <h4 className="font-bold text-white text-lg mb-2">Bottom Line</h4>
                      <p className="text-white text-base font-medium leading-relaxed">{currentAnalysis.aiJson.bottomLine}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Fallback for non-JSON response */}
          {!currentAnalysis.aiJson && currentAnalysis.analysis && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-purple-400" />
                <h4 className="font-semibold text-white">AI Analysis</h4>
              </div>
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{currentAnalysis.analysis}</p>
            </div>
          )}

          {/* News Headlines */}
          {currentAnalysis.news && currentAnalysis.news.length > 0 && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Newspaper className="w-4 h-4 text-gray-400" />
                <h4 className="text-sm font-medium text-gray-400">News Sources Analyzed</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {currentAnalysis.news.map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-sm text-gray-400 hover:text-blue-400 transition-colors group"
                  >
                    <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                    <span className="line-clamp-1">{article.headline}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer Footer */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-gray-500 px-1 pt-2 border-t border-gray-800">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>AI-generated analysis for informational purposes only. Not financial advice. Always do your own research.</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <Clock className="w-3.5 h-3.5" />
              <span>{new Date(currentAnalysis.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && !loading && !currentAnalysis && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Recent Analyses
            </h3>
            <button
              onClick={() => { setHistory([]); localStorage.removeItem('ai_analysis_history') }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {history.map((item) => {
              const hs = getSentimentDisplay(item.sentiment, item.aiJson?.rating)
              return (
                <button
                  key={`${item.symbol}-${item.timestamp}`}
                  onClick={() => setCurrentAnalysis(item)}
                  className={`p-4 rounded-xl border-2 ${hs.border} ${hs.bg} hover:scale-[1.02] text-left transition-all group`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-white text-xl">{item.symbol}</span>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-gradient-to-r ${hs.gradient}`}>
                      {hs.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-white font-semibold">${item.price?.toFixed(2)}</div>
                      <div className={`text-sm font-medium ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {item.change >= 0 ? '+' : ''}{item.change?.toFixed(2)}%
                      </div>
                    </div>
                    {item.confidenceScore && (
                      <div className="text-right">
                        <div className={`text-lg font-bold ${getConfidenceColor(item.confidenceScore)}`}>
                          {item.confidenceScore}%
                        </div>
                        <div className="text-xs text-gray-500">confidence</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center justify-between text-xs text-gray-500">
                    <span>{item.sector || 'Stock'}</span>
                    <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!currentAnalysis && !loading && history.length === 0 && (
        <div className="rounded-2xl p-10 border-2 border-dashed border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-blue-500/5 text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-pulse"></div>
            <Brain className="absolute inset-0 m-auto w-10 h-10 text-purple-400" />
          </div>
          <h3 className="text-xl font-bold mb-3 text-white">AI-Powered Stock Analysis</h3>
          <p className="text-gray-400 max-w-lg mx-auto mb-6 leading-relaxed">
            Get comprehensive, professional-grade analysis on any stock. Our AI examines fundamentals, technicals, news sentiment, and market positioning to deliver actionable insights.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <span className="px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Technical Analysis</span>
            <span className="px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Fundamental Metrics</span>
            <span className="px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">News Sentiment</span>
            <span className="px-3 py-1.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Price Targets</span>
          </div>
        </div>
      )}
    </div>
  )
}
