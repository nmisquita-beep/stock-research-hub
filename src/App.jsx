import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Plus,
  X,
  Settings,
  BarChart3,
  Newspaper,
  FileText,
  Home,
  Clock,
  RefreshCw,
  Star,
  Trash2,
  Save,
  AlertCircle,
  CheckCircle,
  Eye,
  Activity
} from 'lucide-react'

// Rate Limiter for Finnhub API (60 calls/min)
class RateLimiter {
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls
    this.windowMs = windowMs
    this.calls = []
  }

  async throttle() {
    const now = Date.now()
    this.calls = this.calls.filter(time => now - time < this.windowMs)

    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0]
      const waitTime = this.windowMs - (now - oldestCall) + 100
      await new Promise(resolve => setTimeout(resolve, waitTime))
      return this.throttle()
    }

    this.calls.push(now)
    return true
  }

  getStatus() {
    const now = Date.now()
    this.calls = this.calls.filter(time => now - time < this.windowMs)
    return {
      used: this.calls.length,
      remaining: this.maxCalls - this.calls.length,
      resetsIn: this.calls.length > 0 ? Math.ceil((this.windowMs - (now - this.calls[0])) / 1000) : 0
    }
  }
}

const rateLimiter = new RateLimiter(60, 60000)

// Finnhub API helper
const finnhubFetch = async (endpoint, apiKey) => {
  await rateLimiter.throttle()
  const response = await fetch(`https://finnhub.io/api/v1${endpoint}&token=${apiKey}`)
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }
  return response.json()
}

// Format timestamp
const formatTimestamp = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

// Format currency
const formatCurrency = (value) => {
  if (value === null || value === undefined) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

// Format large numbers
const formatLargeNumber = (value) => {
  if (value === null || value === undefined) return 'N/A'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return formatCurrency(value)
}

// API Key Setup Screen
function ApiKeySetup({ onSave }) {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)

  const testAndSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setTesting(true)
    setError('')

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${apiKey}`
      )
      const data = await response.json()

      if (data.error) {
        setError('Invalid API key. Please check and try again.')
      } else if (data.c === 0 && data.h === 0) {
        setError('API key seems invalid or rate limited.')
      } else {
        localStorage.setItem('finnhub_api_key', apiKey)
        onSave(apiKey)
      }
    } catch {
      setError('Failed to validate API key. Please try again.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Stock Research Hub</h1>
          <p className="text-gray-400">Enter your Finnhub API key to get started</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Finnhub API Key
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <button
            onClick={testAndSave}
            disabled={testing}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {testing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Save & Continue
              </>
            )}
          </button>

          <div className="text-center">
            <a
              href="https://finnhub.io/register"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Get a free API key from Finnhub
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// Navigation
function Navigation({ activePage, setActivePage, rateLimitStatus }) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  return (
    <nav className="bg-gray-800 border-b border-gray-700">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-500" />
            <span className="text-white font-bold text-lg">Stock Research Hub</span>
          </div>

          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activePage === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">
              API: {rateLimitStatus.remaining}/{60}
            </span>
          </div>
        </div>
      </div>
    </nav>
  )
}

// Market Index Card
function MarketIndexCard({ symbol, data, loading }) {
  const priceChange = data ? data.c - data.pc : 0
  const percentChange = data && data.pc ? ((priceChange / data.pc) * 100) : 0
  const isPositive = priceChange >= 0

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 font-medium">{symbol}</span>
        {loading ? (
          <RefreshCw className="w-4 h-4 text-gray-500 animate-spin" />
        ) : isPositive ? (
          <TrendingUp className="w-4 h-4 text-green-500" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-500" />
        )}
      </div>

      {loading ? (
        <div className="animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-24 mb-2" />
          <div className="h-4 bg-gray-700 rounded w-16" />
        </div>
      ) : data ? (
        <>
          <div className="text-2xl font-bold text-white">
            {formatCurrency(data.c)}
          </div>
          <div className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? '+' : ''}{formatCurrency(priceChange)} ({isPositive ? '+' : ''}{percentChange.toFixed(2)}%)
          </div>
          {data.timestamp && (
            <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(data.timestamp)}
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-500">No data</div>
      )}
    </div>
  )
}

// Market Overview Page
function MarketOverview({ apiKey, onSelectStock }) {
  const [marketData, setMarketData] = useState({})
  const [loading, setLoading] = useState(true)
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']

  const fetchMarketData = useCallback(async () => {
    setLoading(true)
    const newData = {}

    for (const symbol of indices) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        newData[symbol] = { ...data, timestamp: new Date() }
      } catch (err) {
        console.error(`Error fetching ${symbol}:`, err)
      }
    }

    setMarketData(newData)
    setLoading(false)
  }, [apiKey])

  useEffect(() => {
    fetchMarketData()
    const interval = setInterval(fetchMarketData, 60000)
    return () => clearInterval(interval)
  }, [fetchMarketData])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Market Overview</h2>
        <button
          onClick={fetchMarketData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {indices.map((symbol) => (
          <div key={symbol} onClick={() => onSelectStock(symbol)} className="cursor-pointer">
            <MarketIndexCard
              symbol={symbol}
              data={marketData[symbol]}
              loading={loading && !marketData[symbol]}
            />
          </div>
        ))}
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Index Descriptions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <span className="font-medium text-blue-400">SPY</span>
            <p className="text-gray-400 text-sm mt-1">SPDR S&P 500 ETF - Tracks the S&P 500 index of large-cap US stocks</p>
          </div>
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <span className="font-medium text-blue-400">QQQ</span>
            <p className="text-gray-400 text-sm mt-1">Invesco QQQ Trust - Tracks the Nasdaq-100 Index of tech-heavy stocks</p>
          </div>
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <span className="font-medium text-blue-400">DIA</span>
            <p className="text-gray-400 text-sm mt-1">SPDR Dow Jones Industrial Average ETF - Tracks the 30 Dow Jones stocks</p>
          </div>
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <span className="font-medium text-blue-400">IWM</span>
            <p className="text-gray-400 text-sm mt-1">iShares Russell 2000 ETF - Tracks small-cap US stocks</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Stock Detail Modal
function StockDetail({ symbol, apiKey, onClose }) {
  const [quote, setQuote] = useState(null)
  const [profile, setProfile] = useState(null)
  const [financials, setFinancials] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [quoteData, profileData, financialsData] = await Promise.all([
          finnhubFetch(`/quote?symbol=${symbol}`, apiKey),
          finnhubFetch(`/stock/profile2?symbol=${symbol}`, apiKey),
          finnhubFetch(`/stock/metric?symbol=${symbol}&metric=all`, apiKey)
        ])
        setQuote({ ...quoteData, timestamp: new Date() })
        setProfile(profileData)
        setFinancials(financialsData)
      } catch (err) {
        console.error('Error fetching stock details:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [symbol, apiKey])

  const priceChange = quote ? quote.c - quote.pc : 0
  const percentChange = quote && quote.pc ? ((priceChange / quote.pc) * 100) : 0
  const isPositive = priceChange >= 0
  const metrics = financials?.metric || {}

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {profile?.logo && (
              <img src={profile.logo} alt={symbol} className="w-12 h-12 rounded-lg bg-white p-1" />
            )}
            <div>
              <h2 className="text-xl font-bold text-white">{symbol}</h2>
              <p className="text-gray-400">{profile?.name || 'Loading...'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Price Section */}
            <div className="bg-gray-700/50 rounded-xl p-6">
              <div className="flex items-baseline gap-4">
                <span className="text-4xl font-bold text-white">
                  {formatCurrency(quote?.c)}
                </span>
                <span className={`text-lg font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {isPositive ? '+' : ''}{formatCurrency(priceChange)} ({isPositive ? '+' : ''}{percentChange.toFixed(2)}%)
                </span>
              </div>
              {quote?.timestamp && (
                <div className="text-sm text-gray-400 mt-2 flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Last updated: {formatTimestamp(quote.timestamp)}
                </div>
              )}
            </div>

            {/* Price Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-700/50 rounded-lg p-4">
                <div className="text-gray-400 text-sm">Open</div>
                <div className="text-white font-medium">{formatCurrency(quote?.o)}</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4">
                <div className="text-gray-400 text-sm">High</div>
                <div className="text-white font-medium">{formatCurrency(quote?.h)}</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4">
                <div className="text-gray-400 text-sm">Low</div>
                <div className="text-white font-medium">{formatCurrency(quote?.l)}</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4">
                <div className="text-gray-400 text-sm">Prev Close</div>
                <div className="text-white font-medium">{formatCurrency(quote?.pc)}</div>
              </div>
            </div>

            {/* Company Info */}
            {profile && Object.keys(profile).length > 0 && (
              <div className="bg-gray-700/50 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Company Information</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-gray-400 text-sm">Industry</div>
                    <div className="text-white">{profile.finnhubIndustry || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Market Cap</div>
                    <div className="text-white">{formatLargeNumber(profile.marketCapitalization * 1e6)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Exchange</div>
                    <div className="text-white">{profile.exchange || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">IPO Date</div>
                    <div className="text-white">{profile.ipo || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Country</div>
                    <div className="text-white">{profile.country || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Website</div>
                    <a href={profile.weburl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 truncate block">
                      {profile.weburl || 'N/A'}
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Financial Metrics */}
            {Object.keys(metrics).length > 0 && (
              <div className="bg-gray-700/50 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Key Financial Metrics</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-gray-400 text-sm">P/E Ratio (TTM)</div>
                    <div className="text-white font-medium">{metrics.peBasicExclExtraTTM?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">P/B Ratio</div>
                    <div className="text-white font-medium">{metrics.pbAnnual?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">EPS (TTM)</div>
                    <div className="text-white font-medium">{metrics.epsBasicExclExtraItemsTTM?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Dividend Yield</div>
                    <div className="text-white font-medium">{metrics.dividendYieldIndicatedAnnual ? `${metrics.dividendYieldIndicatedAnnual.toFixed(2)}%` : 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">52W High</div>
                    <div className="text-white font-medium">{formatCurrency(metrics['52WeekHigh'])}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">52W Low</div>
                    <div className="text-white font-medium">{formatCurrency(metrics['52WeekLow'])}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">Beta</div>
                    <div className="text-white font-medium">{metrics.beta?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-sm">ROE (TTM)</div>
                    <div className="text-white font-medium">{metrics.roeTTM ? `${metrics.roeTTM.toFixed(2)}%` : 'N/A'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Watchlist Page
function Watchlist({ apiKey, watchlist, setWatchlist, onSelectStock }) {
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [newSymbol, setNewSymbol] = useState('')
  const [addError, setAddError] = useState('')

  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) return
    setLoading(true)
    const newQuotes = {}

    for (const symbol of watchlist) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        newQuotes[symbol] = { ...data, timestamp: new Date() }
      } catch (err) {
        console.error(`Error fetching ${symbol}:`, err)
      }
    }

    setQuotes(newQuotes)
    setLoading(false)
  }, [apiKey, watchlist])

  useEffect(() => {
    fetchQuotes()
    const interval = setInterval(fetchQuotes, 60000)
    return () => clearInterval(interval)
  }, [fetchQuotes])

  const addSymbol = async () => {
    const symbol = newSymbol.trim().toUpperCase()
    if (!symbol) return
    if (watchlist.includes(symbol)) {
      setAddError('Symbol already in watchlist')
      return
    }

    setAddError('')
    try {
      const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
      if (data.c === 0 && data.h === 0 && data.l === 0) {
        setAddError('Invalid symbol or no data available')
        return
      }

      const newWatchlist = [...watchlist, symbol]
      setWatchlist(newWatchlist)
      localStorage.setItem('watchlist', JSON.stringify(newWatchlist))
      setQuotes(prev => ({ ...prev, [symbol]: { ...data, timestamp: new Date() } }))
      setNewSymbol('')
    } catch {
      setAddError('Failed to add symbol')
    }
  }

  const removeSymbol = (symbol) => {
    const newWatchlist = watchlist.filter(s => s !== symbol)
    setWatchlist(newWatchlist)
    localStorage.setItem('watchlist', JSON.stringify(newWatchlist))
    setQuotes(prev => {
      const { [symbol]: _, ...rest } = prev
      return rest
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Watchlist</h2>
        <button
          onClick={fetchQuotes}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Add Symbol */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
              placeholder="Enter stock symbol (e.g., AAPL)"
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={addSymbol}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        {addError && (
          <div className="mt-2 text-red-400 text-sm flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {addError}
          </div>
        )}
      </div>

      {/* Watchlist Table */}
      {watchlist.length > 0 ? (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700/50">
              <tr>
                <th className="text-left p-4 text-gray-400 font-medium">Symbol</th>
                <th className="text-right p-4 text-gray-400 font-medium">Price</th>
                <th className="text-right p-4 text-gray-400 font-medium">Change</th>
                <th className="text-right p-4 text-gray-400 font-medium hidden sm:table-cell">High</th>
                <th className="text-right p-4 text-gray-400 font-medium hidden sm:table-cell">Low</th>
                <th className="text-right p-4 text-gray-400 font-medium hidden md:table-cell">Updated</th>
                <th className="text-center p-4 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {watchlist.map((symbol) => {
                const quote = quotes[symbol]
                const priceChange = quote ? quote.c - quote.pc : 0
                const percentChange = quote && quote.pc ? ((priceChange / quote.pc) * 100) : 0
                const isPositive = priceChange >= 0

                return (
                  <tr key={symbol} className="hover:bg-gray-700/50">
                    <td className="p-4">
                      <button
                        onClick={() => onSelectStock(symbol)}
                        className="text-white font-medium hover:text-blue-400 transition-colors"
                      >
                        {symbol}
                      </button>
                    </td>
                    <td className="p-4 text-right text-white font-medium">
                      {quote ? formatCurrency(quote.c) : (
                        <div className="animate-pulse h-5 bg-gray-700 rounded w-16 ml-auto" />
                      )}
                    </td>
                    <td className={`p-4 text-right font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                      {quote ? (
                        <>
                          {isPositive ? '+' : ''}{percentChange.toFixed(2)}%
                        </>
                      ) : (
                        <div className="animate-pulse h-5 bg-gray-700 rounded w-12 ml-auto" />
                      )}
                    </td>
                    <td className="p-4 text-right text-gray-300 hidden sm:table-cell">
                      {quote ? formatCurrency(quote.h) : '-'}
                    </td>
                    <td className="p-4 text-right text-gray-300 hidden sm:table-cell">
                      {quote ? formatCurrency(quote.l) : '-'}
                    </td>
                    <td className="p-4 text-right text-gray-400 text-sm hidden md:table-cell">
                      {quote?.timestamp ? formatTimestamp(quote.timestamp) : '-'}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => onSelectStock(symbol)}
                          className="p-2 hover:bg-gray-600 rounded-lg transition-colors text-gray-400 hover:text-white"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeSymbol(symbol)}
                          className="p-2 hover:bg-red-600/20 rounded-lg transition-colors text-gray-400 hover:text-red-400"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-12 border border-gray-700 text-center">
          <Star className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-300 mb-2">Your watchlist is empty</h3>
          <p className="text-gray-500">Add stock symbols above to start tracking prices</p>
        </div>
      )}
    </div>
  )
}

// News Page
function NewsPage({ apiKey }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('general')

  const categories = [
    { id: 'general', label: 'General' },
    { id: 'forex', label: 'Forex' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'merger', label: 'M&A' }
  ]

  const fetchNews = useCallback(async () => {
    setLoading(true)
    try {
      const data = await finnhubFetch(`/news?category=${category}`, apiKey)
      setNews(Array.isArray(data) ? data.slice(0, 20) : [])
    } catch (err) {
      console.error('Error fetching news:', err)
      setNews([])
    } finally {
      setLoading(false)
    }
  }, [apiKey, category])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Market News</h2>
        <button
          onClick={fetchNews}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
              category === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* News List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-4 border border-gray-700 animate-pulse">
              <div className="h-6 bg-gray-700 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-700 rounded w-full mb-2" />
              <div className="h-4 bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : news.length > 0 ? (
        <div className="space-y-4">
          {news.map((article, index) => (
            <a
              key={index}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex gap-4">
                {article.image && (
                  <img
                    src={article.image}
                    alt=""
                    className="w-24 h-24 object-cover rounded-lg flex-shrink-0 hidden sm:block"
                    onError={(e) => e.target.style.display = 'none'}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium mb-2 line-clamp-2">{article.headline}</h3>
                  <p className="text-gray-400 text-sm mb-2 line-clamp-2">{article.summary}</p>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>{article.source}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(article.datetime * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-12 border border-gray-700 text-center">
          <Newspaper className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-300 mb-2">No news available</h3>
          <p className="text-gray-500">Try selecting a different category</p>
        </div>
      )}
    </div>
  )
}

// Research Notes Page
function NotesPage() {
  const [notes, setNotes] = useState([])
  const [activeNote, setActiveNote] = useState(null)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [noteSymbol, setNoteSymbol] = useState('')

  useEffect(() => {
    const savedNotes = localStorage.getItem('research_notes')
    if (savedNotes) {
      setNotes(JSON.parse(savedNotes))
    }
  }, [])

  const saveNotes = (newNotes) => {
    setNotes(newNotes)
    localStorage.setItem('research_notes', JSON.stringify(newNotes))
  }

  const createNote = () => {
    const newNote = {
      id: Date.now(),
      title: 'New Note',
      symbol: '',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    const newNotes = [newNote, ...notes]
    saveNotes(newNotes)
    setActiveNote(newNote)
    setNoteTitle(newNote.title)
    setNoteContent(newNote.content)
    setNoteSymbol(newNote.symbol)
  }

  const updateNote = () => {
    if (!activeNote) return
    const updatedNote = {
      ...activeNote,
      title: noteTitle,
      symbol: noteSymbol,
      content: noteContent,
      updatedAt: new Date().toISOString()
    }
    const newNotes = notes.map(n => n.id === activeNote.id ? updatedNote : n)
    saveNotes(newNotes)
    setActiveNote(updatedNote)
  }

  const deleteNote = (id) => {
    const newNotes = notes.filter(n => n.id !== id)
    saveNotes(newNotes)
    if (activeNote?.id === id) {
      setActiveNote(null)
      setNoteTitle('')
      setNoteContent('')
      setNoteSymbol('')
    }
  }

  const selectNote = (note) => {
    setActiveNote(note)
    setNoteTitle(note.title)
    setNoteContent(note.content)
    setNoteSymbol(note.symbol)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Research Notes</h2>
        <button
          onClick={createNote}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Note
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Notes List */}
        <div className="lg:col-span-1 space-y-2">
          {notes.length > 0 ? (
            notes.map((note) => (
              <button
                key={note.id}
                onClick={() => selectNote(note)}
                className={`w-full text-left p-4 rounded-lg transition-colors ${
                  activeNote?.id === note.id
                    ? 'bg-blue-600/20 border border-blue-500'
                    : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-white font-medium truncate">{note.title}</h4>
                    {note.symbol && (
                      <span className="text-xs bg-gray-700 text-blue-400 px-2 py-0.5 rounded mt-1 inline-block">
                        {note.symbol}
                      </span>
                    )}
                    <p className="text-gray-400 text-sm mt-1 line-clamp-2">{note.content || 'No content'}</p>
                    <p className="text-gray-500 text-xs mt-2">
                      {new Date(note.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteNote(note.id)
                    }}
                    className="p-1 hover:bg-red-600/20 rounded transition-colors text-gray-400 hover:text-red-400 ml-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </button>
            ))
          ) : (
            <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
              <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No notes yet</p>
              <p className="text-gray-500 text-sm mt-1">Create your first research note</p>
            </div>
          )}
        </div>

        {/* Note Editor */}
        <div className="lg:col-span-2">
          {activeNote ? (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Note title"
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={noteSymbol}
                  onChange={(e) => setNoteSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol"
                  className="w-24 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write your research notes here..."
                rows={12}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-sm">
                  Last saved: {formatTimestamp(new Date(activeNote.updatedAt))}
                </span>
                <button
                  onClick={updateNote}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
              <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-300 mb-2">Select a note to edit</h3>
              <p className="text-gray-500">Or create a new note to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Settings Page
function SettingsPage({ apiKey, onChangeApiKey }) {
  const [newApiKey, setNewApiKey] = useState(apiKey)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    localStorage.setItem('finnhub_api_key', newApiKey)
    onChangeApiKey(newApiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClearData = () => {
    if (window.confirm('Are you sure you want to clear all local data? This will remove your API key, watchlist, and research notes.')) {
      localStorage.clear()
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold text-white">Settings</h2>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Finnhub API Key
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors flex items-center gap-2"
            >
              {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <hr className="border-gray-700" />

        <div>
          <h3 className="text-lg font-medium text-white mb-2">API Rate Limits</h3>
          <p className="text-gray-400 text-sm mb-4">
            Finnhub free tier allows 60 API calls per minute. The app automatically throttles requests to stay within limits.
          </p>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300">Requests this minute</span>
              <span className="text-white font-medium">{rateLimiter.getStatus().used} / 60</span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${(rateLimiter.getStatus().used / 60) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <hr className="border-gray-700" />

        <div>
          <h3 className="text-lg font-medium text-white mb-2">Data Management</h3>
          <p className="text-gray-400 text-sm mb-4">
            Clear all locally stored data including your API key, watchlist, and research notes.
          </p>
          <button
            onClick={handleClearData}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Data
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-medium text-white mb-2">About</h3>
        <p className="text-gray-400 text-sm">
          Stock Research Hub is a real-time stock research tool powered by the Finnhub API.
          Track market indices, build watchlists, read market news, and keep research notes.
        </p>
        <p className="text-gray-500 text-sm mt-2">
          Data provided by <a href="https://finnhub.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Finnhub</a>
        </p>
      </div>
    </div>
  )
}

// Main App Component
function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('finnhub_api_key') || '')
  const [activePage, setActivePage] = useState('overview')
  const [selectedStock, setSelectedStock] = useState(null)
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('watchlist')
    return saved ? JSON.parse(saved) : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA']
  })
  const [rateLimitStatus, setRateLimitStatus] = useState({ used: 0, remaining: 60, resetsIn: 0 })

  // Update rate limit status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setRateLimitStatus(rateLimiter.getStatus())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleSelectStock = (symbol) => {
    setSelectedStock(symbol)
  }

  if (!apiKey) {
    return <ApiKeySetup onSave={setApiKey} />
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <Navigation
        activePage={activePage}
        setActivePage={setActivePage}
        rateLimitStatus={rateLimitStatus}
      />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activePage === 'overview' && (
          <MarketOverview apiKey={apiKey} onSelectStock={handleSelectStock} />
        )}
        {activePage === 'watchlist' && (
          <Watchlist
            apiKey={apiKey}
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            onSelectStock={handleSelectStock}
          />
        )}
        {activePage === 'news' && <NewsPage apiKey={apiKey} />}
        {activePage === 'notes' && <NotesPage />}
        {activePage === 'settings' && (
          <SettingsPage apiKey={apiKey} onChangeApiKey={setApiKey} />
        )}
      </main>

      {selectedStock && (
        <StockDetail
          symbol={selectedStock}
          apiKey={apiKey}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  )
}

export default App
