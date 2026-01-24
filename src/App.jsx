import { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react'
import {
  TrendingUp, TrendingDown, Plus, X, Settings, BarChart3, Newspaper, FileText,
  Home, Clock, RefreshCw, Star, Trash2, Save, AlertCircle, CheckCircle, Eye,
  Activity, Search, Bell, BellOff, Moon, Sun, ArrowUp, ArrowDown, Zap,
  Target, GitCompare, Tag, ExternalLink, ChevronDown, ChevronUp, Info
} from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'

// ============ CONTEXTS ============
const ThemeContext = createContext({ dark: true, toggle: () => {} })
const ToastContext = createContext({ addToast: () => {} })

// ============ CONSTANTS ============
const TRENDING_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', category: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', category: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', category: 'Tech' },
  { symbol: 'TSLA', name: 'Tesla', category: 'Auto' },
  { symbol: 'NVDA', name: 'NVIDIA', category: 'Tech' },
  { symbol: 'META', name: 'Meta Platforms', category: 'Tech' },
  { symbol: 'AMZN', name: 'Amazon', category: 'Retail' },
  { symbol: 'AMD', name: 'AMD', category: 'Tech' },
  { symbol: 'NFLX', name: 'Netflix', category: 'Media' },
  { symbol: 'DIS', name: 'Disney', category: 'Media' }
]

const STOCK_CATEGORIES = {
  Tech: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  Healthcare: { color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  Finance: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  Retail: { color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  Auto: { color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  Media: { color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  Energy: { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
}

const POSITIVE_WORDS = ['surge', 'jump', 'gain', 'rise', 'rally', 'soar', 'boom', 'growth', 'profit', 'beat', 'exceed', 'bullish', 'upgrade', 'buy', 'outperform', 'strong', 'positive', 'record', 'high']
const NEGATIVE_WORDS = ['fall', 'drop', 'plunge', 'crash', 'decline', 'loss', 'miss', 'cut', 'bearish', 'downgrade', 'sell', 'weak', 'negative', 'low', 'fear', 'concern', 'risk', 'warning', 'slump']

// ============ RATE LIMITER ============
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
      const waitTime = this.windowMs - (now - this.calls[0]) + 100
      await new Promise(resolve => setTimeout(resolve, waitTime))
      return this.throttle()
    }
    this.calls.push(now)
    return true
  }
  getStatus() {
    const now = Date.now()
    this.calls = this.calls.filter(time => now - time < this.windowMs)
    return { used: this.calls.length, remaining: this.maxCalls - this.calls.length }
  }
}

const rateLimiter = new RateLimiter(60, 60000)

// ============ API HELPERS ============
const finnhubFetch = async (endpoint, apiKey) => {
  await rateLimiter.throttle()
  const separator = endpoint.includes('?') ? '&' : '?'
  const response = await fetch(`https://finnhub.io/api/v1${endpoint}${separator}token=${apiKey}`)
  if (!response.ok) throw new Error(`API Error: ${response.status}`)
  return response.json()
}

// ============ UTILITY FUNCTIONS ============
const formatTimestamp = (date) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
}).format(date)

const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

const formatLargeNumber = (value) => {
  if (value === null || value === undefined) return 'N/A'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return formatCurrency(value)
}

const analyzeSentiment = (text) => {
  if (!text) return { score: 0, label: 'neutral' }
  const lower = text.toLowerCase()
  let score = 0
  POSITIVE_WORDS.forEach(word => { if (lower.includes(word)) score += 1 })
  NEGATIVE_WORDS.forEach(word => { if (lower.includes(word)) score -= 1 })
  if (score > 0) return { score, label: 'bullish' }
  if (score < 0) return { score, label: 'bearish' }
  return { score: 0, label: 'neutral' }
}

const calculateMarketMood = (stocksData) => {
  if (!stocksData || Object.keys(stocksData).length === 0) return 50
  const changes = Object.values(stocksData).map(d => d.pc ? ((d.c - d.pc) / d.pc) * 100 : 0)
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length
  return Math.max(0, Math.min(100, 50 + avgChange * 10))
}

const generateSparklineData = (current, prevClose) => {
  const data = []
  const change = current - prevClose
  for (let i = 0; i < 20; i++) {
    const progress = i / 19
    const noise = (Math.random() - 0.5) * Math.abs(change) * 0.3
    data.push({ value: prevClose + change * progress + noise })
  }
  data[19] = { value: current }
  return data
}

const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// ============ ERROR BOUNDARY ============
class ErrorBoundary extends Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl p-8 max-w-md text-center border border-gray-700">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-4">We encountered an unexpected error. Please refresh the page.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all">
              Refresh Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============ TOAST SYSTEM ============
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])
  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm animate-slide-in flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-green-500/90 text-white' :
            toast.type === 'error' ? 'bg-red-500/90 text-white' :
            'bg-gray-700/90 text-white'
          }`}>
            {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const useToast = () => useContext(ToastContext)

// ============ TOOLTIP ============
function Tooltip({ children, content }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap z-50 animate-fade-in">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

// ============ SKELETON LOADERS ============
function Skeleton({ className }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />
}

function CardSkeleton() {
  return (
    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
      <Skeleton className="h-4 w-16 mb-3" />
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

// ============ MINI SPARKLINE ============
function MiniSparkline({ data, positive }) {
  if (!data || data.length === 0) return null
  return (
    <div className="h-8 w-16">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke={positive ? '#22c55e' : '#ef4444'} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ============ CATEGORY BADGE ============
function CategoryBadge({ category }) {
  const style = STOCK_CATEGORIES[category] || STOCK_CATEGORIES.Tech
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${style.color}`}>
      {category}
    </span>
  )
}

// ============ SENTIMENT BADGE ============
function SentimentBadge({ sentiment }) {
  const colors = {
    bullish: 'bg-green-500/20 text-green-400',
    bearish: 'bg-red-500/20 text-red-400',
    neutral: 'bg-gray-500/20 text-gray-400'
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[sentiment]}`}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
    </span>
  )
}

// ============ FEAR & GREED INDICATOR ============
function FearGreedIndicator({ value }) {
  const getLabel = (v) => {
    if (v <= 25) return { text: 'Extreme Fear', color: 'text-red-400' }
    if (v <= 45) return { text: 'Fear', color: 'text-orange-400' }
    if (v <= 55) return { text: 'Neutral', color: 'text-yellow-400' }
    if (v <= 75) return { text: 'Greed', color: 'text-lime-400' }
    return { text: 'Extreme Greed', color: 'text-green-400' }
  }
  const label = getLabel(value)
  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm font-medium">Market Mood</span>
        <Zap className="w-4 h-4 text-yellow-400" />
      </div>
      <div className="relative h-3 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full mb-2">
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-800 transition-all duration-500"
          style={{ left: `calc(${value}% - 8px)` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Fear</span>
        <span className={`font-medium ${label.color}`}>{label.text}</span>
        <span>Greed</span>
      </div>
    </div>
  )
}

// ============ SEARCH WITH AUTOCOMPLETE ============
function SmartSearch({ apiKey, onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('recent_searches')
    return saved ? JSON.parse(saved) : []
  })
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const searchStocks = useCallback(debounce(async (q) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const data = await finnhubFetch(`/search?q=${encodeURIComponent(q)}`, apiKey)
      const filtered = (data.result || []).slice(0, 8).map(r => ({
        symbol: r.symbol,
        name: r.description,
        type: r.type
      }))
      setResults(filtered)
      setSelectedIndex(0)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, 300), [apiKey])

  useEffect(() => { searchStocks(query) }, [query, searchStocks])

  const handleSelect = (item) => {
    const newRecent = [item.symbol, ...recentSearches.filter(s => s !== item.symbol)].slice(0, 5)
    setRecentSearches(newRecent)
    localStorage.setItem('recent_searches', JSON.stringify(newRecent))
    onSelect(item.symbol)
    onClose()
  }

  const handleKeyDown = (e) => {
    const items = results.length > 0 ? results : recentSearches.map(s => ({ symbol: s, name: '' }))
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && items[selectedIndex]) { handleSelect(items[selectedIndex]) }
    if (e.key === 'Escape') { onClose() }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl border border-gray-700 overflow-hidden animate-slide-down" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search stocks..." className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-lg" />
          <kbd className="px-2 py-1 text-xs bg-gray-700 rounded text-gray-400">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && <div className="p-4 text-center text-gray-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>}
          {!loading && results.length > 0 && results.map((item, i) => (
            <button key={item.symbol} onClick={() => handleSelect(item)}
              className={`w-full flex items-center justify-between p-3 hover:bg-gray-700/50 transition-colors ${i === selectedIndex ? 'bg-gray-700/50' : ''}`}>
              <div className="text-left">
                <div className="text-white font-medium">{item.symbol}</div>
                <div className="text-gray-400 text-sm truncate max-w-xs">{item.name}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-500 rotate-[-90deg]" />
            </button>
          ))}
          {!loading && !query && recentSearches.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs text-gray-500 uppercase">Recent Searches</div>
              {recentSearches.map((symbol, i) => (
                <button key={symbol} onClick={() => handleSelect({ symbol, name: '' })}
                  className={`w-full flex items-center gap-3 p-3 hover:bg-gray-700/50 transition-colors ${i === selectedIndex ? 'bg-gray-700/50' : ''}`}>
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-white">{symbol}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="p-8 text-center text-gray-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No results found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ STOCK NEWS MODAL ============
function StockNewsModal({ symbol, apiKey, onClose }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const to = new Date().toISOString().split('T')[0]
        const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const data = await finnhubFetch(`/company-news?symbol=${symbol}&from=${from}&to=${to}`, apiKey)
        setNews((data || []).slice(0, 10))
      } catch { setNews([]) }
      finally { setLoading(false) }
    }
    fetchNews()
  }, [symbol, apiKey])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-gray-700 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">{symbol} News</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[calc(80vh-60px)] p-4 space-y-3">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="animate-pulse"><Skeleton className="h-20 w-full" /></div>)
          ) : news.length > 0 ? (
            news.map((article, i) => {
              const sentiment = analyzeSentiment(article.headline + ' ' + article.summary)
              return (
                <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                  className="block p-4 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg transition-all group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white font-medium group-hover:text-blue-400 transition-colors line-clamp-2">{article.headline}</h4>
                      <p className="text-gray-400 text-sm mt-1 line-clamp-2">{article.summary}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        <span>{article.source}</span>
                        <span>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                        <SentimentBadge sentiment={sentiment.label} />
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-blue-400 flex-shrink-0" />
                  </div>
                </a>
              )
            })
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Newspaper className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No recent news for {symbol}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ PRICE ALERT MODAL ============
function PriceAlertModal({ symbol, currentPrice, onClose, onSave }) {
  const [targetPrice, setTargetPrice] = useState('')
  const [direction, setDirection] = useState('above')

  const handleSave = () => {
    if (!targetPrice) return
    onSave({ symbol, targetPrice: parseFloat(targetPrice), direction, currentPrice })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl max-w-sm w-full p-6 border border-gray-700 animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-yellow-400" />
          <h3 className="text-lg font-semibold text-white">Set Price Alert</h3>
        </div>
        <p className="text-gray-400 text-sm mb-4">Current price: {formatCurrency(currentPrice)}</p>
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setDirection('above')}
              className={`flex-1 py-2 rounded-lg transition-all ${direction === 'above' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
              <ArrowUp className="w-4 h-4 inline mr-1" /> Above
            </button>
            <button onClick={() => setDirection('below')}
              className={`flex-1 py-2 rounded-lg transition-all ${direction === 'below' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
              <ArrowDown className="w-4 h-4 inline mr-1" /> Below
            </button>
          </div>
          <input type="number" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} placeholder="Target price"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500" />
          <button onClick={handleSave} className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-all">
            Set Alert
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ QUICK COMPARE MODAL ============
function QuickCompareModal({ stocks, apiKey, onClose }) {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      const results = {}
      for (const symbol of stocks) {
        try {
          const [quote, profile] = await Promise.all([
            finnhubFetch(`/quote?symbol=${symbol}`, apiKey),
            finnhubFetch(`/stock/profile2?symbol=${symbol}`, apiKey)
          ])
          results[symbol] = { quote, profile }
        } catch { results[symbol] = null }
      }
      setData(results)
      setLoading(false)
    }
    fetchData()
  }, [stocks, apiKey])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-xl max-w-3xl w-full p-6 border border-gray-700 animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">Quick Compare</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-4">{[1,2].map(i => <CardSkeleton key={i} />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {stocks.map(symbol => {
              const d = data[symbol]
              if (!d) return <div key={symbol} className="text-gray-400">Failed to load {symbol}</div>
              const change = d.quote.c - d.quote.pc
              const pctChange = d.quote.pc ? (change / d.quote.pc) * 100 : 0
              const positive = change >= 0
              return (
                <div key={symbol} className="bg-gray-700/30 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-4">
                    {d.profile?.logo && <img src={d.profile.logo} alt="" className="w-10 h-10 rounded-lg bg-white p-1" />}
                    <div>
                      <div className="text-white font-bold text-lg">{symbol}</div>
                      <div className="text-gray-400 text-sm">{d.profile?.name}</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-1">{formatCurrency(d.quote.c)}</div>
                  <div className={`text-sm font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>
                    {positive ? '+' : ''}{formatCurrency(change)} ({positive ? '+' : ''}{pctChange.toFixed(2)}%)
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-400">Market Cap</span><span className="text-white">{formatLargeNumber((d.profile?.marketCapitalization || 0) * 1e6)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Industry</span><span className="text-white">{d.profile?.finnhubIndustry || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Day High</span><span className="text-white">{formatCurrency(d.quote.h)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Day Low</span><span className="text-white">{formatCurrency(d.quote.l)}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ API KEY SETUP ============
function ApiKeySetup({ onSave }) {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)

  const testAndSave = async () => {
    if (!apiKey.trim()) { setError('Please enter an API key'); return }
    setTesting(true); setError('')
    try {
      const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${apiKey}`)
      const data = await response.json()
      if (data.error || (data.c === 0 && data.h === 0)) { setError('Invalid API key') }
      else { localStorage.setItem('finnhub_api_key', apiKey); onSave(apiKey) }
    } catch { setError('Failed to validate API key') }
    finally { setTesting(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800/80 backdrop-blur-xl rounded-2xl p-8 max-w-md w-full shadow-2xl border border-gray-700 animate-scale-in">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <BarChart3 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Stock Research Hub</h1>
          <p className="text-gray-400">Enter your Finnhub API key to get started</p>
        </div>
        <div className="space-y-4">
          <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter your API key"
            className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all" />
          {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
          <button onClick={testAndSave} disabled={testing}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg">
            {testing ? <><RefreshCw className="w-4 h-4 animate-spin" />Validating...</> : <><CheckCircle className="w-4 h-4" />Continue</>}
          </button>
          <p className="text-center text-sm text-gray-500">
            <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Get a free API key</a>
          </p>
        </div>
      </div>
    </div>
  )
}

// ============ NAVIGATION ============
function Navigation({ activePage, setActivePage, rateLimitStatus, onSearchOpen, darkMode, toggleDarkMode }) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  return (
    <nav className={`${darkMode ? 'bg-gray-800/80' : 'bg-white/80'} backdrop-blur-lg border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} sticky top-0 z-40`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className={`font-bold text-lg hidden sm:block ${darkMode ? 'text-white' : 'text-gray-900'}`}>Stock Research Hub</span>
          </div>
          <div className="flex items-center gap-1">
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActivePage(item.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  activePage === item.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                    : darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <item.icon className="w-4 h-4" />
                <span className="hidden md:inline text-sm">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Search (/)">
              <button onClick={onSearchOpen} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}>
                <Search className="w-5 h-5" />
              </button>
            </Tooltip>
            <Tooltip content="Toggle theme">
              <button onClick={toggleDarkMode} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}>
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </Tooltip>
            <div className={`hidden sm:flex items-center gap-2 text-sm px-3 py-1 rounded-full ${darkMode ? 'bg-gray-700/50 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
              <Activity className="w-3 h-3" />
              <span>{rateLimitStatus.remaining}/60</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}

// ============ TRENDING STOCK CARD ============
function TrendingStockCard({ stock, data, loading, onSelect, onNews, darkMode }) {
  const change = data ? data.c - data.pc : 0
  const pctChange = data?.pc ? (change / data.pc) * 100 : 0
  const positive = change >= 0
  const sparkData = data ? generateSparklineData(data.c, data.pc) : []

  return (
    <div onClick={() => onSelect(stock.symbol)}
      className={`relative overflow-hidden rounded-xl p-4 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl group
        ${darkMode
          ? `bg-gradient-to-br ${positive ? 'from-green-900/20 to-gray-800' : 'from-red-900/20 to-gray-800'} border border-gray-700 hover:border-gray-600`
          : `bg-gradient-to-br ${positive ? 'from-green-50 to-white' : 'from-red-50 to-white'} border border-gray-200 hover:border-gray-300`
        }`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{stock.symbol}</span>
            <CategoryBadge category={stock.category} />
          </div>
          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{stock.name}</span>
        </div>
        <Tooltip content="View news">
          <button onClick={e => { e.stopPropagation(); onNews(stock.symbol) }}
            className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
            <Newspaper className="w-4 h-4 text-gray-400" />
          </button>
        </Tooltip>
      </div>
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-4 w-16" /></div>
      ) : data ? (
        <div className="flex items-end justify-between">
          <div>
            <div className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(data.c)}</div>
            <div className={`text-sm font-medium flex items-center gap-1 ${positive ? 'text-green-500' : 'text-red-500'}`}>
              {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {positive ? '+' : ''}{pctChange.toFixed(2)}%
            </div>
          </div>
          <MiniSparkline data={sparkData} positive={positive} />
        </div>
      ) : <div className="text-gray-500">No data</div>}
    </div>
  )
}

// ============ MARKET OVERVIEW ============
function MarketOverview({ apiKey, onSelectStock, darkMode }) {
  const [marketData, setMarketData] = useState({})
  const [trendingData, setTrendingData] = useState({})
  const [loading, setLoading] = useState(true)
  const [newsSymbol, setNewsSymbol] = useState(null)
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']

  const fetchData = useCallback(async () => {
    setLoading(true)
    const market = {}, trending = {}
    for (const symbol of [...indices, ...TRENDING_STOCKS.map(s => s.symbol)]) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        if (indices.includes(symbol)) market[symbol] = { ...data, timestamp: new Date() }
        else trending[symbol] = { ...data, timestamp: new Date() }
      } catch (err) { console.error(`Error fetching ${symbol}:`, err) }
    }
    setMarketData(market)
    setTrendingData(trending)
    setLoading(false)
  }, [apiKey])

  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 60000); return () => clearInterval(interval) }, [fetchData])

  const mood = calculateMarketMood({ ...marketData, ...trendingData })
  const sortedTrending = [...TRENDING_STOCKS].sort((a, b) => {
    const changeA = trendingData[a.symbol] ? ((trendingData[a.symbol].c - trendingData[a.symbol].pc) / trendingData[a.symbol].pc) * 100 : 0
    const changeB = trendingData[b.symbol] ? ((trendingData[b.symbol].c - trendingData[b.symbol].pc) / trendingData[b.symbol].pc) * 100 : 0
    return changeB - changeA
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Market Overview</h2>
        <button onClick={fetchData} disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
          {indices.map(symbol => {
            const data = marketData[symbol]
            const change = data ? data.c - data.pc : 0
            const pctChange = data?.pc ? (change / data.pc) * 100 : 0
            const positive = change >= 0
            return (
              <div key={symbol} onClick={() => onSelectStock(symbol)}
                className={`rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] ${
                  darkMode
                    ? `bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 hover:border-gray-600`
                    : `bg-white border border-gray-200 hover:border-gray-300 shadow-sm`
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{symbol}</span>
                  {loading ? <RefreshCw className="w-4 h-4 text-gray-500 animate-spin" /> :
                    positive ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                </div>
                {loading ? <Skeleton className="h-8 w-24" /> : (
                  <>
                    <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(data?.c)}</div>
                    <div className={`text-sm font-medium ${positive ? 'text-green-500' : 'text-red-500'}`}>
                      {positive ? '+' : ''}{pctChange.toFixed(2)}%
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <FearGreedIndicator value={mood} />
      </div>

      <div>
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Trending Today</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {sortedTrending.map(stock => (
            <TrendingStockCard key={stock.symbol} stock={stock} data={trendingData[stock.symbol]} loading={loading}
              onSelect={onSelectStock} onNews={setNewsSymbol} darkMode={darkMode} />
          ))}
        </div>
      </div>

      {newsSymbol && <StockNewsModal symbol={newsSymbol} apiKey={apiKey} onClose={() => setNewsSymbol(null)} />}
    </div>
  )
}

// ============ STOCK DETAIL MODAL ============
function StockDetail({ symbol, apiKey, onClose, darkMode, onAddAlert }) {
  const [quote, setQuote] = useState(null)
  const [profile, setProfile] = useState(null)
  const [financials, setFinancials] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [showNews, setShowNews] = useState(false)
  const { addToast } = useToast()

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [q, p, f] = await Promise.all([
          finnhubFetch(`/quote?symbol=${symbol}`, apiKey),
          finnhubFetch(`/stock/profile2?symbol=${symbol}`, apiKey),
          finnhubFetch(`/stock/metric?symbol=${symbol}&metric=all`, apiKey)
        ])
        setQuote({ ...q, timestamp: new Date() })
        setProfile(p)
        setFinancials(f)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    fetchData()
  }, [symbol, apiKey])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const change = quote ? quote.c - quote.pc : 0
  const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
  const positive = change >= 0
  const metrics = financials?.metric || {}
  const category = TRENDING_STOCKS.find(s => s.symbol === symbol)?.category || 'Tech'

  const handleAlertSave = (alert) => {
    onAddAlert(alert)
    addToast(`Alert set for ${symbol} at ${formatCurrency(alert.targetPrice)}`, 'success')
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className={`${darkMode ? 'bg-gray-800/95' : 'bg-white/95'} backdrop-blur rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow-2xl animate-scale-in`}
        onClick={e => e.stopPropagation()}>
        <div className={`sticky top-0 ${darkMode ? 'bg-gray-800' : 'bg-white'} border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} p-4 flex items-center justify-between`}>
          <div className="flex items-center gap-4">
            {profile?.logo && <img src={profile.logo} alt={symbol} className="w-12 h-12 rounded-xl bg-white p-1 shadow" />}
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{symbol}</h2>
                <CategoryBadge category={category} />
              </div>
              <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{profile?.name || 'Loading...'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Set price alert">
              <button onClick={() => setShowAlertModal(true)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
                <Bell className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </Tooltip>
            <Tooltip content="View news">
              <button onClick={() => setShowNews(true)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
                <Newspaper className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </Tooltip>
            <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
              <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-blue-500 animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-80px)]">
            <div className={`rounded-xl p-6 ${darkMode ? 'bg-gradient-to-br from-gray-700/50 to-gray-800/50' : 'bg-gradient-to-br from-gray-50 to-white'}`}>
              <div className="flex items-baseline gap-4 flex-wrap">
                <span className={`text-4xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(quote?.c)}</span>
                <span className={`text-lg font-medium px-3 py-1 rounded-full ${positive ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                  {positive ? '+' : ''}{formatCurrency(change)} ({positive ? '+' : ''}{pctChange.toFixed(2)}%)
                </span>
              </div>
              {quote?.timestamp && (
                <div className={`text-sm mt-2 flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Clock className="w-4 h-4" /> Last updated: {formatTimestamp(quote.timestamp)}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{ label: 'Open', value: quote?.o }, { label: 'High', value: quote?.h }, { label: 'Low', value: quote?.l }, { label: 'Prev Close', value: quote?.pc }].map(item => (
                <div key={item.label} className={`rounded-lg p-4 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{item.label}</div>
                  <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(item.value)}</div>
                </div>
              ))}
            </div>

            {profile && Object.keys(profile).length > 0 && (
              <div className={`rounded-xl p-6 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
                <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Company Information</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Industry', value: profile.finnhubIndustry },
                    { label: 'Market Cap', value: formatLargeNumber((profile.marketCapitalization || 0) * 1e6) },
                    { label: 'Exchange', value: profile.exchange },
                    { label: 'IPO Date', value: profile.ipo },
                    { label: 'Country', value: profile.country },
                    { label: 'Website', value: profile.weburl, link: true }
                  ].map(item => (
                    <div key={item.label}>
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{item.label}</div>
                      {item.link ? (
                        <a href={item.value} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 truncate block">{item.value || 'N/A'}</a>
                      ) : (
                        <div className={darkMode ? 'text-white' : 'text-gray-900'}>{item.value || 'N/A'}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(metrics).length > 0 && (
              <div className={`rounded-xl p-6 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
                <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Key Metrics</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'P/E Ratio', value: metrics.peBasicExclExtraTTM?.toFixed(2) },
                    { label: 'EPS', value: metrics.epsBasicExclExtraItemsTTM?.toFixed(2) },
                    { label: '52W High', value: formatCurrency(metrics['52WeekHigh']) },
                    { label: '52W Low', value: formatCurrency(metrics['52WeekLow']) },
                    { label: 'Beta', value: metrics.beta?.toFixed(2) },
                    { label: 'Dividend Yield', value: metrics.dividendYieldIndicatedAnnual ? `${metrics.dividendYieldIndicatedAnnual.toFixed(2)}%` : 'N/A' },
                    { label: 'ROE', value: metrics.roeTTM ? `${metrics.roeTTM.toFixed(2)}%` : 'N/A' },
                    { label: 'P/B Ratio', value: metrics.pbAnnual?.toFixed(2) }
                  ].map(item => (
                    <div key={item.label}>
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{item.label}</div>
                      <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.value || 'N/A'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showAlertModal && <PriceAlertModal symbol={symbol} currentPrice={quote?.c} onClose={() => setShowAlertModal(false)} onSave={handleAlertSave} />}
      {showNews && <StockNewsModal symbol={symbol} apiKey={apiKey} onClose={() => setShowNews(false)} />}
    </div>
  )
}

// ============ WATCHLIST ============
function Watchlist({ apiKey, watchlist, setWatchlist, onSelectStock, darkMode }) {
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [newSymbol, setNewSymbol] = useState('')
  const [addError, setAddError] = useState('')
  const [newsSymbol, setNewsSymbol] = useState(null)
  const [compareStocks, setCompareStocks] = useState([])
  const { addToast } = useToast()

  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) return
    setLoading(true)
    const newQuotes = {}
    for (const symbol of watchlist) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        newQuotes[symbol] = { ...data, timestamp: new Date() }
      } catch (err) { console.error(err) }
    }
    setQuotes(newQuotes)
    setLoading(false)
  }, [apiKey, watchlist])

  useEffect(() => { fetchQuotes(); const interval = setInterval(fetchQuotes, 60000); return () => clearInterval(interval) }, [fetchQuotes])

  const addSymbol = async () => {
    const symbol = newSymbol.trim().toUpperCase()
    if (!symbol) return
    if (watchlist.includes(symbol)) { setAddError('Already in watchlist'); return }
    setAddError('')
    try {
      const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
      if (data.c === 0 && data.h === 0 && data.l === 0) { setAddError('Invalid symbol'); return }
      const newWatchlist = [...watchlist, symbol]
      setWatchlist(newWatchlist)
      localStorage.setItem('watchlist', JSON.stringify(newWatchlist))
      setQuotes(prev => ({ ...prev, [symbol]: { ...data, timestamp: new Date() } }))
      setNewSymbol('')
      addToast(`${symbol} added to watchlist`, 'success')
    } catch { setAddError('Failed to add symbol') }
  }

  const removeSymbol = (symbol) => {
    const newWatchlist = watchlist.filter(s => s !== symbol)
    setWatchlist(newWatchlist)
    localStorage.setItem('watchlist', JSON.stringify(newWatchlist))
    addToast(`${symbol} removed from watchlist`, 'info')
  }

  const toggleCompare = (symbol) => {
    if (compareStocks.includes(symbol)) setCompareStocks(prev => prev.filter(s => s !== symbol))
    else if (compareStocks.length < 2) setCompareStocks(prev => [...prev, symbol])
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist</h2>
        <div className="flex items-center gap-2">
          {compareStocks.length === 2 && (
            <button onClick={() => {}} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white transition-all">
              <GitCompare className="w-4 h-4" /> Compare
            </button>
          )}
          <button onClick={fetchQuotes} disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex gap-2">
          <input type="text" value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addSymbol()}
            placeholder="Enter stock symbol (e.g., AAPL)"
            className={`flex-1 px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
              darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
            }`} />
          <button onClick={addSymbol} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {addError && <div className="mt-2 text-red-400 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" />{addError}</div>}
      </div>

      {watchlist.length > 0 ? (
        <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}>
                <tr>
                  <th className={`text-left p-4 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Symbol</th>
                  <th className={`text-right p-4 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Price</th>
                  <th className={`text-right p-4 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Change</th>
                  <th className={`text-right p-4 font-medium hidden sm:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>High</th>
                  <th className={`text-right p-4 font-medium hidden sm:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Low</th>
                  <th className={`text-center p-4 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${darkMode ? 'divide-gray-700' : 'divide-gray-100'}`}>
                {watchlist.map(symbol => {
                  const quote = quotes[symbol]
                  const change = quote ? quote.c - quote.pc : 0
                  const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
                  const positive = change >= 0
                  const inCompare = compareStocks.includes(symbol)
                  return (
                    <tr key={symbol} className={`transition-colors ${darkMode ? 'hover:bg-gray-700/30' : 'hover:bg-gray-50'}`}>
                      <td className="p-4">
                        <button onClick={() => onSelectStock(symbol)} className={`font-medium hover:text-blue-400 transition-colors ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {symbol}
                        </button>
                      </td>
                      <td className={`p-4 text-right font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {quote ? formatCurrency(quote.c) : <Skeleton className="h-5 w-16 ml-auto" />}
                      </td>
                      <td className="p-4 text-right">
                        {quote ? (
                          <span className={`font-medium px-2 py-1 rounded ${positive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                            {positive ? '+' : ''}{pctChange.toFixed(2)}%
                          </span>
                        ) : <Skeleton className="h-5 w-12 ml-auto" />}
                      </td>
                      <td className={`p-4 text-right hidden sm:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{quote ? formatCurrency(quote.h) : '-'}</td>
                      <td className={`p-4 text-right hidden sm:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{quote ? formatCurrency(quote.l) : '-'}</td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1">
                          <Tooltip content="View details">
                            <button onClick={() => onSelectStock(symbol)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                              <Eye className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content="View news">
                            <button onClick={() => setNewsSymbol(symbol)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                              <Newspaper className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content={inCompare ? 'Remove from compare' : 'Add to compare'}>
                            <button onClick={() => toggleCompare(symbol)}
                              className={`p-2 rounded-lg transition-colors ${inCompare ? 'bg-purple-600/20 text-purple-400' : darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                              <GitCompare className="w-4 h-4" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Remove">
                            <button onClick={() => removeSymbol(symbol)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-red-600/20 text-gray-400 hover:text-red-400' : 'hover:bg-red-50 text-gray-500 hover:text-red-500'}`}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <Star className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Your watchlist is empty</h3>
          <p className={darkMode ? 'text-gray-500' : 'text-gray-400'}>Add stock symbols above to start tracking</p>
        </div>
      )}

      {newsSymbol && <StockNewsModal symbol={newsSymbol} apiKey={apiKey} onClose={() => setNewsSymbol(null)} />}
      {compareStocks.length === 2 && <QuickCompareModal stocks={compareStocks} apiKey={apiKey} onClose={() => setCompareStocks([])} />}
    </div>
  )
}

// ============ NEWS PAGE ============
function NewsPage({ apiKey, darkMode }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('general')
  const categories = [{ id: 'general', label: 'General' }, { id: 'forex', label: 'Forex' }, { id: 'crypto', label: 'Crypto' }, { id: 'merger', label: 'M&A' }]

  const fetchNews = useCallback(async () => {
    setLoading(true)
    try {
      const data = await finnhubFetch(`/news?category=${category}`, apiKey)
      setNews(Array.isArray(data) ? data.slice(0, 20) : [])
    } catch { setNews([]) }
    finally { setLoading(false) }
  }, [apiKey, category])

  useEffect(() => { fetchNews() }, [fetchNews])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Market News</h2>
        <button onClick={fetchNews} disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setCategory(cat.id)}
            className={`px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
              category === cat.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' : darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}><Skeleton className="h-6 w-3/4 mb-2" /><Skeleton className="h-4 w-full mb-2" /><Skeleton className="h-4 w-1/2" /></div>)}</div>
      ) : news.length > 0 ? (
        <div className="space-y-4">
          {news.map((article, i) => {
            const sentiment = analyzeSentiment(article.headline + ' ' + article.summary)
            return (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                className={`block rounded-xl p-4 border transition-all hover:scale-[1.01] group ${darkMode ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md'}`}>
                <div className="flex gap-4">
                  {article.image && <img src={article.image} alt="" className="w-24 h-24 object-cover rounded-lg flex-shrink-0 hidden sm:block" onError={e => e.target.style.display = 'none'} />}
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-medium mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors ${darkMode ? 'text-white' : 'text-gray-900'}`}>{article.headline}</h3>
                    <p className={`text-sm mb-2 line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{article.summary}</p>
                    <div className="flex items-center gap-3 text-sm">
                      <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{article.source}</span>
                      <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        <Clock className="w-3 h-3" />{new Date(article.datetime * 1000).toLocaleDateString()}
                      </span>
                      <SentimentBadge sentiment={sentiment.label} />
                    </div>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      ) : (
        <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <Newspaper className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No news available</h3>
          <p className={darkMode ? 'text-gray-500' : 'text-gray-400'}>Try selecting a different category</p>
        </div>
      )}
    </div>
  )
}

// ============ NOTES PAGE ============
function NotesPage({ darkMode }) {
  const [notes, setNotes] = useState([])
  const [activeNote, setActiveNote] = useState(null)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [noteSymbol, setNoteSymbol] = useState('')
  const { addToast } = useToast()

  useEffect(() => {
    const saved = localStorage.getItem('research_notes')
    if (saved) setNotes(JSON.parse(saved))
  }, [])

  const saveNotes = (newNotes) => { setNotes(newNotes); localStorage.setItem('research_notes', JSON.stringify(newNotes)) }

  const createNote = () => {
    const newNote = { id: Date.now(), title: 'New Note', symbol: '', content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    saveNotes([newNote, ...notes])
    setActiveNote(newNote); setNoteTitle(newNote.title); setNoteContent(newNote.content); setNoteSymbol(newNote.symbol)
  }

  const updateNote = () => {
    if (!activeNote) return
    const updated = { ...activeNote, title: noteTitle, symbol: noteSymbol, content: noteContent, updatedAt: new Date().toISOString() }
    saveNotes(notes.map(n => n.id === activeNote.id ? updated : n))
    setActiveNote(updated)
    addToast('Note saved', 'success')
  }

  const deleteNote = (id) => {
    saveNotes(notes.filter(n => n.id !== id))
    if (activeNote?.id === id) { setActiveNote(null); setNoteTitle(''); setNoteContent(''); setNoteSymbol('') }
    addToast('Note deleted', 'info')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Research Notes</h2>
        <button onClick={createNote} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all">
          <Plus className="w-4 h-4" /> New Note
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {notes.length > 0 ? notes.map(note => (
            <button key={note.id} onClick={() => { setActiveNote(note); setNoteTitle(note.title); setNoteContent(note.content); setNoteSymbol(note.symbol) }}
              className={`w-full text-left p-4 rounded-lg transition-all ${
                activeNote?.id === note.id ? 'bg-blue-600/20 border border-blue-500' : darkMode ? 'bg-gray-800 border border-gray-700 hover:border-gray-600' : 'bg-white border border-gray-200 hover:border-gray-300'
              }`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h4 className={`font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{note.title}</h4>
                  {note.symbol && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded mt-1 inline-block">{note.symbol}</span>}
                  <p className={`text-sm mt-1 line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{note.content || 'No content'}</p>
                  <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{new Date(note.updatedAt).toLocaleDateString()}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }} className="p-1 hover:bg-red-600/20 rounded text-gray-400 hover:text-red-400 ml-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </button>
          )) : (
            <div className={`rounded-xl p-8 border text-center ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <FileText className={`w-10 h-10 mx-auto mb-3 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
              <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>No notes yet</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {activeNote ? (
            <div className={`rounded-xl border p-6 space-y-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="flex gap-4">
                <input type="text" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Note title"
                  className={`flex-1 px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`} />
                <input type="text" value={noteSymbol} onChange={e => setNoteSymbol(e.target.value.toUpperCase())} placeholder="Symbol"
                  className={`w-24 px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`} />
              </div>
              <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} placeholder="Write your research notes here..." rows={12}
                className={`w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`} />
              <div className="flex items-center justify-between">
                <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Last saved: {formatTimestamp(new Date(activeNote.updatedAt))}</span>
                <button onClick={updateNote} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all">
                  <Save className="w-4 h-4" /> Save
                </button>
              </div>
            </div>
          ) : (
            <div className={`rounded-xl border p-12 text-center ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <FileText className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
              <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Select a note to edit</h3>
              <p className={darkMode ? 'text-gray-500' : 'text-gray-400'}>Or create a new note to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ SETTINGS PAGE ============
function SettingsPage({ apiKey, onChangeApiKey, darkMode, alerts, setAlerts }) {
  const [newApiKey, setNewApiKey] = useState(apiKey)
  const [saved, setSaved] = useState(false)
  const { addToast } = useToast()

  const handleSave = () => {
    localStorage.setItem('finnhub_api_key', newApiKey)
    onChangeApiKey(newApiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    addToast('API key saved', 'success')
  }

  const handleClearData = () => {
    if (window.confirm('Clear all local data?')) { localStorage.clear(); window.location.reload() }
  }

  const removeAlert = (index) => {
    const newAlerts = alerts.filter((_, i) => i !== index)
    setAlerts(newAlerts)
    localStorage.setItem('price_alerts', JSON.stringify(newAlerts))
    addToast('Alert removed', 'info')
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Settings</h2>

      <div className={`rounded-xl border p-6 space-y-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div>
          <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Finnhub API Key</label>
          <div className="flex gap-2">
            <input type="text" value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
              className={`flex-1 px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`} />
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all flex items-center gap-2">
              {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />} {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <hr className={darkMode ? 'border-gray-700' : 'border-gray-200'} />

        <div>
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Price Alerts</h3>
          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                  <div>
                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{alert.symbol}</span>
                    <span className={`ml-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {alert.direction === 'above' ? '>' : '<'} {formatCurrency(alert.targetPrice)}
                    </span>
                  </div>
                  <button onClick={() => removeAlert(i)} className="p-1 hover:bg-red-600/20 rounded text-gray-400 hover:text-red-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>No active alerts</p>
          )}
        </div>

        <hr className={darkMode ? 'border-gray-700' : 'border-gray-200'} />

        <div>
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Data Management</h3>
          <button onClick={handleClearData} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white transition-all flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Clear All Data
          </button>
        </div>
      </div>

      <div className={`rounded-xl border p-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Keyboard Shortcuts</h3>
        <div className="space-y-2 text-sm">
          {[{ key: '/', desc: 'Open search' }, { key: 'Esc', desc: 'Close modals' }].map(item => (
            <div key={item.key} className="flex items-center gap-3">
              <kbd className={`px-2 py-1 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{item.key}</kbd>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ MAIN APP ============
function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('finnhub_api_key') || '')
  const [activePage, setActivePage] = useState('overview')
  const [selectedStock, setSelectedStock] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('dark_mode') !== 'false')
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('watchlist')
    return saved ? JSON.parse(saved) : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA']
  })
  const [alerts, setAlerts] = useState(() => {
    const saved = localStorage.getItem('price_alerts')
    return saved ? JSON.parse(saved) : []
  })
  const [rateLimitStatus, setRateLimitStatus] = useState({ used: 0, remaining: 60 })

  useEffect(() => {
    const interval = setInterval(() => setRateLimitStatus(rateLimiter.getStatus()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => { localStorage.setItem('dark_mode', darkMode) }, [darkMode])

  const addAlert = (alert) => {
    const newAlerts = [...alerts, alert]
    setAlerts(newAlerts)
    localStorage.setItem('price_alerts', JSON.stringify(newAlerts))
  }

  if (!apiKey) return <ErrorBoundary><ApiKeySetup onSave={setApiKey} /></ErrorBoundary>

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <Navigation activePage={activePage} setActivePage={setActivePage} rateLimitStatus={rateLimitStatus}
            onSearchOpen={() => setShowSearch(true)} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} />

          <main className="max-w-7xl mx-auto px-4 py-8">
            {activePage === 'overview' && <MarketOverview apiKey={apiKey} onSelectStock={setSelectedStock} darkMode={darkMode} />}
            {activePage === 'watchlist' && <Watchlist apiKey={apiKey} watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} darkMode={darkMode} />}
            {activePage === 'news' && <NewsPage apiKey={apiKey} darkMode={darkMode} />}
            {activePage === 'notes' && <NotesPage darkMode={darkMode} />}
            {activePage === 'settings' && <SettingsPage apiKey={apiKey} onChangeApiKey={setApiKey} darkMode={darkMode} alerts={alerts} setAlerts={setAlerts} />}
          </main>

          {selectedStock && <StockDetail symbol={selectedStock} apiKey={apiKey} onClose={() => setSelectedStock(null)} darkMode={darkMode} onAddAlert={addAlert} />}
          {showSearch && <SmartSearch apiKey={apiKey} onSelect={setSelectedStock} onClose={() => setShowSearch(false)} />}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
