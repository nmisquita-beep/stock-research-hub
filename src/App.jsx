import { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react'
import {
  TrendingUp, TrendingDown, Plus, X, Settings, BarChart3, Newspaper,
  Home, Clock, RefreshCw, Star, Trash2, Save, AlertCircle, CheckCircle, Eye,
  Activity, Search, Bell, Moon, Sun, ArrowUp, ArrowDown, Zap, Target,
  GitCompare, ExternalLink, ChevronDown, ChevronUp, Compass, Calendar,
  PieChart, Briefcase, DollarSign, Percent, TrendingUp as TrendUp,
  AlertTriangle, Layers, BarChart2, Wallet, Play, Pause, ChevronRight,
  Cloud, CloudOff, LogIn, LogOut, User
} from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell } from 'recharts'
import { auth, db, googleProvider } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'

// ============ CONTEXTS ============
const ThemeContext = createContext({ dark: true, toggle: () => {} })
const ToastContext = createContext({ addToast: () => {} })
const AuthContext = createContext({ user: null, loading: true, signIn: () => {}, signOut: () => {} })

// ============ CONSTANTS ============
const SECTORS = [
  { id: 'technology', name: 'Technology', icon: '💻', color: 'from-blue-500 to-cyan-500', stocks: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'AMD', 'META', 'CRM', 'ORCL'] },
  { id: 'healthcare', name: 'Healthcare', icon: '🏥', color: 'from-green-500 to-emerald-500', stocks: ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'LLY'] },
  { id: 'finance', name: 'Financials', icon: '🏦', color: 'from-yellow-500 to-amber-500', stocks: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'C', 'AXP'] },
  { id: 'consumer', name: 'Consumer', icon: '🛒', color: 'from-purple-500 to-pink-500', stocks: ['AMZN', 'TSLA', 'HD', 'NKE', 'MCD', 'SBUX', 'TGT', 'COST'] },
  { id: 'energy', name: 'Energy', icon: '⚡', color: 'from-orange-500 to-red-500', stocks: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PXD', 'MPC', 'VLO'] },
  { id: 'industrials', name: 'Industrials', icon: '🏭', color: 'from-gray-500 to-slate-500', stocks: ['CAT', 'BA', 'HON', 'UPS', 'RTX', 'DE', 'LMT', 'GE'] },
  { id: 'materials', name: 'Materials', icon: '🧱', color: 'from-amber-600 to-yellow-600', stocks: ['LIN', 'APD', 'ECL', 'SHW', 'FCX', 'NEM', 'NUE', 'DOW'] },
  { id: 'realestate', name: 'Real Estate', icon: '🏠', color: 'from-teal-500 to-cyan-600', stocks: ['AMT', 'PLD', 'CCI', 'EQIX', 'SPG', 'PSA', 'O', 'WELL'] },
  { id: 'utilities', name: 'Utilities', icon: '💡', color: 'from-indigo-500 to-blue-600', stocks: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL'] },
  { id: 'communication', name: 'Communication', icon: '📡', color: 'from-rose-500 to-pink-600', stocks: ['GOOG', 'META', 'DIS', 'NFLX', 'CMCSA', 'VZ', 'T', 'TMUS'] },
  { id: 'staples', name: 'Staples', icon: '🥫', color: 'from-lime-500 to-green-600', stocks: ['PG', 'KO', 'PEP', 'WMT', 'COST', 'PM', 'MO', 'CL'] }
]

const POSITIVE_WORDS = ['surge', 'jump', 'gain', 'rise', 'rally', 'soar', 'boom', 'growth', 'profit', 'beat', 'exceed', 'bullish', 'upgrade', 'buy', 'outperform', 'strong', 'positive', 'record', 'high', 'breakout', 'momentum']
const NEGATIVE_WORDS = ['fall', 'drop', 'plunge', 'crash', 'decline', 'loss', 'miss', 'cut', 'bearish', 'downgrade', 'sell', 'weak', 'negative', 'low', 'fear', 'concern', 'risk', 'warning', 'slump', 'tumble']

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
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
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

const formatCompact = (value) => {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value?.toFixed(0) || '0'
}

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

const calculateMarketMood = (stocksData) => {
  if (!stocksData || Object.keys(stocksData).length === 0) return 50
  const changes = Object.values(stocksData).map(d => d.pc ? ((d.c - d.pc) / d.pc) * 100 : 0)
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length
  return Math.max(0, Math.min(100, 50 + avgChange * 10))
}

const generateSparklineData = (current, prevClose, points = 20) => {
  const data = []
  const change = current - prevClose
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const noise = (Math.random() - 0.5) * Math.abs(change) * 0.3
    data.push({ value: prevClose + change * progress + noise })
  }
  data[points - 1] = { value: current }
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
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl p-8 max-w-md text-center border border-gray-700">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-4">Please refresh the page to continue.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white">
              Refresh
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
      <div className="fixed bottom-20 md:bottom-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm animate-slide-in flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-green-500/90' : toast.type === 'error' ? 'bg-red-500/90' : 'bg-gray-700/90'
          } text-white`}>
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

// ============ AUTH PROVIDER ============
function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error('Sign in error:', error)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn: handleSignIn, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  )
}

const useAuth = () => useContext(AuthContext)

// ============ CLOUD SYNC HOOK ============
function useCloudSync(key, localValue, setLocalValue, user) {
  const [synced, setSynced] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const isInitialMount = useRef(true)
  const unsubscribeRef = useRef(null)
  const localValueRef = useRef(localValue)

  // Keep ref updated
  useEffect(() => {
    localValueRef.current = localValue
  }, [localValue])

  // Set up real-time listener and migrate on first connect
  useEffect(() => {
    if (!user) {
      setSynced(false)
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      return
    }

    const docRef = doc(db, `users/${user.uid}/${key}`, 'data')

    // First, check if we need to migrate
    const initializeSync = async () => {
      setSyncing(true)
      try {
        const docSnap = await getDoc(docRef)
        if (!docSnap.exists()) {
          // No cloud data - migrate local data
          await setDoc(docRef, { value: localValueRef.current, updatedAt: new Date().toISOString() })
        }
      } catch (error) {
        console.error('Migration error:', error)
      }
      setSyncing(false)
    }

    initializeSync()

    // Set up real-time listener
    unsubscribeRef.current = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const cloudData = docSnap.data()
        // Only update if value exists and is valid
        if (cloudData && cloudData.value !== undefined && cloudData.value !== null) {
          setLocalValue(cloudData.value)
        }
        setSynced(true)
      }
    }, (error) => {
      console.error('Snapshot error:', error)
      setSynced(false)
    })

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [user, key, setLocalValue])

  // Sync local changes to cloud (debounced)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    if (!user) {
      // Save to localStorage when not signed in
      localStorage.setItem(key, JSON.stringify(localValue))
      return
    }

    // Debounced sync to cloud
    const timeout = setTimeout(async () => {
      setSyncing(true)
      try {
        const docRef = doc(db, `users/${user.uid}/${key}`, 'data')
        await setDoc(docRef, { value: localValue, updatedAt: new Date().toISOString() })
        setSynced(true)
      } catch (error) {
        console.error('Sync error:', error)
      }
      setSyncing(false)
    }, 1000)

    return () => clearTimeout(timeout)
  }, [localValue, user, key])

  return { synced, syncing }
}

// ============ UI COMPONENTS ============
function Tooltip({ children, content }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap z-50 animate-fade-in">
          {content}
        </div>
      )}
    </div>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />
}

function AnimatedNumber({ value, prefix = '', suffix = '', className = '' }) {
  const [display, setDisplay] = useState(value)
  useEffect(() => {
    const start = display
    const end = value
    const duration = 500
    const startTime = Date.now()
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      setDisplay(start + (end - start) * progress)
      if (progress < 1) requestAnimationFrame(animate)
    }
    animate()
  }, [value])
  return <span className={className}>{prefix}{typeof display === 'number' ? display.toFixed(2) : display}{suffix}</span>
}

function MiniSparkline({ data, positive, height = 32 }) {
  if (!data || data.length === 0) return null
  return (
    <div style={{ height }} className="w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`gradient-${positive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={positive ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={positive ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={positive ? '#22c55e' : '#ef4444'} strokeWidth={1.5} fill={`url(#gradient-${positive ? 'up' : 'down'})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function SentimentMeter({ value, size = 'md' }) {
  const getColor = (v) => {
    if (v >= 70) return 'text-green-400'
    if (v >= 55) return 'text-lime-400'
    if (v >= 45) return 'text-yellow-400'
    if (v >= 30) return 'text-orange-400'
    return 'text-red-400'
  }
  const sizeClasses = size === 'sm' ? 'w-12 h-12 text-sm' : 'w-20 h-20 text-lg'
  return (
    <div className={`relative ${sizeClasses} flex items-center justify-center`}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-700" />
        <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${value} 100`} className={getColor(value)} strokeLinecap="round" />
      </svg>
      <span className={`font-bold ${getColor(value)}`}>{Math.round(value)}</span>
    </div>
  )
}

function HeatMapCell({ value, label, onClick }) {
  const getColor = (v) => {
    if (v >= 3) return 'bg-green-500'
    if (v >= 1) return 'bg-green-400/70'
    if (v >= 0) return 'bg-gray-600'
    if (v >= -1) return 'bg-red-400/70'
    return 'bg-red-500'
  }
  return (
    <button onClick={onClick} className={`${getColor(value)} rounded-lg p-2 text-center transition-transform hover:scale-105 hover:z-10`}>
      <div className="text-xs font-bold text-white truncate">{label}</div>
      <div className={`text-xs ${value >= 0 ? 'text-green-100' : 'text-red-100'}`}>{value >= 0 ? '+' : ''}{value.toFixed(1)}%</div>
    </button>
  )
}

// ============ FEAR & GREED INDICATOR ============
function FearGreedIndicator({ value }) {
  const getLabel = (v) => {
    if (v <= 25) return { text: 'Extreme Fear', color: 'text-red-400', emoji: '😨' }
    if (v <= 45) return { text: 'Fear', color: 'text-orange-400', emoji: '😟' }
    if (v <= 55) return { text: 'Neutral', color: 'text-yellow-400', emoji: '😐' }
    if (v <= 75) return { text: 'Greed', color: 'text-lime-400', emoji: '😊' }
    return { text: 'Extreme Greed', color: 'text-green-400', emoji: '🤑' }
  }
  const label = getLabel(value)
  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm font-medium">Market Mood</span>
        <span className="text-xl">{label.emoji}</span>
      </div>
      <div className="relative h-3 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full mb-2">
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-800 transition-all duration-500"
          style={{ left: `calc(${value}% - 8px)` }} />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-500">Fear</span>
        <span className={`text-sm font-medium ${label.color}`}>{label.text}</span>
        <span className="text-xs text-gray-500">Greed</span>
      </div>
    </div>
  )
}

// ============ PREDICTIVE SEARCH ============
function PredictiveSearch({ apiKey, onSelect, onClose, placeholder = "Search stocks...", inline = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const searchStocks = useCallback(debounce(async (q) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const data = await finnhubFetch(`/search?q=${encodeURIComponent(q)}`, apiKey)
      setResults((data.result || []).slice(0, 6).map(r => ({ symbol: r.symbol, name: r.description })))
      setSelectedIndex(0)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, 250), [apiKey])

  useEffect(() => { searchStocks(query) }, [query, searchStocks])

  const handleSelect = (item) => { onSelect(item.symbol); if (!inline) onClose?.() }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIndex]) { handleSelect(results[selectedIndex]) }
    if (e.key === 'Escape') { onClose?.() }
  }

  if (inline) {
    return (
      <div className="relative">
        <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value.toUpperCase())} onKeyDown={handleKeyDown}
            placeholder={placeholder} className="bg-transparent text-white placeholder-gray-500 outline-none flex-1 text-sm" />
          {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
        </div>
        {results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 rounded-lg border border-gray-700 shadow-xl z-50 overflow-hidden">
            {results.map((item, i) => (
              <button key={item.symbol} onClick={() => handleSelect(item)}
                className={`w-full flex items-center justify-between p-3 text-left transition-colors ${i === selectedIndex ? 'bg-blue-600/20' : 'hover:bg-gray-700'}`}>
                <div>
                  <span className="text-white font-medium">{item.symbol}</span>
                  <span className="text-gray-400 text-sm ml-2 truncate">{item.name}</span>
                </div>
                <Plus className="w-4 h-4 text-gray-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl border border-gray-700 overflow-hidden animate-slide-down" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value.toUpperCase())} onKeyDown={handleKeyDown}
            placeholder={placeholder} className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-lg" />
          <kbd className="px-2 py-1 text-xs bg-gray-700 rounded text-gray-400">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && <div className="p-4 text-center"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>}
          {!loading && results.map((item, i) => (
            <button key={item.symbol} onClick={() => handleSelect(item)}
              className={`w-full flex items-center justify-between p-4 transition-colors ${i === selectedIndex ? 'bg-blue-600/20' : 'hover:bg-gray-700'}`}>
              <div className="text-left">
                <div className="text-white font-medium">{item.symbol}</div>
                <div className="text-gray-400 text-sm truncate max-w-xs">{item.name}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          ))}
          {!loading && query && results.length === 0 && (
            <div className="p-8 text-center text-gray-400">No results found</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ UNUSUAL ACTIVITY DETECTOR ============
function UnusualActivityCard({ activities, onSelect, darkMode }) {
  if (!activities || activities.length === 0) return null
  return (
    <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-orange-900/20 to-gray-800 border-orange-500/30' : 'bg-orange-50 border-orange-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-orange-400" />
        <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Unusual Activity</h3>
      </div>
      <div className="space-y-2">
        {activities.slice(0, 3).map((item, i) => (
          <button key={i} onClick={() => onSelect(item.symbol)}
            className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-orange-100'}`}>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.symbol}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${item.type === 'volume' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                {item.type === 'volume' ? 'High Vol' : 'Gap'}
              </span>
            </div>
            <span className={`text-sm ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {item.change >= 0 ? '+' : ''}{item.change.toFixed(1)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============ EARNINGS CALENDAR ============
function EarningsCalendar({ apiKey, onSelect, darkMode }) {
  const [earnings, setEarnings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        const today = new Date()
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        const from = today.toISOString().split('T')[0]
        const to = nextWeek.toISOString().split('T')[0]
        const data = await finnhubFetch(`/calendar/earnings?from=${from}&to=${to}`, apiKey)
        setEarnings((data.earningsCalendar || []).slice(0, 8))
      } catch { setEarnings([]) }
      finally { setLoading(false) }
    }
    fetchEarnings()
  }, [apiKey])

  return (
    <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-purple-400" />
        <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Upcoming Earnings</h3>
      </div>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : earnings.length > 0 ? (
        <div className="space-y-2">
          {earnings.map((e, i) => (
            <button key={i} onClick={() => onSelect(e.symbol)}
              className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{e.symbol}</span>
                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{e.hour === 'bmo' ? 'Before Open' : 'After Close'}</span>
              </div>
              <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{e.date}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>No upcoming earnings</p>
      )}
    </div>
  )
}

// ============ PRICE TARGET TRACKER ============
function PriceTargetTracker({ symbol, currentPrice, apiKey, darkMode }) {
  const [target, setTarget] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTarget = async () => {
      try {
        const data = await finnhubFetch(`/stock/price-target?symbol=${symbol}`, apiKey)
        setTarget(data)
      } catch { setTarget(null) }
      finally { setLoading(false) }
    }
    if (symbol) fetchTarget()
  }, [symbol, apiKey])

  if (loading) return <Skeleton className="h-16 w-full" />
  if (!target || !target.targetMean) return null

  const progress = Math.min(100, Math.max(0, ((currentPrice - target.targetLow) / (target.targetHigh - target.targetLow)) * 100))
  const upside = ((target.targetMean - currentPrice) / currentPrice * 100).toFixed(1)

  return (
    <div className={`rounded-lg p-3 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Analyst Target</span>
        <span className={`text-sm font-medium ${parseFloat(upside) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {parseFloat(upside) >= 0 ? '+' : ''}{upside}% upside
        </span>
      </div>
      <div className="relative h-2 bg-gray-600 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full" style={{ width: '100%' }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow border-2 border-blue-500" style={{ left: `calc(${progress}% - 6px)` }} />
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-500">
        <span>{formatCurrency(target.targetLow)}</span>
        <span className={darkMode ? 'text-white' : 'text-gray-900'}>{formatCurrency(target.targetMean)}</span>
        <span>{formatCurrency(target.targetHigh)}</span>
      </div>
    </div>
  )
}

// ============ PORTFOLIO SIMULATOR ============
function PortfolioSimulator({ apiKey, darkMode, portfolio, setPortfolio }) {
  const [quotes, setQuotes] = useState({})
  const [showTrade, setShowTrade] = useState(false)
  const [tradeSymbol, setTradeSymbol] = useState('')
  const [tradeShares, setTradeShares] = useState('')
  const [tradeType, setTradeType] = useState('buy')
  const { addToast } = useToast()

  useEffect(() => {
    const fetchQuotes = async () => {
      const symbols = portfolio.positions.map(p => p.symbol)
      if (symbols.length === 0) return
      const newQuotes = {}
      for (const symbol of symbols) {
        try {
          const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
          newQuotes[symbol] = data
        } catch {}
      }
      setQuotes(newQuotes)
    }
    fetchQuotes()
  }, [portfolio.positions, apiKey])

  const totalValue = portfolio.cash + portfolio.positions.reduce((sum, p) => {
    const quote = quotes[p.symbol]
    return sum + (quote ? quote.c * p.shares : p.avgPrice * p.shares)
  }, 0)

  const totalGain = totalValue - 100000
  const totalGainPct = (totalGain / 100000) * 100

  const executeTrade = async () => {
    if (!tradeSymbol || !tradeShares) return
    try {
      const quote = await finnhubFetch(`/quote?symbol=${tradeSymbol}`, apiKey)
      const price = quote.c
      const shares = parseInt(tradeShares)
      const cost = price * shares

      if (tradeType === 'buy') {
        if (cost > portfolio.cash) { addToast('Insufficient funds', 'error'); return }
        const existing = portfolio.positions.find(p => p.symbol === tradeSymbol)
        if (existing) {
          const newAvg = ((existing.avgPrice * existing.shares) + cost) / (existing.shares + shares)
          setPortfolio(prev => ({
            ...prev,
            cash: prev.cash - cost,
            positions: prev.positions.map(p => p.symbol === tradeSymbol ? { ...p, shares: p.shares + shares, avgPrice: newAvg } : p),
            history: [...prev.history, { type: 'buy', symbol: tradeSymbol, shares, price, date: new Date().toISOString() }]
          }))
        } else {
          setPortfolio(prev => ({
            ...prev,
            cash: prev.cash - cost,
            positions: [...prev.positions, { symbol: tradeSymbol, shares, avgPrice: price }],
            history: [...prev.history, { type: 'buy', symbol: tradeSymbol, shares, price, date: new Date().toISOString() }]
          }))
        }
        addToast(`Bought ${shares} ${tradeSymbol} @ ${formatCurrency(price)}`, 'success')
      } else {
        const existing = portfolio.positions.find(p => p.symbol === tradeSymbol)
        if (!existing || existing.shares < shares) { addToast('Insufficient shares', 'error'); return }
        if (existing.shares === shares) {
          setPortfolio(prev => ({
            ...prev,
            cash: prev.cash + cost,
            positions: prev.positions.filter(p => p.symbol !== tradeSymbol),
            history: [...prev.history, { type: 'sell', symbol: tradeSymbol, shares, price, date: new Date().toISOString() }]
          }))
        } else {
          setPortfolio(prev => ({
            ...prev,
            cash: prev.cash + cost,
            positions: prev.positions.map(p => p.symbol === tradeSymbol ? { ...p, shares: p.shares - shares } : p),
            history: [...prev.history, { type: 'sell', symbol: tradeSymbol, shares, price, date: new Date().toISOString() }]
          }))
        }
        addToast(`Sold ${shares} ${tradeSymbol} @ ${formatCurrency(price)}`, 'success')
      }
      setShowTrade(false)
      setTradeSymbol('')
      setTradeShares('')
    } catch { addToast('Trade failed', 'error') }
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-indigo-900/20 to-gray-800 border-indigo-500/30' : 'bg-indigo-50 border-indigo-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-400" />
            <span className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Paper Trading</span>
          </div>
          <button onClick={() => setShowTrade(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white text-sm flex items-center gap-1">
            <Plus className="w-4 h-4" /> Trade
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Portfolio Value</div>
            <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(totalValue)}</div>
          </div>
          <div>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Total P&L</div>
            <div className={`text-2xl font-bold ${totalGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalGain >= 0 ? '+' : ''}{formatCurrency(totalGain)} ({totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%)
            </div>
          </div>
        </div>
        <div className={`mt-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Cash: {formatCurrency(portfolio.cash)}</div>
      </div>

      {portfolio.positions.length > 0 && (
        <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead className={darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}>
              <tr>
                <th className={`text-left p-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Symbol</th>
                <th className={`text-right p-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Shares</th>
                <th className={`text-right p-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>P&L</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.positions.map(p => {
                const quote = quotes[p.symbol]
                const currentValue = quote ? quote.c * p.shares : p.avgPrice * p.shares
                const costBasis = p.avgPrice * p.shares
                const pl = currentValue - costBasis
                const plPct = (pl / costBasis) * 100
                return (
                  <tr key={p.symbol} className={darkMode ? 'border-t border-gray-700' : 'border-t border-gray-100'}>
                    <td className={`p-3 font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{p.symbol}</td>
                    <td className={`p-3 text-right ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{p.shares}</td>
                    <td className={`p-3 text-right ${pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pl >= 0 ? '+' : ''}{formatCurrency(pl)} ({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showTrade && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowTrade(false)}>
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl p-6 max-w-sm w-full border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`} onClick={e => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Paper Trade</h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setTradeType('buy')} className={`flex-1 py-2 rounded-lg ${tradeType === 'buy' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'}`}>Buy</button>
                <button onClick={() => setTradeType('sell')} className={`flex-1 py-2 rounded-lg ${tradeType === 'sell' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}>Sell</button>
              </div>
              <input type="text" value={tradeSymbol} onChange={e => setTradeSymbol(e.target.value.toUpperCase())} placeholder="Symbol"
                className={`w-full px-4 py-2 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`} />
              <input type="number" value={tradeShares} onChange={e => setTradeShares(e.target.value)} placeholder="Shares"
                className={`w-full px-4 py-2 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`} />
              <button onClick={executeTrade} className={`w-full py-3 rounded-lg text-white font-medium ${tradeType === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {tradeType === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ SMART WATCHLIST INSIGHTS ============
function WatchlistInsights({ watchlist, quotes, darkMode }) {
  if (watchlist.length === 0) return null

  const validQuotes = watchlist.filter(s => quotes[s] && quotes[s].pc).map(s => ({
    symbol: s,
    change: ((quotes[s].c - quotes[s].pc) / quotes[s].pc) * 100
  }))

  if (validQuotes.length === 0) return null

  const topGainer = validQuotes.reduce((max, q) => q.change > max.change ? q : max, validQuotes[0])
  const topLoser = validQuotes.reduce((min, q) => q.change < min.change ? q : min, validQuotes[0])
  const avgChange = validQuotes.reduce((sum, q) => sum + q.change, 0) / validQuotes.length
  const bullishCount = validQuotes.filter(q => q.change > 0).length

  return (
    <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-blue-900/20 to-gray-800 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-blue-400" />
        <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist Insights</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-white'}`}>
          <div className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Top Gainer</div>
          <div className="flex items-center gap-1">
            <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{topGainer.symbol}</span>
            <span className="text-green-400">+{topGainer.change.toFixed(1)}%</span>
          </div>
        </div>
        <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-white'}`}>
          <div className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Top Loser</div>
          <div className="flex items-center gap-1">
            <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{topLoser.symbol}</span>
            <span className="text-red-400">{topLoser.change.toFixed(1)}%</span>
          </div>
        </div>
        <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-white'}`}>
          <div className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Avg Change</div>
          <span className={avgChange >= 0 ? 'text-green-400' : 'text-red-400'}>{avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%</span>
        </div>
        <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-white'}`}>
          <div className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Bullish</div>
          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{bullishCount}/{validQuotes.length}</span>
        </div>
      </div>
    </div>
  )
}

// ============ STOCK NEWS MODAL ============
function StockNewsModal({ symbol, apiKey, onClose }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [sentiment, setSentiment] = useState({ score: 50, articles: { bullish: 0, bearish: 0, neutral: 0 } })

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const to = new Date().toISOString().split('T')[0]
        const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const data = await finnhubFetch(`/company-news?symbol=${symbol}&from=${from}&to=${to}`, apiKey)
        const articles = (data || []).slice(0, 10)
        setNews(articles)

        let bullish = 0, bearish = 0, neutral = 0
        articles.forEach(a => {
          const s = analyzeSentiment(a.headline + ' ' + a.summary)
          if (s.label === 'bullish') bullish++
          else if (s.label === 'bearish') bearish++
          else neutral++
        })
        const total = bullish + bearish + neutral
        const score = total > 0 ? 50 + ((bullish - bearish) / total) * 50 : 50
        setSentiment({ score, articles: { bullish, bearish, neutral } })
      } catch { setNews([]) }
      finally { setLoading(false) }
    }
    fetchNews()
  }, [symbol, apiKey])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-gray-700 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{symbol} News</h3>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="text-green-400">{sentiment.articles.bullish} bullish</span>
                <span>•</span>
                <span className="text-red-400">{sentiment.articles.bearish} bearish</span>
              </div>
            </div>
            <SentimentMeter value={sentiment.score} size="sm" />
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto max-h-[calc(80vh-80px)] p-4 space-y-3">
          {loading ? [1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />) : news.length > 0 ? news.map((article, i) => {
            const s = analyzeSentiment(article.headline)
            return (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="block p-4 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg transition-all group">
                <h4 className="text-white font-medium group-hover:text-blue-400 line-clamp-2">{article.headline}</h4>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>{article.source}</span>
                  <span>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                  <span className={`px-2 py-0.5 rounded-full ${s.label === 'bullish' ? 'bg-green-500/20 text-green-400' : s.label === 'bearish' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>{s.label}</span>
                </div>
              </a>
            )
          }) : <div className="text-center py-8 text-gray-400">No recent news</div>}
        </div>
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
    } catch { setError('Failed to validate') }
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
          <p className="text-gray-400">Enter your Finnhub API key</p>
        </div>
        <div className="space-y-4">
          <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API key"
            className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-blue-500" />
          {error && <div className="text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
          <button onClick={testAndSave} disabled={testing} className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2">
            {testing ? <><RefreshCw className="w-4 h-4 animate-spin" />Validating...</> : 'Continue'}
          </button>
          <p className="text-center text-sm text-gray-500">
            <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Get free API key</a>
          </p>
        </div>
      </div>
    </div>
  )
}

// ============ MOBILE BOTTOM NAV ============
function MobileBottomNav({ activePage, setActivePage, darkMode }) {
  const navItems = [
    { id: 'overview', label: 'Home', icon: Home },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  return (
    <nav className={`md:hidden fixed bottom-0 left-0 right-0 ${darkMode ? 'bg-gray-800/95' : 'bg-white/95'} backdrop-blur-lg border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} z-40 safe-area-pb`}>
      <div className="flex items-center justify-around py-2">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setActivePage(item.id)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all ${
              activePage === item.id ? 'text-blue-500' : darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
            <item.icon className="w-5 h-5" />
            <span className="text-xs">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// ============ DESKTOP NAVIGATION ============
function DesktopNav({ activePage, setActivePage, rateLimitStatus, onSearchOpen, darkMode, toggleDarkMode, syncStatus }) {
  const { user, loading: authLoading, signIn, signOut: handleSignOut } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const navItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
    { id: 'news', label: 'News', icon: Newspaper },
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
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActivePage(item.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  activePage === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' : darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <item.icon className="w-4 h-4" />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* Sync Status Indicator */}
            {user && (
              <Tooltip content={syncStatus.synced ? 'Synced to cloud' : syncStatus.syncing ? 'Syncing...' : 'Not synced'}>
                <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  syncStatus.synced ? 'bg-green-500/20 text-green-400' : syncStatus.syncing ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {syncStatus.syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : syncStatus.synced ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
                  <span>{syncStatus.synced ? 'Synced' : syncStatus.syncing ? 'Syncing' : 'Offline'}</span>
                </div>
              </Tooltip>
            )}
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
            {/* User Profile / Sign In */}
            {authLoading ? (
              <div className={`w-8 h-8 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} animate-pulse`} />
            ) : user ? (
              <div className="relative">
                <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex items-center gap-2">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border-2 border-blue-500" />
                  ) : (
                    <div className={`w-8 h-8 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} flex items-center justify-center`}>
                      <User className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    </div>
                  )}
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl shadow-xl border z-50 overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                      <div className={`p-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                        <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{user.displayName}</div>
                        <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} truncate`}>{user.email}</div>
                      </div>
                      <button onClick={() => { handleSignOut(); setShowUserMenu(false) }}
                        className={`w-full flex items-center gap-2 p-3 text-left transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-600'}`}>
                        <LogOut className="w-4 h-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button onClick={signIn}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors">
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

// ============ MARKET OVERVIEW ============
function MarketOverview({ apiKey, onSelectStock, darkMode }) {
  const [marketData, setMarketData] = useState({})
  const [trendingData, setTrendingData] = useState({})
  const [loading, setLoading] = useState(true)
  const [newsSymbol, setNewsSymbol] = useState(null)
  const [unusualActivity, setUnusualActivity] = useState([])
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']
  const trending = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN', 'AMD']

  const fetchData = useCallback(async () => {
    setLoading(true)
    const market = {}, trend = {}
    const unusual = []
    for (const symbol of [...indices, ...trending]) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        if (indices.includes(symbol)) market[symbol] = { ...data, timestamp: new Date() }
        else {
          trend[symbol] = { ...data, timestamp: new Date() }
          const change = data.pc ? ((data.c - data.pc) / data.pc) * 100 : 0
          if (Math.abs(change) > 3) unusual.push({ symbol, type: 'gap', change })
        }
      } catch {}
    }
    setMarketData(market)
    setTrendingData(trend)
    setUnusualActivity(unusual.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)))
    setLoading(false)
  }, [apiKey])

  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 60000); return () => clearInterval(interval) }, [fetchData])

  const mood = calculateMarketMood({ ...marketData, ...trendingData })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Market Overview</h2>
        <button onClick={fetchData} disabled={loading} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
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
            const sparkData = data ? generateSparklineData(data.c, data.pc) : []
            return (
              <div key={symbol} onClick={() => onSelectStock(symbol)}
                className={`rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] ${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 hover:border-gray-600' : 'bg-white border border-gray-200 hover:shadow-lg'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{symbol}</span>
                  {positive ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                </div>
                {loading ? <Skeleton className="h-8 w-24" /> : (
                  <>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(data?.c)}</div>
                        <div className={`text-sm font-medium ${positive ? 'text-green-500' : 'text-red-500'}`}>{positive ? '+' : ''}{pctChange.toFixed(2)}%</div>
                      </div>
                      <MiniSparkline data={sparkData} positive={positive} />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <FearGreedIndicator value={mood} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Trending Stocks</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {trending.map(symbol => {
              const data = trendingData[symbol]
              const change = data ? ((data.c - data.pc) / data.pc) * 100 : 0
              return (
                <HeatMapCell key={symbol} value={change} label={symbol} onClick={() => onSelectStock(symbol)} />
              )
            })}
          </div>
        </div>
        <div className="space-y-4">
          <UnusualActivityCard activities={unusualActivity} onSelect={onSelectStock} darkMode={darkMode} />
          <EarningsCalendar apiKey={apiKey} onSelect={onSelectStock} darkMode={darkMode} />
        </div>
      </div>

      {newsSymbol && <StockNewsModal symbol={newsSymbol} apiKey={apiKey} onClose={() => setNewsSymbol(null)} />}
    </div>
  )
}

// ============ STOCK DETAIL MODAL ============
function StockDetail({ symbol, apiKey, onClose, darkMode }) {
  const [quote, setQuote] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNews, setShowNews] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [q, p] = await Promise.all([
          finnhubFetch(`/quote?symbol=${symbol}`, apiKey),
          finnhubFetch(`/stock/profile2?symbol=${symbol}`, apiKey)
        ])
        setQuote({ ...q, timestamp: new Date() })
        setProfile(p)
      } catch {}
      finally { setLoading(false) }
    }
    fetchData()
  }, [symbol, apiKey])

  const change = quote ? quote.c - quote.pc : 0
  const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
  const positive = change >= 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
      <div className={`${darkMode ? 'bg-gray-800/95' : 'bg-white/95'} backdrop-blur rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow-2xl animate-scale-in`} onClick={e => e.stopPropagation()}>
        <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex items-center justify-between`}>
          <div className="flex items-center gap-4">
            {profile?.logo && <img src={profile.logo} alt={symbol} className="w-12 h-12 rounded-xl bg-white p-1" />}
            <div>
              <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{symbol}</h2>
              <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{profile?.name || 'Loading...'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNews(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
              <Newspaper className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            </button>
            <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
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
                  {positive ? '+' : ''}{pctChange.toFixed(2)}%
                </span>
              </div>
              {quote?.timestamp && (
                <div className={`text-sm mt-2 flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Clock className="w-4 h-4" /> {formatTimestamp(quote.timestamp)}
                </div>
              )}
            </div>

            <PriceTargetTracker symbol={symbol} currentPrice={quote?.c} apiKey={apiKey} darkMode={darkMode} />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{ label: 'Open', value: quote?.o }, { label: 'High', value: quote?.h }, { label: 'Low', value: quote?.l }, { label: 'Prev Close', value: quote?.pc }].map(item => (
                <div key={item.label} className={`rounded-lg p-4 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{item.label}</div>
                  <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(item.value)}</div>
                </div>
              ))}
            </div>

            {profile && (
              <div className={`rounded-xl p-6 ${darkMode ? 'bg-gray-700/30' : 'bg-gray-50'}`}>
                <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Company Info</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Industry:</span> <span className={darkMode ? 'text-white' : 'text-gray-900'}>{profile.finnhubIndustry || 'N/A'}</span></div>
                  <div><span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Market Cap:</span> <span className={darkMode ? 'text-white' : 'text-gray-900'}>{formatLargeNumber((profile.marketCapitalization || 0) * 1e6)}</span></div>
                  <div><span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Exchange:</span> <span className={darkMode ? 'text-white' : 'text-gray-900'}>{profile.exchange || 'N/A'}</span></div>
                  <div><span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Country:</span> <span className={darkMode ? 'text-white' : 'text-gray-900'}>{profile.country || 'N/A'}</span></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {showNews && <StockNewsModal symbol={symbol} apiKey={apiKey} onClose={() => setShowNews(false)} />}
    </div>
  )
}

// ============ WATCHLIST ============
function Watchlist({ apiKey, watchlist, setWatchlist, onSelectStock, darkMode }) {
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const { addToast } = useToast()

  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) return
    setLoading(true)
    const newQuotes = {}
    for (const symbol of watchlist) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        newQuotes[symbol] = { ...data, timestamp: new Date() }
      } catch {}
    }
    setQuotes(newQuotes)
    setLoading(false)
  }, [apiKey, watchlist])

  useEffect(() => { fetchQuotes(); const interval = setInterval(fetchQuotes, 60000); return () => clearInterval(interval) }, [fetchQuotes])

  const addSymbol = async (symbol) => {
    if (watchlist.includes(symbol)) { addToast('Already in watchlist', 'error'); return }
    try {
      const data = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
      if (data.c === 0 && data.h === 0) { addToast('Invalid symbol', 'error'); return }
      const newWatchlist = [...watchlist, symbol]
      setWatchlist(newWatchlist)
      setQuotes(prev => ({ ...prev, [symbol]: { ...data, timestamp: new Date() } }))
      addToast(`${symbol} added`, 'success')
      setShowSearch(false)
    } catch { addToast('Failed to add', 'error') }
  }

  const removeSymbol = (symbol) => {
    const newWatchlist = watchlist.filter(s => s !== symbol)
    setWatchlist(newWatchlist)
    addToast(`${symbol} removed`, 'info')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(!showSearch)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all">
            <Plus className="w-4 h-4" /> Add Stock
          </button>
          <button onClick={fetchQuotes} disabled={loading} className={`p-2 rounded-lg transition-all ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''} ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="max-w-md">
          <PredictiveSearch apiKey={apiKey} onSelect={addSymbol} inline placeholder="Search to add..." />
        </div>
      )}

      <WatchlistInsights watchlist={watchlist} quotes={quotes} darkMode={darkMode} />

      {watchlist.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {watchlist.map(symbol => {
            const quote = quotes[symbol]
            const change = quote ? quote.c - quote.pc : 0
            const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
            const positive = change >= 0
            const sparkData = quote ? generateSparklineData(quote.c, quote.pc) : []
            return (
              <div key={symbol} className={`rounded-xl p-4 border transition-all hover:scale-[1.02] ${darkMode ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-200 hover:shadow-lg'}`}>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => onSelectStock(symbol)} className={`text-lg font-bold hover:text-blue-400 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{symbol}</button>
                  <button onClick={() => removeSymbol(symbol)} className="p-1 hover:bg-red-600/20 rounded text-gray-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {quote ? (
                  <div className="flex items-end justify-between">
                    <div>
                      <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(quote.c)}</div>
                      <div className={`text-sm font-medium flex items-center gap-1 ${positive ? 'text-green-500' : 'text-red-500'}`}>
                        {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {positive ? '+' : ''}{pctChange.toFixed(2)}%
                      </div>
                    </div>
                    <MiniSparkline data={sparkData} positive={positive} height={40} />
                  </div>
                ) : (
                  <Skeleton className="h-12 w-full" />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <Star className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Watchlist is empty</h3>
          <p className={darkMode ? 'text-gray-500' : 'text-gray-400'}>Add stocks to track them here</p>
        </div>
      )}
    </div>
  )
}

// ============ EXPLORE PAGE (SECTORS) ============
function ExplorePage({ apiKey, onSelectStock, darkMode }) {
  const [selectedSector, setSelectedSector] = useState(null)
  const [sectorData, setSectorData] = useState({})
  const [loading, setLoading] = useState(false)

  const fetchSectorData = async (sector) => {
    setLoading(true)
    const data = {}
    for (const symbol of sector.stocks.slice(0, 6)) {
      try {
        const quote = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
        data[symbol] = quote
      } catch {}
    }
    setSectorData(data)
    setLoading(false)
  }

  useEffect(() => {
    if (selectedSector) fetchSectorData(selectedSector)
  }, [selectedSector])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Explore Sectors</h2>
        <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Discover stocks by market sector</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {SECTORS.map(sector => (
          <button key={sector.id} onClick={() => setSelectedSector(sector)}
            className={`p-4 rounded-xl border transition-all hover:scale-105 ${
              selectedSector?.id === sector.id
                ? `bg-gradient-to-br ${sector.color} border-transparent text-white shadow-lg`
                : darkMode ? 'bg-gray-800 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-200 hover:border-gray-300'
            }`}>
            <div className="text-2xl mb-2">{sector.icon}</div>
            <div className={`font-medium text-sm ${selectedSector?.id === sector.id ? 'text-white' : darkMode ? 'text-white' : 'text-gray-900'}`}>{sector.name}</div>
          </button>
        ))}
      </div>

      {selectedSector && (
        <div className={`rounded-xl border p-6 ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">{selectedSector.icon}</span>
            <div>
              <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{selectedSector.name}</h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{selectedSector.stocks.length} stocks</p>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {selectedSector.stocks.slice(0, 6).map(symbol => {
                const quote = sectorData[symbol]
                const change = quote ? ((quote.c - quote.pc) / quote.pc) * 100 : 0
                const positive = change >= 0
                return (
                  <button key={symbol} onClick={() => onSelectStock(symbol)}
                    className={`p-4 rounded-lg transition-all hover:scale-[1.02] text-left ${darkMode ? 'bg-gray-700/50 hover:bg-gray-700' : 'bg-gray-50 hover:bg-gray-100'}`}>
                    <div className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{symbol}</div>
                    {quote && (
                      <>
                        <div className={`text-lg font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(quote.c)}</div>
                        <div className={`text-sm ${positive ? 'text-green-500' : 'text-red-500'}`}>
                          {positive ? '+' : ''}{change.toFixed(2)}%
                        </div>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ PORTFOLIO PAGE ============
function PortfolioPage({ apiKey, darkMode, portfolio, setPortfolio }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Portfolio</h2>
        <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Practice trading with $100,000 virtual cash</p>
      </div>
      <PortfolioSimulator apiKey={apiKey} darkMode={darkMode} portfolio={portfolio} setPortfolio={setPortfolio} />
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
      setNews(Array.isArray(data) ? data.slice(0, 15) : [])
    } catch { setNews([]) }
    finally { setLoading(false) }
  }, [apiKey, category])

  useEffect(() => { fetchNews() }, [fetchNews])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Market News</h2>
        <button onClick={fetchNews} disabled={loading} className={`p-2 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''} ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setCategory(cat.id)}
            className={`px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
              category === cat.id ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <div className="space-y-4">
          {news.map((article, i) => {
            const sentiment = analyzeSentiment(article.headline)
            return (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                className={`block rounded-xl p-4 border transition-all hover:scale-[1.01] ${darkMode ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-200 hover:shadow-md'}`}>
                <h3 className={`font-medium mb-2 line-clamp-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{article.headline}</h3>
                <div className="flex items-center gap-3 text-sm">
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{article.source}</span>
                  <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${sentiment.label === 'bullish' ? 'bg-green-500/20 text-green-400' : sentiment.label === 'bearish' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>{sentiment.label}</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ SETTINGS PAGE ============
function SettingsPage({ apiKey, onChangeApiKey, darkMode, syncStatus }) {
  const [newApiKey, setNewApiKey] = useState(apiKey)
  const { addToast } = useToast()
  const { user, signIn, signOut: handleSignOut } = useAuth()

  const handleSave = () => {
    localStorage.setItem('finnhub_api_key', newApiKey)
    onChangeApiKey(newApiKey)
    addToast('API key saved', 'success')
  }

  const handleClear = () => {
    if (window.confirm('Clear all local data? Cloud data will remain.')) { localStorage.clear(); window.location.reload() }
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Settings</h2>

      {/* Account Section */}
      <div className={`rounded-xl border p-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-3 mb-4">
          <User className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
          <h3 className={`text-lg font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>Account</h3>
        </div>
        {user ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName} className="w-12 h-12 rounded-full border-2 border-blue-500" />
              ) : (
                <div className={`w-12 h-12 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} flex items-center justify-center`}>
                  <User className={`w-6 h-6 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </div>
              )}
              <div>
                <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{user.displayName}</div>
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{user.email}</div>
              </div>
            </div>
            <div className={`flex items-center gap-2 p-3 rounded-lg ${syncStatus.synced ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
              {syncStatus.syncing ? (
                <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
              ) : syncStatus.synced ? (
                <Cloud className="w-4 h-4 text-green-400" />
              ) : (
                <CloudOff className="w-4 h-4 text-yellow-400" />
              )}
              <span className={`text-sm ${syncStatus.synced ? 'text-green-400' : 'text-yellow-400'}`}>
                {syncStatus.syncing ? 'Syncing data to cloud...' : syncStatus.synced ? 'Data synced to cloud' : 'Waiting to sync...'}
              </span>
            </div>
            <button onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg text-white">
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg ${darkMode ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-100'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="w-5 h-5 text-blue-400" />
                <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>Sync across devices</span>
              </div>
              <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Sign in to sync your watchlist, portfolio, and settings across all your devices.
              </p>
              <button onClick={signIn}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white">
                <LogIn className="w-4 h-4" />
                Sign in with Google
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`rounded-xl border p-6 space-y-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div>
          <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Finnhub API Key</label>
          <div className="flex gap-2">
            <input type="text" value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
              className={`flex-1 px-4 py-2 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`} />
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white">Save</button>
          </div>
        </div>

        <hr className={darkMode ? 'border-gray-700' : 'border-gray-200'} />

        <div>
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Local Data</h3>
          <button onClick={handleClear} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Clear All Data
          </button>
        </div>
      </div>

      <div className={`rounded-xl border p-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <h3 className={`text-lg font-medium mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Keyboard Shortcuts</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <kbd className={`px-2 py-1 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>/</kbd>
            <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Open search</span>
          </div>
          <div className="flex items-center gap-3">
            <kbd className={`px-2 py-1 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>Esc</kbd>
            <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Close modals</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ APP CONTENT (WITH AUTH CONTEXT) ============
function AppContent() {
  const { user, loading: authLoading, signIn } = useAuth()
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('finnhub_api_key') || '')
  const [activePage, setActivePage] = useState('overview')
  const [selectedStock, setSelectedStock] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('dark_mode') !== 'false')
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('watchlist')
    return saved ? JSON.parse(saved) : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA']
  })
  const [portfolio, setPortfolio] = useState(() => {
    const saved = localStorage.getItem('paper_portfolio')
    return saved ? JSON.parse(saved) : { cash: 100000, positions: [], history: [] }
  })
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('user_settings')
    return saved ? JSON.parse(saved) : { apiKey: localStorage.getItem('finnhub_api_key') || '' }
  })
  const [rateLimitStatus, setRateLimitStatus] = useState({ used: 0, remaining: 60 })
  const [dismissedSyncBanner, setDismissedSyncBanner] = useState(() => sessionStorage.getItem('dismissed_sync_banner') === 'true')

  // Cloud sync hooks - only sync when user is signed in
  const watchlistSync = useCloudSync('watchlist', watchlist, setWatchlist, user)
  const portfolioSync = useCloudSync('portfolio', portfolio, setPortfolio, user)
  const settingsSync = useCloudSync('settings', settings, setSettings, user)

  // Combined sync status
  const syncStatus = {
    synced: user ? (watchlistSync.synced && portfolioSync.synced && settingsSync.synced) : false,
    syncing: user ? (watchlistSync.syncing || portfolioSync.syncing || settingsSync.syncing) : false
  }

  useEffect(() => {
    const interval = setInterval(() => setRateLimitStatus(rateLimiter.getStatus()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => { localStorage.setItem('dark_mode', darkMode) }, [darkMode])

  // Sync settings apiKey with local apiKey state
  useEffect(() => {
    if (settings.apiKey && settings.apiKey !== apiKey) {
      setApiKey(settings.apiKey)
    }
  }, [settings.apiKey, apiKey])

  const handleChangeApiKey = (newKey) => {
    setApiKey(newKey)
    setSettings(prev => ({ ...prev, apiKey: newKey }))
    localStorage.setItem('finnhub_api_key', newKey)
  }

  // Show loading while auth state is being determined
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!apiKey) return <ApiKeySetup onSave={handleChangeApiKey} />

  const dismissBanner = () => {
    setDismissedSyncBanner(true)
    sessionStorage.setItem('dismissed_sync_banner', 'true')
  }

  return (
    <div className={`min-h-screen pb-20 md:pb-0 transition-colors ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <DesktopNav activePage={activePage} setActivePage={setActivePage} rateLimitStatus={rateLimitStatus}
        onSearchOpen={() => setShowSearch(true)} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} syncStatus={syncStatus} />
      <MobileBottomNav activePage={activePage} setActivePage={setActivePage} darkMode={darkMode} />

      {/* Sign in to sync banner */}
      {!user && !dismissedSyncBanner && (
        <div className={`border-b ${darkMode ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-100'}`}>
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-500'}`} />
              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Sign in to sync your data across devices</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={signIn} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm">
                Sign in
              </button>
              <button onClick={dismissBanner} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activePage === 'overview' && <MarketOverview apiKey={apiKey} onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'watchlist' && <Watchlist apiKey={apiKey} watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'explore' && <ExplorePage apiKey={apiKey} onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'portfolio' && <PortfolioPage apiKey={apiKey} darkMode={darkMode} portfolio={portfolio} setPortfolio={setPortfolio} />}
        {activePage === 'news' && <NewsPage apiKey={apiKey} darkMode={darkMode} />}
        {activePage === 'settings' && <SettingsPage apiKey={apiKey} onChangeApiKey={handleChangeApiKey} darkMode={darkMode} syncStatus={syncStatus} />}
      </main>

      {selectedStock && <StockDetail symbol={selectedStock} apiKey={apiKey} onClose={() => setSelectedStock(null)} darkMode={darkMode} />}
      {showSearch && <PredictiveSearch apiKey={apiKey} onSelect={setSelectedStock} onClose={() => setShowSearch(false)} />}
    </div>
  )
}

// ============ MAIN APP ============
function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
