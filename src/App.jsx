import { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react'
import {
  TrendingUp, TrendingDown, Plus, X, Settings, BarChart3, Newspaper,
  Home, Clock, RefreshCw, Star, Trash2, AlertCircle, CheckCircle,
  Activity, Search, Zap, Calendar,
  AlertTriangle, ChevronRight, HelpCircle, Sparkles,
  Cloud, CloudOff, LogIn, LogOut, User, Brain,
  Filter, Grid3X3, PieChart, Target, DollarSign, Award, Layers,
  ArrowUpRight, ArrowDownRight, Info, Building, ChevronDown, Eye,
  Crown, Leaf, Heart, Cpu, TrendingDown as TrendDown, Gem, Shield, LayoutGrid, List,
  Menu, ChevronUp, ArrowUp
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, BarChart, Bar, ComposedChart, Line } from 'recharts'
import AIInsights from './components/AIInsights'
import { auth, db, googleProvider } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'

// ============ CONTEXTS ============
const ToastContext = createContext({ addToast: () => {} })
const AuthContext = createContext({ user: null, loading: true, signIn: () => {}, signOut: () => {} })

// ============ CONSTANTS ============
const POSITIVE_WORDS = ['surge', 'jump', 'gain', 'rise', 'rally', 'soar', 'boom', 'growth', 'profit', 'beat', 'exceed', 'bullish', 'upgrade', 'buy', 'outperform', 'strong', 'positive', 'record', 'high', 'breakout', 'momentum']
const NEGATIVE_WORDS = ['fall', 'drop', 'plunge', 'crash', 'decline', 'loss', 'miss', 'cut', 'bearish', 'downgrade', 'sell', 'weak', 'negative', 'low', 'fear', 'concern', 'risk', 'warning', 'slump', 'tumble']
const CRYPTO_KEYWORDS = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'blockchain', 'dogecoin', 'solana', 'cardano', 'xrp', 'ripple', 'binance', 'coinbase', 'nft', 'defi', 'altcoin', 'token', 'mining', 'wallet']

// ============ API HELPERS ============
const FINNHUB_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/finnhub'
const YAHOO_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/yahoo'
const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'

// ============ AI CACHE SYSTEM ============
const aiCache = {
  data: {},
  timestamps: {},
  durations: {
    marketPulse: 60 * 60 * 1000,      // 1 hour
    stockAnalysis: 30 * 60 * 1000,    // 30 minutes
    earnings: 6 * 60 * 60 * 1000,     // 6 hours
    screener: 2 * 60 * 60 * 1000,     // 2 hours
    sectors: 60 * 60 * 1000,          // 1 hour
    chartAnnotation: 60 * 60 * 1000   // 1 hour
  },
  get(key, type = 'stockAnalysis') {
    const cached = this.data[key]
    const timestamp = this.timestamps[key]
    const duration = this.durations[type] || this.durations.stockAnalysis
    if (cached && timestamp && (Date.now() - timestamp < duration)) {
      return cached
    }
    return null
  },
  set(key, value) {
    this.data[key] = value
    this.timestamps[key] = Date.now()
  }
}

// Groq AI API helper
// Clean AI text - remove asterisks and markdown
const cleanAiText = (text) => {
  if (!text) return ''
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`/g, '')
    .trim()
}

// Parse AI JSON response with fallback
const parseAiJson = (text) => {
  if (!text) return null
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.log('JSON parse failed, using text fallback')
  }
  return null
}

// AI System prompt for helpful, structured responses
const AI_SYSTEM_PROMPT = `You are a stock market research assistant helping users understand stocks. You provide educational analysis based on publicly available data. Your responses are NOT financial advice - users make their own decisions.

IMPORTANT RULES:
- Never say "I can't provide financial advice" - just give the analysis
- Be direct and opinionated - say "This looks attractive because..." or "Risks include..."
- Use simple language, not walls of text
- Give specific insights, not generic disclaimers
- Always respond with valid JSON only, no other text before or after the JSON`

const groqFetch = async (prompt, stockData = {}, expectJson = true) => {
  const fullPrompt = expectJson
    ? `${AI_SYSTEM_PROMPT}\n\n${prompt}`
    : prompt

  const response = await fetch(GROQ_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: fullPrompt, stockData })
  })
  if (!response.ok) {
    throw new Error('AI request failed')
  }
  const data = await response.json()
  const rawText = data.insight || data.response || ''

  // Clean asterisks from raw text
  return cleanAiText(rawText)
}

// Yahoo Finance API (no rate limits!)
const yahooFetch = async (symbol, type = 'quote', options = {}, timeout = 15000) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let url = `${YAHOO_PROXY_URL}?symbol=${encodeURIComponent(symbol)}`
  if (type !== 'quote') {
    url += `&type=${type}`
  }
  if (options.range) url += `&range=${options.range}`
  if (options.interval) url += `&interval=${options.interval}`

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Yahoo API Error: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
  }
}

// Finnhub API (only for company news now)
const finnhubFetch = async (endpoint, timeout = 10000) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const endpointParts = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  const [path, queryString] = endpointParts.split('?')

  let proxyUrl = `${FINNHUB_PROXY_URL}?endpoint=${path}`
  if (queryString) {
    proxyUrl += `&${queryString}`
  }

  try {
    const response = await fetch(proxyUrl, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment.')
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
  }
}

// Normalize Yahoo quote data to common format
const normalizeYahooQuote = (data) => {
  if (!data) return null
  // Use nullish coalescing (??) for numbers to preserve 0 and negative values
  // API returns: changePercent, change, price (not regularMarket* variants)
  const changePercent = data.regularMarketChangePercent ?? data.changePercent ?? 0
  const change = data.regularMarketChange ?? data.change ?? 0
  return {
    c: data.regularMarketPrice ?? data.price ?? 0,
    pc: data.regularMarketPreviousClose ?? data.previousClose ?? 0,
    h: data.regularMarketDayHigh ?? data.dayHigh ?? 0,
    l: data.regularMarketDayLow ?? data.dayLow ?? 0,
    o: data.regularMarketOpen ?? data.open ?? 0,
    change,
    changePercent,
    volume: data.regularMarketVolume ?? data.volume ?? 0,
    marketCap: data.marketCap ?? 0,
    peRatio: data.trailingPE ?? data.forwardPE ?? null,
    eps: data.trailingEps ?? null,
    weekHigh52: data.fiftyTwoWeekHigh ?? null,
    weekLow52: data.fiftyTwoWeekLow ?? null,
    avgVolume: data.averageDailyVolume3Month ?? data.averageVolume ?? 0,
    name: data.shortName ?? data.longName ?? '',
    exchange: data.exchange ?? '',
    currency: data.currency ?? 'USD',
    marketState: data.marketState ?? null,
    timestamp: new Date()
  }
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

const formatVolume = (vol) => {
  if (!vol || vol === 0) return 'N/A'
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`
  return vol.toLocaleString()
}

const analyzeSentiment = (text) => {
  if (!text) return { score: 0, label: 'neutral', confidence: 50 }
  const lower = text.toLowerCase()
  let positiveCount = 0, negativeCount = 0
  POSITIVE_WORDS.forEach(word => { if (lower.includes(word)) positiveCount++ })
  NEGATIVE_WORDS.forEach(word => { if (lower.includes(word)) negativeCount++ })
  if (positiveCount > negativeCount) return { label: 'bullish' }
  if (negativeCount > positiveCount) return { label: 'bearish' }
  return { label: 'neutral' }
}

const calculateMarketMood = (stocksData) => {
  if (!stocksData || Object.keys(stocksData).length === 0) return 50
  const changes = Object.values(stocksData).map(d => d?.changePercent ?? 0)
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length
  return Math.max(0, Math.min(100, 50 + avgChange * 10))
}

const generateSparklineData = (current, prevClose, points = 20) => {
  if (!current || !prevClose) return []
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
      console.log('[Auth] State changed:', user ? `Logged in as ${user.email}` : 'Not logged in')
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

  useEffect(() => {
    localValueRef.current = localValue
  }, [localValue])

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

    const initializeSync = async () => {
      console.log('[Sync] Initializing sync for', key, 'user:', user?.uid)
      setSyncing(true)
      try {
        console.log('[Sync] Calling getDoc for', key)
        const docSnap = await getDoc(docRef)
        console.log('[Sync] getDoc completed for', key, '- exists:', docSnap.exists())
        if (!docSnap.exists()) {
          console.log('[Sync] Creating initial doc for', key)
          await setDoc(docRef, { value: localValueRef.current, updatedAt: new Date().toISOString() })
          console.log('[Sync] Initial doc created for', key)
        }
      } catch (error) {
        console.error('[Sync] Init error for', key, ':', error.code, error.message)
      }
      setSyncing(false)
    }

    initializeSync()

    unsubscribeRef.current = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const cloudData = docSnap.data()
        if (cloudData && cloudData.value !== undefined && cloudData.value !== null) {
          setLocalValue(cloudData.value)
        }
        console.log('[Sync] Snapshot received for', key, '- synced:', true)
        setSynced(true)
      } else {
        console.log('[Sync] Snapshot received for', key, '- doc does not exist')
      }
    }, (error) => {
      console.error('[Sync] Snapshot ERROR for', key, ':', error.code, error.message)
      setSynced(false)
    })

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [user, key, setLocalValue])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    if (!user) {
      localStorage.setItem(key, JSON.stringify(localValue))
      return
    }

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
function Tooltip({ children, content, position = 'bottom' }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block overflow-visible" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs bg-gray-900 text-white rounded-lg whitespace-nowrap z-[100] shadow-lg border border-gray-700 pointer-events-none ${
          position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}>
          {content}
          <div className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
            position === 'top' ? 'top-full -mt-1 border-t-gray-900' : 'bottom-full -mb-1 border-b-gray-900'
          }`} />
        </div>
      )}
    </div>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-shimmer rounded ${className}`} />
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
      <div className="text-xs text-white">{value >= 0 ? '+' : ''}{value.toFixed(1)}%</div>
    </button>
  )
}

// ============ FEAR & GREED INDICATOR ============
function FearGreedIndicator({ value }) {
  // Ensure value is a valid number and clamp to 0-100
  const safeValue = Math.max(0, Math.min(100, Number(value) || 50))
  const roundedValue = Math.round(safeValue)

  // Simplified labels: Fear (0-35), Neutral (35-65), Greed (65-100)
  const getLabel = (v) => {
    if (v < 35) return { text: 'Fear', color: 'text-red-400', bgColor: '#ef4444' }
    if (v < 65) return { text: 'Neutral', color: 'text-yellow-400', bgColor: '#eab308' }
    return { text: 'Greed', color: 'text-green-400', bgColor: '#22c55e' }
  }
  const label = getLabel(roundedValue)

  // Convert 0-100 to 0-180 degrees for semicircle
  const rotation = (safeValue / 100) * 180 - 90

  return (
    <div className="card-premium rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-300 text-sm font-semibold">Market Mood</span>
        <span className={`text-sm font-semibold ${label.color}`}>{label.text}</span>
      </div>

      {/* Semicircle Gauge */}
      <div className="relative flex justify-center mb-2 overflow-hidden">
        <svg width="128" height="72" viewBox="0 0 128 72" className="overflow-hidden">
          {/* Background arc */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="25%" stopColor="#f97316" />
              <stop offset="50%" stopColor="#eab308" />
              <stop offset="75%" stopColor="#84cc16" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          {/* Background track */}
          <path
            d="M 12 64 A 52 52 0 0 1 116 64"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.3"
          />
          {/* Foreground arc (filled portion based on value) */}
          <path
            d="M 12 64 A 52 52 0 0 1 116 64"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(safeValue / 100) * 163.4} 163.4`}
          />
          {/* Needle */}
          <line
            x1="64"
            y1="64"
            x2={64 + Math.cos((rotation - 90) * Math.PI / 180) * 40}
            y2={64 + Math.sin((rotation - 90) * Math.PI / 180) * 40}
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Center dot */}
          <circle cx="64" cy="64" r="4" fill="white" />
        </svg>
      </div>

      <div className="flex justify-between items-center px-2">
        <span className="text-[10px] text-red-400 font-medium">FEAR</span>
        <span className="text-[10px] text-green-400 font-medium">GREED</span>
      </div>
    </div>
  )
}

// ============ FRIENDLY GUIDED TOUR ============
function OnboardingTour({ onComplete, onOpenSearch, setActivePage }) {
  const [step, setStep] = useState(0)
  const [highlightRect, setHighlightRect] = useState(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  const steps = [
    {
      type: 'welcome',
      tab: null,
      title: 'Welcome to Stock Research Hub!',
      description: 'Your personal dashboard for stock research and market insights.',
      emoji: '🚀'
    },
    {
      type: 'highlight',
      tab: 'dashboard',
      target: '[data-tour="dashboard"]',
      title: 'Dashboard',
      description: 'View market indices, your watchlist, and sector performance at a glance.'
    },
    {
      type: 'highlight',
      tab: 'dashboard',
      target: '[data-tour="watchlist"]',
      title: 'Your Watchlist',
      description: 'Track your favorite stocks - click any stock to see detailed charts and data.'
    },
    {
      type: 'highlight',
      tab: 'explore',
      target: '[data-tour="explore"]',
      title: 'Explore Stocks',
      description: 'Browse 100+ stocks organized by sector - discover new investment opportunities.'
    },
    {
      type: 'highlight',
      tab: 'insights',
      target: '[data-tour="ai-search"]',
      title: 'AI Insights',
      description: 'Get AI-powered analysis on any stock with technical and fundamental insights.'
    },
    {
      type: 'highlight',
      tab: 'screener',
      target: '[data-tour="screener"]',
      title: 'Stock Screener',
      description: 'Find stocks using pre-built screens like Undervalued Growth and Dividend Champions.'
    },
    {
      type: 'highlight',
      tab: 'earnings',
      target: '[data-tour="earnings"]',
      title: 'Earnings Calendar',
      description: 'Track upcoming earnings reports with expected vs previous EPS.'
    },
    {
      type: 'highlight',
      tab: 'news',
      target: '[data-tour="news"]',
      title: 'Market News',
      description: 'Stay updated with market-moving news for your watchlist and top movers.'
    },
    {
      type: 'highlight',
      tab: null,
      target: '[data-tour="search"]',
      title: 'Quick Search',
      description: 'Press / anytime to quickly search for any stock.',
      isFinal: true
    }
  ]

  const currentStep = steps[step]
  const isModal = currentStep.type === 'welcome'
  const isFinalStep = currentStep.isFinal
  const totalSteps = steps.length

  // Handle window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Keyboard navigation (desktop only)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleBack()
      } else if (e.key === 'Escape') {
        handleSkip()
      } else if (e.key === '/' && isFinalStep) {
        e.preventDefault()
        handleSkip()
        if (onOpenSearch) onOpenSearch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step, isFinalStep])

  // Update highlight and switch tabs
  useEffect(() => {
    if (isModal) {
      setHighlightRect(null)
      return
    }

    // Switch to the correct tab if specified
    if (currentStep.tab && setActivePage) {
      setActivePage(currentStep.tab)
    }

    // Wait for tab to render, then find and highlight element
    const updateHighlight = () => {
      const element = document.querySelector(currentStep.target)
      if (element) {
        const rect = element.getBoundingClientRect()
        setHighlightRect({
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12
        })
        // Scroll element into view on mobile
        if (isMobile) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        setHighlightRect(null)
      }
    }

    // Delay to allow tab content to render
    const timeout = setTimeout(updateHighlight, 150)
    window.addEventListener('resize', updateHighlight)
    window.addEventListener('scroll', updateHighlight)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('resize', updateHighlight)
      window.removeEventListener('scroll', updateHighlight)
    }
  }, [step, currentStep, setActivePage, isMobile])

  const handleNext = () => {
    if (step === steps.length - 1) {
      localStorage.setItem('tour_completed', 'true')
      onComplete()
    } else {
      setIsAnimating(true)
      setTimeout(() => {
        setStep(step + 1)
        setIsAnimating(false)
      }, 150)
    }
  }

  const handleBack = () => {
    if (step > 0) {
      setIsAnimating(true)
      setTimeout(() => {
        setStep(step - 1)
        setIsAnimating(false)
      }, 150)
    }
  }

  const handleSkip = () => {
    localStorage.setItem('tour_completed', 'true')
    onComplete()
  }

  return (
    <div className={`fixed inset-0 z-[200] transition-opacity duration-300 ${isAnimating ? 'opacity-50' : 'opacity-100'}`}>
      {/* Semi-transparent overlay - does NOT dismiss on click */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Highlight cutout for non-modal steps */}
      {!isModal && highlightRect && (
        <>
          {/* Spotlight effect */}
          <div
            className="absolute rounded-xl transition-all duration-300 ease-out pointer-events-none"
            style={{
              top: highlightRect.top,
              left: highlightRect.left,
              width: highlightRect.width,
              height: highlightRect.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
              background: 'transparent',
              border: '3px solid #8b5cf6',
              animation: 'pulse-border 2s ease-in-out infinite'
            }}
          />
          {/* Glow effect */}
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: highlightRect.top - 4,
              left: highlightRect.left - 4,
              width: highlightRect.width + 8,
              height: highlightRect.height + 8,
              boxShadow: '0 0 30px 10px rgba(139, 92, 246, 0.4)',
              transition: 'all 0.3s ease-out'
            }}
          />
        </>
      )}

      {/* Welcome Modal (centered) */}
      {isModal && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl border border-purple-500/50 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 md:p-8 text-center">
              <div className="text-5xl mb-4">{currentStep.emoji}</div>
              <h2 className="text-xl md:text-2xl font-bold text-white mb-3">{currentStep.title}</h2>
              <p className="text-gray-400 leading-relaxed">{currentStep.description}</p>
            </div>
            <div className="px-6 md:px-8 pb-6 flex flex-col gap-3">
              <button
                onClick={handleNext}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition-colors"
              >
                Let's go!
              </button>
              <button
                onClick={handleSkip}
                className="w-full py-2 text-gray-400 hover:text-gray-300 text-sm transition-colors"
              >
                Skip tour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip - Fixed at bottom on mobile, positioned near element on desktop */}
      {!isModal && (
        <div className={`fixed z-50 ${isMobile ? 'inset-x-4 bottom-4' : 'bottom-8 left-1/2 -translate-x-1/2'}`}>
          <div className="bg-gray-800 rounded-xl border border-purple-500/50 shadow-2xl max-w-md mx-auto overflow-hidden">
            {/* Progress dots */}
            <div className="flex justify-center gap-1.5 pt-4">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === step ? 'bg-purple-500' : i < step ? 'bg-purple-400/50' : 'bg-gray-600'
                  }`}
                />
              ))}
            </div>

            {/* Content */}
            <div className="p-4 md:p-5 pt-3">
              <h3 className="text-lg md:text-xl font-bold text-white mb-2">{currentStep.title}</h3>
              <p className="text-gray-300 text-sm md:text-base leading-relaxed">{currentStep.description}</p>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between px-4 md:px-5 pb-4 gap-3">
              {step > 0 ? (
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Back
                </button>
              ) : (
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Skip
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium transition-colors"
              >
                {isFinalStep ? 'Start Exploring' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { border-color: #8b5cf6; }
          50% { border-color: #a78bfa; }
        }
      `}</style>
    </div>
  )
}

// ============ PREDICTIVE SEARCH ============
// Popular stocks by first letter for supplementing short searches
const POPULAR_STOCKS = {
  'A': [
    { symbol: 'AAPL', name: 'Apple Inc', type: 'EQUITY' },
    { symbol: 'AMZN', name: 'Amazon.com Inc', type: 'EQUITY' },
    { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'EQUITY' },
    { symbol: 'ABBV', name: 'AbbVie Inc', type: 'EQUITY' },
    { symbol: 'AVGO', name: 'Broadcom Inc', type: 'EQUITY' },
    { symbol: 'ADBE', name: 'Adobe Inc', type: 'EQUITY' },
    { symbol: 'ABT', name: 'Abbott Laboratories', type: 'EQUITY' },
    { symbol: 'ACN', name: 'Accenture plc', type: 'EQUITY' },
    { symbol: 'ABNB', name: 'Airbnb Inc', type: 'EQUITY' },
    { symbol: 'AXP', name: 'American Express', type: 'EQUITY' }
  ],
  'B': [
    { symbol: 'BRK-B', name: 'Berkshire Hathaway', type: 'EQUITY' },
    { symbol: 'BAC', name: 'Bank of America', type: 'EQUITY' },
    { symbol: 'BA', name: 'Boeing Co', type: 'EQUITY' },
    { symbol: 'BMY', name: 'Bristol-Myers Squibb', type: 'EQUITY' },
    { symbol: 'BLK', name: 'BlackRock Inc', type: 'EQUITY' },
    { symbol: 'BKNG', name: 'Booking Holdings', type: 'EQUITY' },
    { symbol: 'BX', name: 'Blackstone Inc', type: 'EQUITY' },
    { symbol: 'BSX', name: 'Boston Scientific', type: 'EQUITY' },
    { symbol: 'BIIB', name: 'Biogen Inc', type: 'EQUITY' },
    { symbol: 'BDX', name: 'Becton Dickinson', type: 'EQUITY' }
  ],
  'C': [
    { symbol: 'COST', name: 'Costco Wholesale', type: 'EQUITY' },
    { symbol: 'CRM', name: 'Salesforce Inc', type: 'EQUITY' },
    { symbol: 'CVX', name: 'Chevron Corporation', type: 'EQUITY' },
    { symbol: 'CSCO', name: 'Cisco Systems', type: 'EQUITY' },
    { symbol: 'C', name: 'Citigroup Inc', type: 'EQUITY' },
    { symbol: 'CAT', name: 'Caterpillar Inc', type: 'EQUITY' },
    { symbol: 'CMCSA', name: 'Comcast Corporation', type: 'EQUITY' },
    { symbol: 'COP', name: 'ConocoPhillips', type: 'EQUITY' },
    { symbol: 'CI', name: 'Cigna Group', type: 'EQUITY' },
    { symbol: 'CRWD', name: 'CrowdStrike Holdings', type: 'EQUITY' }
  ],
  'D': [
    { symbol: 'DIS', name: 'Walt Disney Co', type: 'EQUITY' },
    { symbol: 'DHR', name: 'Danaher Corporation', type: 'EQUITY' },
    { symbol: 'DE', name: 'Deere & Company', type: 'EQUITY' },
    { symbol: 'DXCM', name: 'DexCom Inc', type: 'EQUITY' },
    { symbol: 'DUK', name: 'Duke Energy', type: 'EQUITY' },
    { symbol: 'D', name: 'Dominion Energy', type: 'EQUITY' },
    { symbol: 'DASH', name: 'DoorDash Inc', type: 'EQUITY' },
    { symbol: 'DVN', name: 'Devon Energy', type: 'EQUITY' },
    { symbol: 'DG', name: 'Dollar General', type: 'EQUITY' },
    { symbol: 'DKNG', name: 'DraftKings Inc', type: 'EQUITY' }
  ],
  'E': [
    { symbol: 'XOM', name: 'Exxon Mobil', type: 'EQUITY' },
    { symbol: 'ETN', name: 'Eaton Corporation', type: 'EQUITY' },
    { symbol: 'EMR', name: 'Emerson Electric', type: 'EQUITY' },
    { symbol: 'ELV', name: 'Elevance Health', type: 'EQUITY' },
    { symbol: 'EOG', name: 'EOG Resources', type: 'EQUITY' },
    { symbol: 'ENPH', name: 'Enphase Energy', type: 'EQUITY' },
    { symbol: 'EL', name: 'Estée Lauder', type: 'EQUITY' },
    { symbol: 'EA', name: 'Electronic Arts', type: 'EQUITY' },
    { symbol: 'EW', name: 'Edwards Lifesciences', type: 'EQUITY' },
    { symbol: 'EBAY', name: 'eBay Inc', type: 'EQUITY' }
  ],
  'F': [
    { symbol: 'F', name: 'Ford Motor Co', type: 'EQUITY' },
    { symbol: 'FDX', name: 'FedEx Corporation', type: 'EQUITY' },
    { symbol: 'FCX', name: 'Freeport-McMoRan', type: 'EQUITY' },
    { symbol: 'FSLR', name: 'First Solar Inc', type: 'EQUITY' },
    { symbol: 'FISV', name: 'Fiserv Inc', type: 'EQUITY' },
    { symbol: 'FIS', name: 'Fidelity National', type: 'EQUITY' },
    { symbol: 'FTNT', name: 'Fortinet Inc', type: 'EQUITY' },
    { symbol: 'FI', name: 'Fiserv Inc', type: 'EQUITY' },
    { symbol: 'FAST', name: 'Fastenal Company', type: 'EQUITY' },
    { symbol: 'FTV', name: 'Fortive Corporation', type: 'EQUITY' }
  ],
  'G': [
    { symbol: 'GOOGL', name: 'Alphabet Inc Class A', type: 'EQUITY' },
    { symbol: 'GOOG', name: 'Alphabet Inc Class C', type: 'EQUITY' },
    { symbol: 'GS', name: 'Goldman Sachs', type: 'EQUITY' },
    { symbol: 'GE', name: 'General Electric', type: 'EQUITY' },
    { symbol: 'GM', name: 'General Motors', type: 'EQUITY' },
    { symbol: 'GILD', name: 'Gilead Sciences', type: 'EQUITY' },
    { symbol: 'GD', name: 'General Dynamics', type: 'EQUITY' },
    { symbol: 'GPN', name: 'Global Payments', type: 'EQUITY' },
    { symbol: 'GIS', name: 'General Mills', type: 'EQUITY' },
    { symbol: 'GLW', name: 'Corning Inc', type: 'EQUITY' }
  ],
  'H': [
    { symbol: 'HD', name: 'Home Depot Inc', type: 'EQUITY' },
    { symbol: 'HON', name: 'Honeywell International', type: 'EQUITY' },
    { symbol: 'HUM', name: 'Humana Inc', type: 'EQUITY' },
    { symbol: 'HCA', name: 'HCA Healthcare', type: 'EQUITY' },
    { symbol: 'HPQ', name: 'HP Inc', type: 'EQUITY' },
    { symbol: 'HSBC', name: 'HSBC Holdings', type: 'EQUITY' },
    { symbol: 'HLT', name: 'Hilton Worldwide', type: 'EQUITY' },
    { symbol: 'HPE', name: 'Hewlett Packard', type: 'EQUITY' },
    { symbol: 'HAL', name: 'Halliburton Co', type: 'EQUITY' },
    { symbol: 'HOOD', name: 'Robinhood Markets', type: 'EQUITY' }
  ],
  'I': [
    { symbol: 'INTC', name: 'Intel Corporation', type: 'EQUITY' },
    { symbol: 'IBM', name: 'IBM Corporation', type: 'EQUITY' },
    { symbol: 'INTU', name: 'Intuit Inc', type: 'EQUITY' },
    { symbol: 'ISRG', name: 'Intuitive Surgical', type: 'EQUITY' },
    { symbol: 'ICE', name: 'Intercontinental Exchange', type: 'EQUITY' },
    { symbol: 'ITW', name: 'Illinois Tool Works', type: 'EQUITY' },
    { symbol: 'IDXX', name: 'IDEXX Laboratories', type: 'EQUITY' },
    { symbol: 'IQV', name: 'IQVIA Holdings', type: 'EQUITY' },
    { symbol: 'IR', name: 'Ingersoll Rand', type: 'EQUITY' },
    { symbol: 'ILMN', name: 'Illumina Inc', type: 'EQUITY' }
  ],
  'J': [
    { symbol: 'JPM', name: 'JPMorgan Chase', type: 'EQUITY' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'EQUITY' },
    { symbol: 'JBHT', name: 'JB Hunt Transport', type: 'EQUITY' },
    { symbol: 'JCI', name: 'Johnson Controls', type: 'EQUITY' },
    { symbol: 'JD', name: 'JD.com Inc', type: 'EQUITY' },
    { symbol: 'JWN', name: 'Nordstrom Inc', type: 'EQUITY' },
    { symbol: 'JNPR', name: 'Juniper Networks', type: 'EQUITY' },
    { symbol: 'J', name: 'Jacobs Engineering', type: 'EQUITY' },
    { symbol: 'JAZZ', name: 'Jazz Pharmaceuticals', type: 'EQUITY' },
    { symbol: 'JLL', name: 'Jones Lang LaSalle', type: 'EQUITY' }
  ],
  'K': [
    { symbol: 'KO', name: 'Coca-Cola Company', type: 'EQUITY' },
    { symbol: 'KHC', name: 'Kraft Heinz', type: 'EQUITY' },
    { symbol: 'KLAC', name: 'KLA Corporation', type: 'EQUITY' },
    { symbol: 'KMB', name: 'Kimberly-Clark', type: 'EQUITY' },
    { symbol: 'KMI', name: 'Kinder Morgan', type: 'EQUITY' },
    { symbol: 'KDP', name: 'Keurig Dr Pepper', type: 'EQUITY' },
    { symbol: 'K', name: 'Kellanova', type: 'EQUITY' },
    { symbol: 'KR', name: 'Kroger Co', type: 'EQUITY' },
    { symbol: 'KSS', name: 'Kohl\'s Corporation', type: 'EQUITY' },
    { symbol: 'KEYS', name: 'Keysight Technologies', type: 'EQUITY' }
  ],
  'L': [
    { symbol: 'LLY', name: 'Eli Lilly', type: 'EQUITY' },
    { symbol: 'LMT', name: 'Lockheed Martin', type: 'EQUITY' },
    { symbol: 'LOW', name: 'Lowe\'s Companies', type: 'EQUITY' },
    { symbol: 'LRCX', name: 'Lam Research', type: 'EQUITY' },
    { symbol: 'LIN', name: 'Linde plc', type: 'EQUITY' },
    { symbol: 'LVS', name: 'Las Vegas Sands', type: 'EQUITY' },
    { symbol: 'LULU', name: 'Lululemon Athletica', type: 'EQUITY' },
    { symbol: 'LUV', name: 'Southwest Airlines', type: 'EQUITY' },
    { symbol: 'LYFT', name: 'Lyft Inc', type: 'EQUITY' },
    { symbol: 'LEN', name: 'Lennar Corporation', type: 'EQUITY' }
  ],
  'M': [
    { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'EQUITY' },
    { symbol: 'META', name: 'Meta Platforms Inc', type: 'EQUITY' },
    { symbol: 'MA', name: 'Mastercard Inc', type: 'EQUITY' },
    { symbol: 'MCD', name: 'McDonald\'s Corp', type: 'EQUITY' },
    { symbol: 'MRK', name: 'Merck & Co Inc', type: 'EQUITY' },
    { symbol: 'MMM', name: '3M Company', type: 'EQUITY' },
    { symbol: 'MO', name: 'Altria Group Inc', type: 'EQUITY' },
    { symbol: 'MS', name: 'Morgan Stanley', type: 'EQUITY' },
    { symbol: 'MDLZ', name: 'Mondelez International', type: 'EQUITY' },
    { symbol: 'MU', name: 'Micron Technology', type: 'EQUITY' }
  ],
  'N': [
    { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'EQUITY' },
    { symbol: 'NFLX', name: 'Netflix Inc', type: 'EQUITY' },
    { symbol: 'NKE', name: 'Nike Inc', type: 'EQUITY' },
    { symbol: 'NOW', name: 'ServiceNow Inc', type: 'EQUITY' },
    { symbol: 'NEE', name: 'NextEra Energy', type: 'EQUITY' },
    { symbol: 'NEM', name: 'Newmont Corporation', type: 'EQUITY' },
    { symbol: 'NSC', name: 'Norfolk Southern', type: 'EQUITY' },
    { symbol: 'NDAQ', name: 'Nasdaq Inc', type: 'EQUITY' },
    { symbol: 'NOC', name: 'Northrop Grumman', type: 'EQUITY' },
    { symbol: 'NUE', name: 'Nucor Corporation', type: 'EQUITY' }
  ],
  'O': [
    { symbol: 'ORCL', name: 'Oracle Corporation', type: 'EQUITY' },
    { symbol: 'OXY', name: 'Occidental Petroleum', type: 'EQUITY' },
    { symbol: 'ON', name: 'ON Semiconductor', type: 'EQUITY' },
    { symbol: 'ODFL', name: 'Old Dominion Freight', type: 'EQUITY' },
    { symbol: 'OMC', name: 'Omnicom Group', type: 'EQUITY' },
    { symbol: 'ORLY', name: 'O\'Reilly Automotive', type: 'EQUITY' },
    { symbol: 'OKE', name: 'ONEOK Inc', type: 'EQUITY' },
    { symbol: 'OTIS', name: 'Otis Worldwide', type: 'EQUITY' },
    { symbol: 'O', name: 'Realty Income Corp', type: 'EQUITY' },
    { symbol: 'OKTA', name: 'Okta Inc', type: 'EQUITY' }
  ],
  'P': [
    { symbol: 'PG', name: 'Procter & Gamble', type: 'EQUITY' },
    { symbol: 'PFE', name: 'Pfizer Inc', type: 'EQUITY' },
    { symbol: 'PEP', name: 'PepsiCo Inc', type: 'EQUITY' },
    { symbol: 'PYPL', name: 'PayPal Holdings', type: 'EQUITY' },
    { symbol: 'PM', name: 'Philip Morris', type: 'EQUITY' },
    { symbol: 'PANW', name: 'Palo Alto Networks', type: 'EQUITY' },
    { symbol: 'PNC', name: 'PNC Financial', type: 'EQUITY' },
    { symbol: 'PSX', name: 'Phillips 66', type: 'EQUITY' },
    { symbol: 'PLD', name: 'Prologis Inc', type: 'EQUITY' },
    { symbol: 'PLTR', name: 'Palantir Technologies', type: 'EQUITY' }
  ],
  'Q': [
    { symbol: 'QCOM', name: 'Qualcomm Inc', type: 'EQUITY' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'ETF' },
    { symbol: 'QRVO', name: 'Qorvo Inc', type: 'EQUITY' },
    { symbol: 'QSR', name: 'Restaurant Brands', type: 'EQUITY' },
    { symbol: 'QTWO', name: 'Q2 Holdings', type: 'EQUITY' },
    { symbol: 'QUAD', name: 'Quad/Graphics', type: 'EQUITY' },
    { symbol: 'QDEL', name: 'QuidelOrtho', type: 'EQUITY' },
    { symbol: 'QUOT', name: 'Quotient Technology', type: 'EQUITY' }
  ],
  'R': [
    { symbol: 'RTX', name: 'RTX Corporation', type: 'EQUITY' },
    { symbol: 'REGN', name: 'Regeneron Pharma', type: 'EQUITY' },
    { symbol: 'ROP', name: 'Roper Technologies', type: 'EQUITY' },
    { symbol: 'ROST', name: 'Ross Stores', type: 'EQUITY' },
    { symbol: 'RCL', name: 'Royal Caribbean', type: 'EQUITY' },
    { symbol: 'RSG', name: 'Republic Services', type: 'EQUITY' },
    { symbol: 'RIVN', name: 'Rivian Automotive', type: 'EQUITY' },
    { symbol: 'RBLX', name: 'Roblox Corporation', type: 'EQUITY' },
    { symbol: 'RF', name: 'Regions Financial', type: 'EQUITY' },
    { symbol: 'RMD', name: 'ResMed Inc', type: 'EQUITY' }
  ],
  'S': [
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF', type: 'ETF' },
    { symbol: 'SBUX', name: 'Starbucks Corp', type: 'EQUITY' },
    { symbol: 'SCHW', name: 'Charles Schwab', type: 'EQUITY' },
    { symbol: 'SLB', name: 'Schlumberger Ltd', type: 'EQUITY' },
    { symbol: 'SO', name: 'Southern Company', type: 'EQUITY' },
    { symbol: 'SNOW', name: 'Snowflake Inc', type: 'EQUITY' },
    { symbol: 'SHOP', name: 'Shopify Inc', type: 'EQUITY' },
    { symbol: 'SQ', name: 'Block Inc', type: 'EQUITY' },
    { symbol: 'SNAP', name: 'Snap Inc', type: 'EQUITY' },
    { symbol: 'SOFI', name: 'SoFi Technologies', type: 'EQUITY' }
  ],
  'T': [
    { symbol: 'TSLA', name: 'Tesla Inc', type: 'EQUITY' },
    { symbol: 'T', name: 'AT&T Inc', type: 'EQUITY' },
    { symbol: 'TGT', name: 'Target Corporation', type: 'EQUITY' },
    { symbol: 'TMO', name: 'Thermo Fisher Scientific', type: 'EQUITY' },
    { symbol: 'TXN', name: 'Texas Instruments', type: 'EQUITY' },
    { symbol: 'TJX', name: 'TJX Companies', type: 'EQUITY' },
    { symbol: 'TMUS', name: 'T-Mobile US', type: 'EQUITY' },
    { symbol: 'TTWO', name: 'Take-Two Interactive', type: 'EQUITY' },
    { symbol: 'TFC', name: 'Truist Financial', type: 'EQUITY' },
    { symbol: 'TWLO', name: 'Twilio Inc', type: 'EQUITY' }
  ],
  'U': [
    { symbol: 'UNH', name: 'UnitedHealth Group', type: 'EQUITY' },
    { symbol: 'UPS', name: 'United Parcel Service', type: 'EQUITY' },
    { symbol: 'USB', name: 'US Bancorp', type: 'EQUITY' },
    { symbol: 'UBER', name: 'Uber Technologies', type: 'EQUITY' },
    { symbol: 'ULTA', name: 'Ulta Beauty', type: 'EQUITY' },
    { symbol: 'UAL', name: 'United Airlines', type: 'EQUITY' },
    { symbol: 'U', name: 'Unity Software', type: 'EQUITY' },
    { symbol: 'URI', name: 'United Rentals', type: 'EQUITY' },
    { symbol: 'UNP', name: 'Union Pacific', type: 'EQUITY' },
    { symbol: 'UPST', name: 'Upstart Holdings', type: 'EQUITY' }
  ],
  'V': [
    { symbol: 'V', name: 'Visa Inc', type: 'EQUITY' },
    { symbol: 'VZ', name: 'Verizon Communications', type: 'EQUITY' },
    { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', type: 'EQUITY' },
    { symbol: 'VLO', name: 'Valero Energy', type: 'EQUITY' },
    { symbol: 'VMW', name: 'VMware Inc', type: 'EQUITY' },
    { symbol: 'VFC', name: 'VF Corporation', type: 'EQUITY' },
    { symbol: 'VRSK', name: 'Verisk Analytics', type: 'EQUITY' },
    { symbol: 'VOO', name: 'Vanguard S&P 500', type: 'ETF' },
    { symbol: 'VTI', name: 'Vanguard Total Stock', type: 'ETF' },
    { symbol: 'VNQ', name: 'Vanguard Real Estate', type: 'ETF' }
  ],
  'W': [
    { symbol: 'WMT', name: 'Walmart Inc', type: 'EQUITY' },
    { symbol: 'WFC', name: 'Wells Fargo', type: 'EQUITY' },
    { symbol: 'WBA', name: 'Walgreens Boots', type: 'EQUITY' },
    { symbol: 'WBD', name: 'Warner Bros Discovery', type: 'EQUITY' },
    { symbol: 'WM', name: 'Waste Management', type: 'EQUITY' },
    { symbol: 'WDAY', name: 'Workday Inc', type: 'EQUITY' },
    { symbol: 'W', name: 'Wayfair Inc', type: 'EQUITY' },
    { symbol: 'WDC', name: 'Western Digital', type: 'EQUITY' },
    { symbol: 'WST', name: 'West Pharmaceutical', type: 'EQUITY' },
    { symbol: 'WELL', name: 'Welltower Inc', type: 'EQUITY' }
  ],
  'X': [
    { symbol: 'XOM', name: 'Exxon Mobil', type: 'EQUITY' },
    { symbol: 'XLK', name: 'Technology Select SPDR', type: 'ETF' },
    { symbol: 'XLF', name: 'Financial Select SPDR', type: 'ETF' },
    { symbol: 'XLE', name: 'Energy Select SPDR', type: 'ETF' },
    { symbol: 'XLV', name: 'Health Care Select SPDR', type: 'ETF' },
    { symbol: 'XLY', name: 'Consumer Discretionary SPDR', type: 'ETF' },
    { symbol: 'XLP', name: 'Consumer Staples SPDR', type: 'ETF' },
    { symbol: 'XLI', name: 'Industrial Select SPDR', type: 'ETF' },
    { symbol: 'XLNX', name: 'Xilinx Inc', type: 'EQUITY' },
    { symbol: 'XYL', name: 'Xylem Inc', type: 'EQUITY' }
  ],
  'Y': [
    { symbol: 'YUM', name: 'Yum! Brands', type: 'EQUITY' },
    { symbol: 'Y', name: 'Alleghany Corporation', type: 'EQUITY' },
    { symbol: 'YELP', name: 'Yelp Inc', type: 'EQUITY' },
    { symbol: 'YUMC', name: 'Yum China Holdings', type: 'EQUITY' }
  ],
  'Z': [
    { symbol: 'ZTS', name: 'Zoetis Inc', type: 'EQUITY' },
    { symbol: 'ZM', name: 'Zoom Video', type: 'EQUITY' },
    { symbol: 'ZS', name: 'Zscaler Inc', type: 'EQUITY' },
    { symbol: 'Z', name: 'Zillow Group', type: 'EQUITY' },
    { symbol: 'ZG', name: 'Zillow Group C', type: 'EQUITY' },
    { symbol: 'ZBH', name: 'Zimmer Biomet', type: 'EQUITY' },
    { symbol: 'ZBRA', name: 'Zebra Technologies', type: 'EQUITY' },
    { symbol: 'ZI', name: 'ZoomInfo Technologies', type: 'EQUITY' }
  ]
}

function PredictiveSearch({ onSelect, onClose, placeholder = "Search stocks...", inline = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const wrapperRef = useRef(null)
  const timeoutRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        if (inline) setResults([])
        else onClose?.()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inline, onClose])

  // Search with debounce
  const handleSearch = (q) => {
    setQuery(q)
    clearTimeout(timeoutRef.current)

    if (!q.trim()) {
      setResults([])
      return
    }

    timeoutRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await yahooFetch(q, 'search')
        // API returns { results: [...] } with type/name fields
        const items = data?.results || data?.quotes || []
        let filtered = items
          .filter(r => {
            const itemType = r.type || r.quoteType
            return itemType === 'EQUITY' || itemType === 'ETF'
          })
          .map(r => ({
            symbol: r.symbol,
            name: r.name || r.shortname || r.longname || r.symbol,
            type: r.type || r.quoteType || 'EQUITY',
            exchange: r.exchange || ''
          }))

        // If Yahoo returns few results for short queries, supplement with popular stocks
        if (filtered.length < 5 && q.length <= 2) {
          const firstLetter = q.charAt(0).toUpperCase()
          const popularForLetter = POPULAR_STOCKS[firstLetter] || []
          const queryUpper = q.toUpperCase()

          // Filter popular stocks that match the query
          const matchingPopular = popularForLetter
            .filter(s => s.symbol.startsWith(queryUpper) || s.name.toUpperCase().includes(queryUpper))
            .filter(s => !filtered.some(f => f.symbol === s.symbol)) // Don't duplicate

          filtered = [...filtered, ...matchingPopular]
        }

        // Deduplicate and limit to 10 results
        const seen = new Set()
        const unique = filtered.filter(item => {
          if (seen.has(item.symbol)) return false
          seen.add(item.symbol)
          return true
        }).slice(0, 10)

        setResults(unique)
        setSelectedIndex(0)
      } catch (err) {
        console.error('Search error:', err)
        setResults([])
      }
      setLoading(false)
    }, 200)
  }

  const handleSelect = (item) => {
    onSelect(item.symbol)
    setQuery('')
    setResults([])
    if (!inline) onClose?.()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault()
      handleSelect(results[selectedIndex])
    } else if (e.key === 'Escape') {
      onClose?.()
    }
  }

  const showDropdown = query && (loading || results.length > 0 || (!loading && query.length > 0))

  if (inline) {
    return (
      <div className="relative" ref={wrapperRef}>
        <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="bg-transparent text-white placeholder-gray-400 outline-none flex-1 text-sm"
          />
          {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
        </div>
        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 rounded-lg border border-gray-700 shadow-xl z-50 overflow-hidden max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-center text-gray-400">Searching...</div>
            ) : results.length > 0 ? (
              results.map((item, i) => (
                <button
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                    i === selectedIndex ? 'bg-blue-600/30' : 'hover:bg-gray-700'
                  }`}
                >
                  <div>
                    <span className="text-white font-medium">{item.symbol}</span>
                    <span className="text-gray-400 text-sm ml-2">{item.name}</span>
                  </div>
                  <Plus className="w-4 h-4 text-gray-400" />
                </button>
              ))
            ) : (
              <div className="p-3 text-center text-gray-400">No results</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 sm:bg-black/60 backdrop-blur-sm flex items-start justify-center pt-4 sm:pt-20 z-50" onClick={onClose}>
      <div ref={wrapperRef} className="bg-gray-800 sm:rounded-xl w-full h-full sm:h-auto sm:max-w-lg sm:mx-4 shadow-2xl sm:border border-gray-700 overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Search Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-700 flex-shrink-0">
          <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none text-lg"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]) }}
              className="p-1.5 rounded-lg hover:bg-gray-700 sm:hidden"
              aria-label="Clear search"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}
          <button
            onClick={onClose}
            className="sm:hidden p-2 -mr-2 text-blue-400 font-medium"
          >
            Cancel
          </button>
          <kbd className="hidden sm:block px-2 py-1 text-xs bg-gray-700 rounded text-gray-300">ESC</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto sm:max-h-96">
          {loading ? (
            <div className="p-6 text-center">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              <p className="text-gray-400 mt-2">Searching...</p>
            </div>
          ) : results.length > 0 ? (
            results.map((item, i) => (
              <button
                key={item.symbol}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center justify-between p-4 transition-colors border-b border-gray-700/50 last:border-0 active:bg-gray-600 ${
                  i === selectedIndex ? 'bg-blue-600/30' : 'hover:bg-gray-700'
                }`}
              >
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{item.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      item.type === 'ETF' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {item.type}
                    </span>
                  </div>
                  <div className="text-gray-400 text-sm mt-0.5">{item.name}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))
          ) : query ? (
            <div className="p-8 text-center text-gray-400">No results for "{query}"</div>
          ) : (
            <div className="p-6 text-center text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Type to search stocks</p>
            </div>
          )}
        </div>
        {/* Footer - hidden on mobile */}
        <div className="hidden sm:flex p-3 border-t border-gray-700 items-center justify-between text-xs text-gray-500 flex-shrink-0">
          <span><kbd className="px-1 bg-gray-700 rounded">↑↓</kbd> navigate <kbd className="px-1 bg-gray-700 rounded ml-2">↵</kbd> select</span>
          <span><kbd className="px-1 bg-gray-700 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

// ============ EARNINGS CALENDAR ============
function EarningsCalendar({ onSelect }) {
  const [earnings, setEarnings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        const today = new Date()
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        const from = today.toISOString().split('T')[0]
        const to = nextWeek.toISOString().split('T')[0]
        const data = await finnhubFetch(`/calendar/earnings?from=${from}&to=${to}`)
        const calendar = data && Array.isArray(data.earningsCalendar) ? data.earningsCalendar : []
        setEarnings(calendar.slice(0, 8))
      } catch { setEarnings([]) }
      finally { setLoading(false) }
    }
    fetchEarnings()
  }, [])

  return (
    <div className="rounded-xl p-4 border bg-gray-800/50 border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-purple-400" />
        <h3 className="font-semibold text-white">Upcoming Earnings</h3>
      </div>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : earnings.length > 0 ? (
        <div className="space-y-2">
          {earnings.map((e, i) => (
            <button key={i} onClick={() => onSelect(e.symbol)}
              className="w-full flex items-center justify-between p-2 rounded-lg transition-colors hover:bg-gray-700/50">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{e.symbol}</span>
                <span className="text-xs text-gray-400">{e.hour === 'bmo' ? 'Before Open' : 'After Close'}</span>
              </div>
              <span className="text-sm text-gray-400">{e.date}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No upcoming earnings</p>
      )}
    </div>
  )
}

// ============ SMART WATCHLIST INSIGHTS ============
function WatchlistInsights({ watchlist, quotes }) {
  if (!watchlist || watchlist.length === 0) return null

  const validQuotes = watchlist.filter(s => quotes[s] && quotes[s].c > 0).map(s => ({
    symbol: s,
    change: quotes[s].changePercent ?? 0
  }))

  if (validQuotes.length === 0) return null

  const topGainer = validQuotes.reduce((max, q) => q.change > max.change ? q : max, validQuotes[0])
  const topLoser = validQuotes.reduce((min, q) => q.change < min.change ? q : min, validQuotes[0])
  const avgChange = validQuotes.reduce((sum, q) => sum + q.change, 0) / validQuotes.length
  const bullishCount = validQuotes.filter(q => q.change > 0).length

  return (
    <div className="rounded-xl p-4 border bg-gradient-to-br from-blue-900/20 to-gray-800 border-blue-500/30">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-blue-400" />
        <h3 className="font-semibold text-white">Watchlist Insights</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="p-2 rounded-lg bg-gray-700/50">
          <div className="text-gray-400">Top Gainer</div>
          <div className="flex items-center gap-1">
            <span className="font-medium text-white">{topGainer.symbol}</span>
            <span className="text-green-400">+{topGainer.change.toFixed(1)}%</span>
          </div>
        </div>
        <div className="p-2 rounded-lg bg-gray-700/50">
          <div className="text-gray-400">Top Loser</div>
          <div className="flex items-center gap-1">
            <span className="font-medium text-white">{topLoser.symbol}</span>
            <span className="text-red-400">{topLoser.change.toFixed(1)}%</span>
          </div>
        </div>
        <div className="p-2 rounded-lg bg-gray-700/50">
          <div className="text-gray-400">Avg Change</div>
          <span className={avgChange >= 0 ? 'text-green-400' : 'text-red-400'}>{avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%</span>
        </div>
        <div className="p-2 rounded-lg bg-gray-700/50">
          <div className="text-gray-400">Bullish</div>
          <span className="text-white">{bullishCount}/{validQuotes.length}</span>
        </div>
      </div>
    </div>
  )
}

// ============ STOCK NEWS MODAL ============
function StockNewsModal({ symbol, onClose }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const to = new Date().toISOString().split('T')[0]
        const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const data = await finnhubFetch(`/company-news?symbol=${symbol}&from=${from}&to=${to}`)
        // Use parseNewsResponse to handle both array and object formats
        const articles = parseNewsResponse(data).slice(0, 10)
        setNews(articles)
      } catch { setNews([]) }
      finally { setLoading(false) }
    }
    fetchNews()
  }, [symbol])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-gray-700 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{symbol} News</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto max-h-[calc(80vh-80px)] p-4 space-y-3">
          {loading ? [1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />) : news.length > 0 ? news.map((article, i) => {
            const summary = article.summary || ''
            return (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="block bg-gray-700/30 hover:bg-gray-700/50 rounded-lg transition-all group p-4">
                <h4 className="text-white font-medium group-hover:text-blue-400 line-clamp-2 mb-1">{article.headline}</h4>
                {summary && (
                  <p className="text-sm text-gray-400 line-clamp-2 mb-2">{summary}</p>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-300">{article.source}</span>
                  <span className="text-gray-500">•</span>
                  <span className="text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(article.datetime)}
                  </span>
                </div>
              </a>
            )
          }) : <div className="text-center py-8 text-gray-400">No recent news</div>}
        </div>
      </div>
    </div>
  )
}

// ============ MOBILE BOTTOM NAV ============
function MobileBottomNav({ activePage, setActivePage, onSearchOpen }) {
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  const mainItems = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Grid3X3 },
    { id: 'insights', label: 'AI', icon: Brain },
    { id: 'news', label: 'News', icon: Newspaper }
  ]

  const moreItems = [
    { id: 'screener', label: 'Screener', icon: Filter },
    { id: 'earnings', label: 'Earnings', icon: Calendar },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  const isMoreActive = moreItems.some(item => item.id === activePage)

  return (
    <>
      {/* More Menu Overlay */}
      {showMoreMenu && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setShowMoreMenu(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute bottom-20 left-4 right-4 bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-2">
              {moreItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => { setActivePage(item.id); setShowMoreMenu(false) }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all ${
                    activePage === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700 active:bg-gray-600'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-gray-700 p-2">
              <button
                onClick={() => { onSearchOpen(); setShowMoreMenu(false) }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-gray-300 hover:bg-gray-700 active:bg-gray-600 transition-all"
              >
                <Search className="w-5 h-5" />
                <span className="font-medium">Search Stocks</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800/95 backdrop-blur-lg border-t border-gray-700 z-40 pb-safe">
        <div className="flex items-center justify-around py-1">
          {mainItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              aria-label={item.label}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[52px] px-2 py-1.5 rounded-xl transition-all active:scale-95 ${
                activePage === item.id
                  ? 'text-blue-500 bg-blue-500/10'
                  : 'text-gray-400 active:bg-gray-700'
              }`}
            >
              <item.icon className="w-6 h-6" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            aria-label="More options"
            className={`flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[52px] px-2 py-1.5 rounded-xl transition-all active:scale-95 ${
              isMoreActive || showMoreMenu
                ? 'text-blue-500 bg-blue-500/10'
                : 'text-gray-400 active:bg-gray-700'
            }`}
          >
            <Menu className="w-6 h-6" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}

// ============ DESKTOP NAVIGATION ============
function DesktopNav({ activePage, setActivePage, onSearchOpen, syncStatus }) {
  const { user, loading: authLoading, signIn, signOut: handleSignOut } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, tour: 'dashboard' },
    { id: 'explore', label: 'Explore', icon: Grid3X3, tour: 'explore' },
    { id: 'insights', label: 'AI Insights', icon: Brain, tour: 'insights' },
    { id: 'screener', label: 'Screener', icon: Filter, tour: 'screener' },
    { id: 'earnings', label: 'Earnings', icon: Calendar, tour: 'earnings' },
    { id: 'news', label: 'News', icon: Newspaper, tour: 'news' },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  return (
    <nav className="glass-strong gradient-border sticky top-0 z-40 overflow-visible">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/25 ring-1 ring-white/10">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg hidden sm:block tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Stock Research Hub</span>
          </div>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActivePage(item.id)}
                data-tour={item.tour}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  activePage === item.id ? 'nav-active text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}>
                <item.icon className="w-4 h-4" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-visible">
            {user && (
              <Tooltip content={syncStatus.synced ? 'Synced to cloud' : syncStatus.syncing ? 'Syncing...' : 'Local only - check console for sync errors'}>
                <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  syncStatus.synced ? 'bg-green-500/20 text-green-400' : syncStatus.syncing ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {syncStatus.syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : syncStatus.synced ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
                  <span>{syncStatus.synced ? 'Synced' : syncStatus.syncing ? 'Syncing' : 'Local'}</span>
                </div>
              </Tooltip>
            )}
            <button
              data-tour="search"
              aria-label="Search (Press /)"
              onClick={onSearchOpen}
              className="p-2 rounded-lg transition-colors hover:bg-gray-700 text-gray-300"
            >
              <Search className="w-5 h-5" />
            </button>
            {authLoading ? (
              <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
            ) : user ? (
              <div className="relative">
                <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex items-center gap-2">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border-2 border-blue-500" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                      <User className="w-4 h-4 text-gray-400" />
                    </div>
                  )}
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-56 rounded-xl shadow-xl border z-50 overflow-hidden bg-gray-800 border-gray-700">
                      <div className="p-3 border-b border-gray-700">
                        <div className="font-medium text-white">{user.displayName}</div>
                        <div className="text-sm text-gray-400 truncate">{user.email}</div>
                      </div>
                      <button onClick={() => { handleSignOut(); setShowUserMenu(false) }}
                        className="w-full flex items-center gap-2 p-3 text-left transition-colors hover:bg-gray-700 text-gray-300">
                        <LogOut className="w-4 h-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button onClick={signIn} data-tour="signin"
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

// ============ AI MARKET PULSE ============
// ============ SECTORS DATA ============
const SECTORS = [
  { name: 'Technology', symbol: 'XLK' },
  { name: 'Healthcare', symbol: 'XLV' },
  { name: 'Financials', symbol: 'XLF' },
  { name: 'Consumer Disc.', symbol: 'XLY' },
  { name: 'Communication', symbol: 'XLC' },
  { name: 'Industrials', symbol: 'XLI' },
  { name: 'Staples', symbol: 'XLP' },
  { name: 'Energy', symbol: 'XLE' },
  { name: 'Utilities', symbol: 'XLU' },
  { name: 'Real Estate', symbol: 'XLRE' },
  { name: 'Materials', symbol: 'XLB' }
]

// ============ COMPACT SECTOR PERFORMANCE (for Dashboard) ============
function SectorPerformance({ onSelectStock, sectorData, loading }) {
  // Sort sectors by absolute change for better visualization
  const sortedSectors = [...SECTORS].sort((a, b) => {
    const changeA = sectorData[a.symbol]?.changePercent ?? 0
    const changeB = sectorData[b.symbol]?.changePercent ?? 0
    return Math.abs(changeB) - Math.abs(changeA)
  })

  const maxAbsChange = Math.max(
    ...SECTORS.map(s => Math.abs(sectorData[s.symbol]?.changePercent ?? 0)),
    1
  )

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        <PieChart className="w-5 h-5 text-blue-400" />
        Sector Performance
      </h3>
      <div className="card-premium rounded-xl p-4 space-y-2">
        {sortedSectors.map((sector, idx) => {
          const data = sectorData[sector.symbol]
          const change = data?.changePercent ?? 0
          const isPositive = change >= 0
          const barWidth = (Math.abs(change) / maxAbsChange) * 100

          return (
            <button
              key={sector.symbol}
              onClick={() => onSelectStock(sector.symbol)}
              className={`w-full flex items-center gap-3 py-2 px-3 rounded-lg transition-all hover:bg-white/5 stagger-${Math.min(idx + 1, 8)} animate-fade-in`}
            >
              {/* Sector name */}
              <div className="w-24 text-left">
                <span className="text-xs font-medium text-gray-400">{sector.name}</span>
              </div>

              {/* Bar chart */}
              <div className="flex-1 h-6 flex items-center">
                {/* Center axis and bars */}
                <div className="w-full flex items-center relative">
                  {/* Negative bar (left of center) */}
                  <div className="w-1/2 flex justify-end">
                    {!isPositive && !loading && (
                      <div
                        className="h-5 rounded-l-sm sector-bar-negative"
                        style={{ width: `${barWidth}%` }}
                      />
                    )}
                  </div>
                  {/* Center line */}
                  <div className="w-px h-6 bg-gray-600 flex-shrink-0" />
                  {/* Positive bar (right of center) */}
                  <div className="w-1/2 flex justify-start">
                    {isPositive && !loading && (
                      <div
                        className="h-5 rounded-r-sm sector-bar-positive"
                        style={{ width: `${barWidth}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Percentage */}
              <div className="w-16 text-right">
                {loading ? (
                  <div className="h-4 w-12 ml-auto animate-shimmer rounded" />
                ) : (
                  <span className={`font-mono text-sm font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                    {isPositive ? '+' : ''}{change.toFixed(2)}%
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ============ EXPLORE PAGE ============
// Stock universe organized by sector
const STOCK_UNIVERSE = {
  'Technology': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE', 'CSCO', 'IBM', 'QCOM'],
  'Finance': ['JPM', 'BAC', 'GS', 'MS', 'WFC', 'V', 'MA', 'AXP', 'BLK', 'SCHW', 'C', 'USB', 'PNC', 'COF', 'SPGI'],
  'Healthcare': ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD', 'CVS', 'CI', 'HUM'],
  'Consumer': ['WMT', 'COST', 'HD', 'LOW', 'TGT', 'MCD', 'SBUX', 'NKE', 'DIS', 'NFLX', 'CMG', 'YUM', 'BKNG', 'MAR', 'HLT'],
  'Energy': ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'MPC', 'VLO', 'PSX', 'HAL', 'DVN', 'HES', 'KMI', 'WMB', 'ET'],
  'Industrials': ['CAT', 'DE', 'BA', 'HON', 'UPS', 'FDX', 'LMT', 'RTX', 'GE', 'MMM', 'UNP', 'CSX', 'GD', 'NOC', 'EMR'],
  'ETFs': ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'VOO', 'XLK', 'XLV', 'XLF', 'XLE', 'GLD', 'TLT', 'ARKK', 'VNQ', 'EEM']
}

const SECTOR_COLORS = {
  'Technology': 'text-blue-400',
  'Finance': 'text-yellow-400',
  'Healthcare': 'text-green-400',
  'Consumer': 'text-pink-400',
  'Energy': 'text-orange-400',
  'Industrials': 'text-slate-400',
  'ETFs': 'text-cyan-400'
}

function ExplorePage({ onSelectStock }) {
  const [stockData, setStockData] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeSector, setActiveSector] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'heatmap'

  // Fetch all stocks on mount
  useEffect(() => {
    let cancelled = false

    const fetchStocks = async () => {
      const allSymbols = Object.values(STOCK_UNIVERSE).flat()
      const data = {}

      // Fetch in batches of 15
      for (let i = 0; i < allSymbols.length; i += 15) {
        if (cancelled) return
        const batch = allSymbols.slice(i, i + 15)

        try {
          const results = await Promise.allSettled(
            batch.map(s => yahooFetch(s))
          )

          results.forEach((r, idx) => {
            if (r.status === 'fulfilled' && r.value) {
              const n = normalizeYahooQuote(r.value)
              if (n?.c > 0) data[batch[idx]] = n
            }
          })

          if (!cancelled) {
            setStockData({ ...data })
            if (i === 0) setLoading(false)
          }
        } catch (err) {
          console.error('Batch fetch error:', err)
        }
      }

      if (!cancelled) setLoading(false)
    }

    fetchStocks()
    return () => { cancelled = true }
  }, [])

  const sectors = ['All', ...Object.keys(STOCK_UNIVERSE)]

  // Get stocks to display
  const getDisplayStocks = () => {
    let entries = activeSector === 'All'
      ? Object.entries(STOCK_UNIVERSE)
      : [[activeSector, STOCK_UNIVERSE[activeSector] || []]]

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toUpperCase()
      entries = entries
        .map(([sec, syms]) => [
          sec,
          syms.filter(s => s.includes(q) || (stockData[s]?.name || '').toUpperCase().includes(q))
        ])
        .filter(([, syms]) => syms.length > 0)
    }

    return entries
  }

  const loadedCount = Object.keys(stockData).length

  // Get heatmap color based on change percent
  const getHeatmapColor = (changePercent) => {
    if (changePercent >= 3) return 'bg-green-700'
    if (changePercent >= 1) return 'bg-green-600/70'
    if (changePercent >= 0) return 'bg-green-500/40'
    if (changePercent >= -1) return 'bg-red-500/40'
    if (changePercent >= -3) return 'bg-red-600/70'
    return 'bg-red-700'
  }

  return (
    <div className="space-y-6 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Grid3X3 className="w-7 h-7 text-purple-400" />
            Explore Stocks
          </h2>
          <p className="text-gray-400 mt-1">
            {loading ? 'Loading...' : `${loadedCount} stocks loaded`}
          </p>
        </div>
        {/* View Toggle */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-4 h-4" /> Grid
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              viewMode === 'heatmap' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" /> Heatmap
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by symbol or name..."
          className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Sector Pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {sectors.map(sec => (
          <button
            key={sec}
            onClick={() => setActiveSector(sec)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeSector === sec ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {sec} {sec !== 'All' && `(${STOCK_UNIVERSE[sec]?.length || 0})`}
          </button>
        ))}
      </div>

      {/* Stock Grid / Heatmap */}
      {loading && loadedCount === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3">
          {[...Array(24)].map((_, i) => (
            <div key={i} className="p-3 sm:p-4 rounded-xl animate-shimmer">
              <div className="h-4 bg-gray-700 rounded mb-2" />
              <div className="h-3 bg-gray-700 rounded mb-2" />
              <div className="h-4 bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      ) : viewMode === 'heatmap' ? (
        // Heatmap View
        <div className="space-y-6">
          {getDisplayStocks().map(([sector, symbols]) => {
            if (!symbols || symbols.length === 0) return null
            // Sort by market cap for treemap-style sizing
            const sortedSymbols = [...symbols].sort((a, b) => (stockData[b]?.marketCap || 0) - (stockData[a]?.marketCap || 0))
            const maxMcap = Math.max(...sortedSymbols.map(s => stockData[s]?.marketCap || 1))

            return (
              <div key={sector} className="space-y-3">
                <h3 className={`text-sm font-semibold ${SECTOR_COLORS[sector] || 'text-gray-300'}`}>
                  {sector} ({symbols.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {sortedSymbols.map(symbol => {
                    const quote = stockData[symbol]
                    const pct = quote?.changePercent ?? 0
                    const mcap = quote?.marketCap || 1
                    // Scale cell size by market cap (min 80px, max 200px)
                    const scale = Math.sqrt(mcap / maxMcap)
                    const size = Math.max(80, Math.min(200, 80 + scale * 120))
                    return (
                      <button
                        key={symbol}
                        onClick={() => onSelectStock(symbol)}
                        className={`${getHeatmapColor(pct)} rounded-lg p-2 flex flex-col justify-center items-center transition-all hover:scale-105 hover:z-10 hover:shadow-lg`}
                        style={{ width: size, height: size * 0.75 }}
                      >
                        <div className="text-xs sm:text-sm font-bold text-white">{symbol}</div>
                        {quote?.c && <div className="text-xs text-white/80">${quote.c.toFixed(2)}</div>}
                        <div className={`text-xs font-medium ${pct >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        // Grid View
        <div className="space-y-6">
          {getDisplayStocks().map(([sector, symbols]) => {
            if (!symbols || symbols.length === 0) return null
            return (
              <div key={sector} className="space-y-3">
                <h3 className={`text-sm font-semibold ${SECTOR_COLORS[sector] || 'text-gray-300'}`}>
                  {sector} ({symbols.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3">
                  {symbols.map(symbol => {
                    const quote = stockData[symbol]
                    const pct = quote?.changePercent ?? 0
                    const pos = pct >= 0
                    return (
                      <button
                        key={symbol}
                        onClick={() => onSelectStock(symbol)}
                        className={`p-3 sm:p-4 rounded-xl border transition-all hover:scale-[1.02] active:scale-[0.98] text-left ${
                          pos ? 'bg-green-900/20 border-green-500/30 hover:border-green-500 hover-glow-positive'
                            : 'bg-red-900/20 border-red-500/30 hover:border-red-500 hover-glow-negative'
                        }`}
                      >
                        <div className="text-sm sm:text-base font-bold text-white">{symbol}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {quote?.name ? quote.name.split(' ')[0] : '—'}
                        </div>
                        {quote?.c ? (
                          <>
                            <div className="text-sm text-gray-300 mt-1">${quote.c.toFixed(2)}</div>
                            <div className={`text-sm font-medium ${pos ? 'text-green-400' : 'text-red-400'}`}>
                              {pos ? '+' : ''}{pct.toFixed(2)}%
                            </div>
                          </>
                        ) : (
                          <div className="h-10 animate-shimmer rounded mt-1" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ SCREENER TAB ============
const SCREENS = [
  {
    id: 'undervalued',
    name: 'Undervalued Growth',
    description: 'Low P/E ratio with strong growth potential',
    icon: Target,
    color: 'from-green-500 to-emerald-600',
    stocks: ['META', 'GOOG', 'INTC', 'VZ', 'T', 'PARA', 'WBD', 'GM', 'F', 'BAC'],
    metrics: ['pe', 'marketCap']
  },
  {
    id: 'dividend',
    name: 'Dividend Champions',
    description: 'Consistent dividend growers for income',
    icon: DollarSign,
    color: 'from-blue-500 to-indigo-600',
    stocks: ['JNJ', 'PG', 'KO', 'PEP', 'MCD', 'MMM', 'XOM', 'CVX', 'ABBV', 'O'],
    metrics: ['dividendYield', 'marketCap']
  },
  {
    id: 'momentum',
    name: 'Momentum Plays',
    description: 'Stocks with strong recent performance',
    icon: Zap,
    color: 'from-purple-500 to-pink-600',
    stocks: ['NVDA', 'META', 'AMZN', 'NFLX', 'AVGO', 'CRM', 'NOW', 'PANW', 'CRWD', 'LLY'],
    metrics: ['changePercent', 'volume']
  },
  {
    id: 'turnaround',
    name: 'Turnaround Candidates',
    description: 'Down from highs but fundamentals improving',
    icon: RefreshCw,
    color: 'from-orange-500 to-red-600',
    stocks: ['INTC', 'BA', 'DIS', 'PYPL', 'NKE', 'SBUX', 'TGT', 'FDX', 'PARA', 'WBD'],
    metrics: ['distanceFrom52High', 'pe']
  },
  {
    id: 'largecap',
    name: 'Large Cap Leaders',
    description: 'Mega-cap stocks leading the market',
    icon: Crown,
    color: 'from-yellow-500 to-amber-600',
    stocks: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'BRK-B', 'LLY', 'V', 'JPM'],
    metrics: ['marketCap', 'pe']
  },
  {
    id: 'highyield',
    name: 'High Yield',
    description: 'Highest dividend yields for income',
    icon: DollarSign,
    color: 'from-emerald-500 to-teal-600',
    stocks: ['VZ', 'T', 'MO', 'PM', 'IBM', 'O', 'ABBV', 'XOM', 'CVX', 'KHC'],
    metrics: ['dividendYield', 'pe']
  },
  {
    id: 'tech',
    name: 'Tech Titans',
    description: 'Leading technology companies',
    icon: Cpu,
    color: 'from-cyan-500 to-blue-600',
    stocks: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMD', 'CRM', 'ORCL', 'ADBE'],
    metrics: ['pe', 'marketCap']
  },
  {
    id: 'healthcare',
    name: 'Healthcare Heroes',
    description: 'Top healthcare and pharma stocks',
    icon: Heart,
    color: 'from-rose-500 to-pink-600',
    stocks: ['JNJ', 'UNH', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY'],
    metrics: ['pe', 'marketCap']
  },
  {
    id: 'green',
    name: 'Green Energy',
    description: 'Clean energy and EV stocks',
    icon: Leaf,
    color: 'from-green-500 to-lime-600',
    stocks: ['TSLA', 'ENPH', 'FSLR', 'NEE', 'SEDG', 'RUN', 'PLUG', 'BE', 'RIVN', 'LCID'],
    metrics: ['changePercent', 'marketCap']
  },
  {
    id: 'beaten',
    name: 'Beaten Down',
    description: 'Stocks down significantly (potential value)',
    icon: TrendDown,
    color: 'from-red-500 to-rose-600',
    stocks: ['PARA', 'WBD', 'PYPL', 'INTC', 'BA', 'NKE', 'SNAP', 'HOOD', 'RIVN', 'LCID'],
    metrics: ['distanceFrom52High', 'changePercent']
  },
  {
    id: 'smallcap',
    name: 'Small Cap Gems',
    description: 'Smaller companies with growth potential',
    icon: Gem,
    color: 'from-violet-500 to-purple-600',
    stocks: ['SOFI', 'PLTR', 'HOOD', 'RBLX', 'U', 'PATH', 'BILL', 'DKNG', 'CELH', 'DUOL'],
    metrics: ['marketCap', 'changePercent']
  },
  {
    id: 'lowvol',
    name: 'Low Volatility',
    description: 'Stable stocks for conservative investors',
    icon: Shield,
    color: 'from-slate-500 to-gray-600',
    stocks: ['JNJ', 'PG', 'KO', 'PEP', 'WMT', 'CL', 'GIS', 'K', 'HSY', 'CPB'],
    metrics: ['pe', 'dividendYield']
  }
]

const SECTOR_MAP = {
  'Technology': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMD', 'CRM', 'ORCL', 'ADBE', 'INTC', 'AVGO', 'NOW', 'PANW', 'CRWD'],
  'Healthcare': ['JNJ', 'UNH', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY'],
  'Finance': ['JPM', 'BAC', 'V', 'MA', 'GS', 'MS', 'WFC', 'BLK', 'SCHW', 'C'],
  'Consumer': ['AMZN', 'WMT', 'HD', 'MCD', 'NKE', 'SBUX', 'TGT', 'COST', 'PG', 'KO', 'PEP'],
  'Energy': ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'VLO', 'PSX', 'OXY', 'HAL'],
  'Industrial': ['BA', 'CAT', 'DE', 'HON', 'UPS', 'FDX', 'LMT', 'RTX', 'GE', 'MMM']
}

function ScreenerTab({ onSelectStock }) {
  const [selectedScreen, setSelectedScreen] = useState(null)
  const [screenResults, setScreenResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState('table') // 'table' or 'grid'
  const [sortBy, setSortBy] = useState('symbol')
  const [sortDir, setSortDir] = useState('asc')
  const [sectorFilter, setSectorFilter] = useState('All')
  const [capFilter, setCapFilter] = useState('All')

  const formatMarketCap = (cap) => {
    if (!cap) return 'N/A'
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`
    return `$${cap.toLocaleString()}`
  }

  const getCapCategory = (cap) => {
    if (!cap) return 'Unknown'
    if (cap >= 200e9) return 'Mega'
    if (cap >= 10e9) return 'Large'
    if (cap >= 2e9) return 'Mid'
    return 'Small'
  }

  const getSectorForStock = (symbol) => {
    for (const [sector, stocks] of Object.entries(SECTOR_MAP)) {
      if (stocks.includes(symbol)) return sector
    }
    return 'Other'
  }

  const runScreen = async (screen) => {
    setSelectedScreen(screen)
    setLoading(true)
    setSortBy('symbol')
    setSortDir('asc')

    const cacheKey = `screen_v2_${screen.id}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
          setScreenResults(parsed.results)
          setLoading(false)
          return
        }
      } catch {}
    }

    try {
      const results = await Promise.allSettled(
        screen.stocks.map(s => yahooFetch(s))
      )

      const stockData = []
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          const raw = result.value
          const normalized = normalizeYahooQuote(raw)
          if (normalized && normalized.c > 0) {
            const distFrom52High = normalized.weekHigh52
              ? ((normalized.c - normalized.weekHigh52) / normalized.weekHigh52 * 100)
              : null

            stockData.push({
              symbol: screen.stocks[i],
              name: normalized.name,
              price: normalized.c,
              change: normalized.changePercent || 0,
              pe: normalized.peRatio,
              marketCap: normalized.marketCap,
              volume: normalized.volume,
              weekHigh52: normalized.weekHigh52,
              weekLow52: normalized.weekLow52,
              distanceFrom52High: distFrom52High,
              dividendYield: raw.dividendYield || raw.trailingAnnualDividendYield || null,
              sector: getSectorForStock(screen.stocks[i]),
              capCategory: getCapCategory(normalized.marketCap)
            })
          }
        }
      })

      setScreenResults(stockData)
      localStorage.setItem(cacheKey, JSON.stringify({ results: stockData, timestamp: Date.now() }))
    } catch (err) {
      console.error('Screen error:', err)
    }
    setLoading(false)
  }

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  const filteredAndSortedResults = () => {
    let results = [...screenResults]

    // Apply sector filter
    if (sectorFilter !== 'All') {
      results = results.filter(s => s.sector === sectorFilter)
    }

    // Apply cap filter
    if (capFilter !== 'All') {
      results = results.filter(s => s.capCategory === capFilter)
    }

    // Sort
    results.sort((a, b) => {
      let aVal = a[sortBy]
      let bVal = b[sortBy]

      if (typeof aVal === 'string') {
        aVal = aVal?.toLowerCase() || ''
        bVal = bVal?.toLowerCase() || ''
      }
      if (aVal === null || aVal === undefined) aVal = sortDir === 'asc' ? Infinity : -Infinity
      if (bVal === null || bVal === undefined) bVal = sortDir === 'asc' ? Infinity : -Infinity

      if (sortDir === 'asc') return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })

    return results
  }

  const SortHeader = ({ field, label, className = '' }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center gap-1 hover:text-white transition-colors ${className} ${sortBy === field ? 'text-blue-400' : 'text-gray-400'}`}
    >
      {label}
      {sortBy === field && (
        <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  )

  const getMetricDisplay = (stock, metric) => {
    switch (metric) {
      case 'pe':
        return { label: 'P/E', value: stock.pe ? stock.pe.toFixed(1) : 'N/A' }
      case 'marketCap':
        return { label: 'Cap', value: formatMarketCap(stock.marketCap) }
      case 'dividendYield':
        return { label: 'Yield', value: stock.dividendYield ? `${(stock.dividendYield * 100).toFixed(2)}%` : 'N/A' }
      case 'distanceFrom52High':
        return { label: 'vs 52H', value: stock.distanceFrom52High ? `${stock.distanceFrom52High.toFixed(1)}%` : 'N/A' }
      case 'changePercent':
        return { label: 'Change', value: `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%` }
      case 'volume':
        return { label: 'Vol', value: stock.volume ? `${(stock.volume / 1e6).toFixed(1)}M` : 'N/A' }
      default:
        return { label: '', value: '' }
    }
  }

  const uniqueSectors = ['All', ...new Set(screenResults.map(s => s.sector).filter(Boolean))]
  const displayResults = filteredAndSortedResults()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Filter className="w-7 h-7 text-green-400" />
          Stock Screener
        </h2>
        <p className="text-gray-400 mt-1">Curated stock screens for different investment strategies</p>
      </div>

      {/* Screen Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {SCREENS.map(screen => (
          <button
            key={screen.id}
            onClick={() => runScreen(screen)}
            className={`p-4 rounded-xl text-left transition-all hover:scale-[1.02] border ${
              selectedScreen?.id === screen.id
                ? 'border-blue-500 ring-2 ring-blue-500/30 bg-gray-800'
                : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${screen.color} flex items-center justify-center flex-shrink-0`}>
                <screen.icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-white truncate">{screen.name}</h3>
                <p className="text-xs text-gray-400 line-clamp-2">{screen.description}</p>
                <p className="text-xs text-gray-500 mt-1">{screen.stocks.length} stocks</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Screen Results */}
      {selectedScreen && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          {/* Results Header */}
          <div className="p-4 border-b border-gray-700 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${selectedScreen.color} flex items-center justify-center`}>
                <selectedScreen.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white">{selectedScreen.name}</h3>
                <p className="text-xs text-gray-400">{displayResults.length} of {screenResults.length} stocks</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Sector Filter */}
              <select
                value={sectorFilter}
                onChange={e => setSectorFilter(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                {uniqueSectors.map(s => (
                  <option key={s} value={s}>{s === 'All' ? 'All Sectors' : s}</option>
                ))}
              </select>

              {/* Cap Filter */}
              <select
                value={capFilter}
                onChange={e => setCapFilter(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="All">All Caps</option>
                <option value="Mega">Mega Cap</option>
                <option value="Large">Large Cap</option>
                <option value="Mid">Mid Cap</option>
                <option value="Small">Small Cap</option>
              </select>

              {/* View Toggle */}
              <div className="flex items-center bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded ${viewMode === 'table' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Results Content */}
          {loading ? (
            <div className="p-4 space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-gray-700 rounded-lg animate-pulse" />)}
            </div>
          ) : viewMode === 'table' ? (
            /* Table View */
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs border-b border-gray-700">
                    <th className="p-3"><SortHeader field="symbol" label="Symbol" /></th>
                    <th className="p-3 hidden sm:table-cell"><SortHeader field="name" label="Name" /></th>
                    <th className="p-3 text-right"><SortHeader field="price" label="Price" className="justify-end" /></th>
                    <th className="p-3 text-right"><SortHeader field="change" label="Change" className="justify-end" /></th>
                    {selectedScreen.metrics?.includes('pe') && (
                      <th className="p-3 text-right hidden md:table-cell"><SortHeader field="pe" label="P/E" className="justify-end" /></th>
                    )}
                    {selectedScreen.metrics?.includes('marketCap') && (
                      <th className="p-3 text-right hidden md:table-cell"><SortHeader field="marketCap" label="Market Cap" className="justify-end" /></th>
                    )}
                    {selectedScreen.metrics?.includes('dividendYield') && (
                      <th className="p-3 text-right hidden md:table-cell"><SortHeader field="dividendYield" label="Yield" className="justify-end" /></th>
                    )}
                    {selectedScreen.metrics?.includes('distanceFrom52High') && (
                      <th className="p-3 text-right hidden md:table-cell"><SortHeader field="distanceFrom52High" label="vs 52H" className="justify-end" /></th>
                    )}
                    {selectedScreen.metrics?.includes('volume') && (
                      <th className="p-3 text-right hidden lg:table-cell"><SortHeader field="volume" label="Volume" className="justify-end" /></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map((stock, i) => (
                    <tr
                      key={stock.symbol}
                      onClick={() => onSelectStock(stock.symbol)}
                      className={`cursor-pointer transition-colors hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-800/30' : ''}`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-sm">{stock.symbol.charAt(0)}</span>
                          </div>
                          <span className="font-medium text-white">{stock.symbol}</span>
                        </div>
                      </td>
                      <td className="p-3 text-gray-400 text-sm truncate max-w-[200px] hidden sm:table-cell">{stock.name}</td>
                      <td className="p-3 text-right text-white font-medium">{formatCurrency(stock.price)}</td>
                      <td className={`p-3 text-right font-medium ${stock.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                      </td>
                      {selectedScreen.metrics?.includes('pe') && (
                        <td className="p-3 text-right text-gray-300 hidden md:table-cell">{stock.pe ? stock.pe.toFixed(1) : 'N/A'}</td>
                      )}
                      {selectedScreen.metrics?.includes('marketCap') && (
                        <td className="p-3 text-right text-gray-300 hidden md:table-cell">{formatMarketCap(stock.marketCap)}</td>
                      )}
                      {selectedScreen.metrics?.includes('dividendYield') && (
                        <td className="p-3 text-right text-gray-300 hidden md:table-cell">
                          {stock.dividendYield ? `${(stock.dividendYield * 100).toFixed(2)}%` : 'N/A'}
                        </td>
                      )}
                      {selectedScreen.metrics?.includes('distanceFrom52High') && (
                        <td className={`p-3 text-right hidden md:table-cell ${stock.distanceFrom52High && stock.distanceFrom52High < 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {stock.distanceFrom52High ? `${stock.distanceFrom52High.toFixed(1)}%` : 'N/A'}
                        </td>
                      )}
                      {selectedScreen.metrics?.includes('volume') && (
                        <td className="p-3 text-right text-gray-300 hidden lg:table-cell">
                          {stock.volume ? `${(stock.volume / 1e6).toFixed(1)}M` : 'N/A'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Grid View */
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {displayResults.map(stock => (
                <button
                  key={stock.symbol}
                  onClick={() => onSelectStock(stock.symbol)}
                  className="p-4 rounded-xl bg-gray-700/30 hover:bg-gray-700/50 transition-colors text-left border border-gray-700"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center">
                        <span className="text-white font-bold">{stock.symbol.charAt(0)}</span>
                      </div>
                      <div>
                        <div className="font-medium text-white">{stock.symbol}</div>
                        <div className="text-xs text-gray-400 truncate max-w-[120px]">{stock.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-medium">{formatCurrency(stock.price)}</div>
                      <div className={`text-sm ${stock.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {/* Screen-specific metrics */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-600">
                    {selectedScreen.metrics?.map(metric => {
                      const { label, value } = getMetricDisplay(stock, metric)
                      return (
                        <div key={metric} className="text-xs">
                          <span className="text-gray-500">{label}:</span>
                          <span className={`ml-1 ${
                            metric === 'distanceFrom52High' && stock.distanceFrom52High < 0 ? 'text-red-400' :
                            metric === 'changePercent' && stock.change >= 0 ? 'text-green-400' :
                            metric === 'changePercent' && stock.change < 0 ? 'text-red-400' :
                            'text-gray-300'
                          }`}>{value}</span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}

          {displayResults.length === 0 && !loading && (
            <div className="p-8 text-center text-gray-400">
              No stocks match the current filters
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ EARNINGS TAB ============
const EARNINGS_STOCKS = [
  { symbol: 'AAPL', date: '2025-01-30', expectedEps: 2.35, prevEps: 2.18 },
  { symbol: 'MSFT', date: '2025-01-29', expectedEps: 3.12, prevEps: 2.93 },
  { symbol: 'GOOGL', date: '2025-02-04', expectedEps: 1.95, prevEps: 1.64 },
  { symbol: 'AMZN', date: '2025-02-06', expectedEps: 1.48, prevEps: 1.29 },
  { symbol: 'META', date: '2025-02-05', expectedEps: 6.75, prevEps: 5.33 },
  { symbol: 'NVDA', date: '2025-02-26', expectedEps: 0.84, prevEps: 0.78 },
  { symbol: 'TSLA', date: '2025-01-29', expectedEps: 0.72, prevEps: 0.71 },
  { symbol: 'JPM', date: '2025-01-15', expectedEps: 4.02, prevEps: 3.97 },
  { symbol: 'V', date: '2025-01-30', expectedEps: 2.68, prevEps: 2.41 },
  { symbol: 'UNH', date: '2025-01-16', expectedEps: 6.68, prevEps: 6.16 }
]

function EarningsTab({ onSelectStock, watchlist }) {
  const [earnings, setEarnings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const fetchEarnings = async () => {
      setLoading(true)
      const enriched = []

      const results = await Promise.allSettled(
        EARNINGS_STOCKS.map(e => yahooFetch(e.symbol))
      )

      results.forEach((result, i) => {
        const stock = EARNINGS_STOCKS[i]
        if (result.status === 'fulfilled' && result.value) {
          const normalized = normalizeYahooQuote(result.value)
          enriched.push({
            ...stock,
            name: normalized?.name || stock.symbol,
            price: normalized?.c,
            change: normalized?.changePercent
          })
        } else {
          enriched.push(stock)
        }
      })

      setEarnings(enriched)
      setLoading(false)
    }
    fetchEarnings()
  }, [])

  const filteredEarnings = filter === 'watchlist'
    ? earnings.filter(e => watchlist?.includes(e.symbol))
    : earnings

  const sortedEarnings = [...filteredEarnings].sort((a, b) => new Date(a.date) - new Date(b.date))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-7 h-7 text-yellow-400" />
            Earnings Calendar
          </h2>
          <p className="text-gray-400 mt-1">Upcoming earnings reports</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('watchlist')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'watchlist' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Watchlist
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedEarnings.map(stock => {
            const isThisWeek = new Date(stock.date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            return (
              <button
                key={stock.symbol}
                onClick={() => onSelectStock(stock.symbol)}
                className={`w-full rounded-xl p-4 border transition-all cursor-pointer hover:scale-[1.01] ${
                  isThisWeek
                    ? 'bg-yellow-900/20 border-yellow-500/30 hover:border-yellow-500/50'
                    : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <span className="text-white font-bold">{stock.symbol.charAt(0)}</span>
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-white">{stock.symbol}</div>
                      <div className="text-sm text-gray-400">{stock.name}</div>
                    </div>
                    {isThisWeek && (
                      <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-medium rounded">
                        This Week
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Report Date</div>
                      <div className="text-white font-medium">{new Date(stock.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Expected EPS</div>
                      <div className="text-white font-medium">${stock.expectedEps}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Previous EPS</div>
                      <div className="text-white font-medium">${stock.prevEps}</div>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ COMBINED DASHBOARD ============
function Dashboard({ watchlist, setWatchlist, onSelectStock }) {
  const [marketData, setMarketData] = useState({})
  const [watchlistQuotes, setWatchlistQuotes] = useState({})
  const [sectorData, setSectorData] = useState({})
  const [moversData, setMoversData] = useState({ gainers: [], losers: [] })
  const [loading, setLoading] = useState(true)
  const [showAddStock, setShowAddStock] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const { addToast } = useToast()
  const watchlistRef = useRef(watchlist)
  const isFetchingRef = useRef(false)

  // Keep ref in sync with prop
  useEffect(() => {
    watchlistRef.current = watchlist
  }, [watchlist])

  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']
  const sectorSymbols = SECTORS.map(s => s.symbol)
  const popularStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'JPM', 'V', 'MA', 'DIS', 'NFLX', 'PYPL', 'INTC', 'CRM']

  const fetchAllData = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setLoading(true)

    // Use ref to get current watchlist without causing dependency changes
    const currentWatchlist = watchlistRef.current || []

    // Combine all symbols to fetch (remove duplicates)
    const allSymbols = [...new Set([...indices, ...currentWatchlist, ...popularStocks, ...sectorSymbols])]

    // Fetch all at once - Yahoo has no rate limits
    const results = await Promise.allSettled(
      allSymbols.map(symbol => yahooFetch(symbol))
    )

    const allData = {}
    results.forEach((result, i) => {
      const symbol = allSymbols[i]
      if (result.status === 'fulfilled' && result.value) {
        const normalized = normalizeYahooQuote(result.value)
        if (normalized && normalized.c > 0) {
          allData[symbol] = normalized
        }
      }
    })

    // Split data into categories
    const market = {}
    indices.forEach(s => { if (allData[s]) market[s] = allData[s] })
    setMarketData(market)

    const quotes = {}
    currentWatchlist.forEach(s => { if (allData[s]) quotes[s] = allData[s] })
    setWatchlistQuotes(quotes)

    const sectors = {}
    sectorSymbols.forEach(s => { if (allData[s]) sectors[s] = allData[s] })
    setSectorData(sectors)

    // Calculate movers from popular stocks
    const stockData = popularStocks
      .filter(s => allData[s] && allData[s].c > 0)
      .map(s => ({
        symbol: s,
        price: allData[s].c,
        change: allData[s].changePercent ?? 0
      }))
      .sort((a, b) => b.change - a.change)

    setMoversData({
      gainers: stockData.slice(0, 5),
      losers: stockData.slice(-5).reverse()
    })

    setLastUpdated(new Date())
    setLoading(false)
    isFetchingRef.current = false
  }, []) // No dependencies - uses refs for watchlist

  // Initial fetch and 60-second interval
  useEffect(() => {
    fetchAllData()
    const interval = setInterval(fetchAllData, 60000)
    return () => clearInterval(interval)
  }, [fetchAllData])

  // Refetch when watchlist changes (but not on every render)
  useEffect(() => {
    if (watchlist.length > 0) {
      fetchAllData()
    }
  }, [watchlist.length]) // Only refetch when watchlist length changes

  const mood = calculateMarketMood(marketData)

  const addSymbol = async (symbol) => {
    if (watchlist.includes(symbol)) { addToast('Already in watchlist', 'error'); return }
    try {
      const data = await yahooFetch(symbol)
      const normalized = normalizeYahooQuote(data)
      if (!normalized || normalized.c === 0) { addToast('Invalid symbol', 'error'); return }
      setWatchlist([...watchlist, symbol])
      setWatchlistQuotes(prev => ({ ...prev, [symbol]: normalized }))
      addToast(`${symbol} added`, 'success')
      setShowAddStock(false)
    } catch { addToast('Failed to add', 'error') }
  }

  const removeSymbol = (symbol) => {
    setWatchlist(watchlist.filter(s => s !== symbol))
    addToast(`${symbol} removed`, 'info')
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          {lastUpdated && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
              <Clock className="w-3 h-3" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button onClick={fetchAllData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all bg-gray-700 hover:bg-gray-600 text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Market Indices Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {indices.map((symbol, idx) => {
          const data = marketData[symbol]
          const pct = data?.changePercent ?? 0
          const positive = pct >= 0
          const change = data?.change ?? 0
          const sparkData = data ? generateSparklineData(data.c, data.pc) : []
          return (
            <div key={symbol} onClick={() => onSelectStock(symbol)}
              className={`card-premium rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] relative overflow-hidden stagger-${idx + 1} animate-fade-in ${positive ? 'inner-glow-green' : 'inner-glow-red'}`}
              style={{ borderLeft: `4px solid ${positive ? '#22c55e' : '#ef4444'}` }}>
              {/* Background sparkline */}
              <div className="absolute bottom-0 left-0 right-0 h-16 opacity-20">
                <MiniSparkline data={sparkData} positive={positive} height={64} />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-semibold text-gray-300">{symbol}</span>
                  {positive ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                </div>
                {loading ? <Skeleton className="h-12 w-full" /> : (
                  <div>
                    <div className="font-mono text-2xl font-bold text-white">{formatCurrency(data?.c)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`font-mono text-sm font-semibold ${positive ? 'text-green-400' : 'text-red-400'}`}>
                        {positive ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                      <span className={`font-mono text-xs ${positive ? 'text-green-400/70' : 'text-red-400/70'}`}>
                        {positive ? '+' : ''}{formatCurrency(change)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <FearGreedIndicator value={mood} />
      </div>

      {/* Your Watchlist Section */}
      <div className="space-y-4" data-tour="watchlist">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400" />
            Your Watchlist
          </h3>
          <button onClick={() => setShowAddStock(!showAddStock)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-all">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {showAddStock && (
          <div className="max-w-md">
            <PredictiveSearch onSelect={addSymbol} inline placeholder="Search to add..." />
          </div>
        )}

        {watchlist && watchlist.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {watchlist.map((symbol, idx) => {
              const quote = watchlistQuotes[symbol]
              const pct = quote?.changePercent ?? 0
              const dollarChange = quote?.change ?? 0
              const positive = pct >= 0
              const sparkData = quote ? generateSparklineData(quote.c, quote.pc) : []
              const volRatio = quote?.volume && quote?.avgVolume ? quote.volume / quote.avgVolume : 1
              // Get short company name (first 2-3 words or before comma/Inc/Corp)
              const shortName = quote?.name
                ? quote.name.split(/,|\s+(Inc|Corp|Ltd|LLC|Company|Holdings)/i)[0].split(' ').slice(0, 3).join(' ')
                : null
              return (
                <div
                  key={symbol}
                  onClick={() => onSelectStock(symbol)}
                  className={`card-premium rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] relative overflow-hidden stagger-${Math.min(idx + 1, 8)} animate-fade-in ${positive ? 'hover-glow-positive' : 'hover-glow-negative'}`}
                  style={{
                    background: positive
                      ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(17, 24, 39, 0.95) 100%)'
                      : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(17, 24, 39, 0.95) 100%)',
                    borderLeft: `3px solid ${positive ? '#22c55e' : '#ef4444'}`
                  }}
                >
                  {/* Background sparkline */}
                  <div className="absolute bottom-0 left-0 right-0 h-12 opacity-30">
                    {sparkData.length > 0 && <MiniSparkline data={sparkData} positive={positive} height={48} />}
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="font-mono font-bold text-white">{symbol}</span>
                        {shortName && (
                          <div className="text-xs text-gray-500 truncate max-w-[120px]">{shortName}</div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSymbol(symbol); }}
                        className="p-1.5 hover:bg-red-600/20 rounded-lg text-gray-500 hover:text-red-400 z-10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {quote ? (
                      <>
                        <div className="font-mono text-xl font-bold text-white">{formatCurrency(quote.c)}</div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-sm font-semibold flex items-center gap-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>
                              {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                              {positive ? '+' : ''}{pct.toFixed(2)}%
                            </span>
                            <span className={`font-mono text-xs ${positive ? 'text-green-400/70' : 'text-red-400/70'}`}>
                              {positive ? '+' : ''}{formatCurrency(dollarChange)}
                            </span>
                          </div>
                          {/* Volume indicator */}
                          <div className="flex items-center gap-1" title={`Volume: ${volRatio.toFixed(1)}x avg`}>
                            <div className="h-1.5 w-8 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${volRatio > 1.5 ? 'bg-blue-400' : 'bg-gray-500'}`}
                                style={{ width: `${Math.min(volRatio * 50, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <Skeleton className="h-12 w-full" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="card-premium rounded-xl p-8 text-center">
            <Star className="w-10 h-10 mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">Add stocks to track them here</p>
          </div>
        )}
      </div>

      {/* Today's Movers Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Today's Movers
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top Gainers */}
          <div className="card-premium rounded-xl p-4">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Top Gainers
            </h4>
            <div className="space-y-1">
              {loading ? (
                [1,2,3,4,5].map(i => <Skeleton key={i} className="h-11 w-full" />)
              ) : moversData.gainers.map((stock, i) => (
                <button key={stock.symbol} onClick={() => onSelectStock(stock.symbol)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all hover:bg-white/5 relative overflow-hidden stagger-${i + 1} animate-fade-in`}>
                  {/* Background magnitude bar */}
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-green-500/20 to-transparent"
                    style={{ width: `${Math.min(stock.change * 5, 100)}%` }}
                  />
                  {/* Rank badge */}
                  <div className={`relative w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${i === 0 ? 'rank-badge-gold text-yellow-400' : 'rank-badge text-blue-400'}`}>
                    {i + 1}
                  </div>
                  <span className="relative font-mono font-semibold text-white text-sm">{stock.symbol}</span>
                  <span className="relative font-mono text-gray-400 text-xs">${stock.price.toFixed(2)}</span>
                  <div className="flex-1" />
                  <span className="relative font-mono text-green-400 text-sm font-semibold">+{stock.change.toFixed(2)}%</span>
                </button>
              ))}
            </div>
          </div>

          {/* Top Losers */}
          <div className="card-premium rounded-xl p-4">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Top Losers
            </h4>
            <div className="space-y-1">
              {loading ? (
                [1,2,3,4,5].map(i => <Skeleton key={i} className="h-11 w-full" />)
              ) : moversData.losers.map((stock, i) => (
                <button key={stock.symbol} onClick={() => onSelectStock(stock.symbol)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all hover:bg-white/5 relative overflow-hidden stagger-${i + 1} animate-fade-in`}>
                  {/* Background magnitude bar */}
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-red-500/20 to-transparent"
                    style={{ width: `${Math.min(Math.abs(stock.change) * 5, 100)}%` }}
                  />
                  {/* Rank badge */}
                  <div className="relative w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold rank-badge text-blue-400">
                    {i + 1}
                  </div>
                  <span className="relative font-mono font-semibold text-white text-sm">{stock.symbol}</span>
                  <span className="relative font-mono text-gray-400 text-xs">${stock.price.toFixed(2)}</span>
                  <div className="flex-1" />
                  <span className="relative font-mono text-red-400 text-sm font-semibold">{stock.change.toFixed(2)}%</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sector Performance */}
      <SectorPerformance onSelectStock={onSelectStock} sectorData={sectorData} loading={loading} />
    </div>
  )
}

// ============ MARKET OVERVIEW (LEGACY - KEPT FOR REFERENCE) ============
function MarketOverview({ onSelectStock }) {
  const [marketData, setMarketData] = useState({})
  const [trendingData, setTrendingData] = useState({})
  const [loading, setLoading] = useState(true)
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']
  const trending = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN', 'AMD']

  const fetchData = useCallback(async () => {
    setLoading(true)
    const market = {}, trend = {}
    // Yahoo has no rate limits - fetch all in parallel
    const allSymbols = [...indices, ...trending]
    const results = await Promise.allSettled(
      allSymbols.map(symbol => yahooFetch(symbol))
    )
    results.forEach((result, i) => {
      const symbol = allSymbols[i]
      if (result.status === 'fulfilled' && result.value) {
        const normalized = normalizeYahooQuote(result.value)
        if (normalized && normalized.c > 0) {
          if (indices.includes(symbol)) market[symbol] = normalized
          else trend[symbol] = normalized
        }
      }
    })
    setMarketData(market)
    setTrendingData(trend)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 60000); return () => clearInterval(interval) }, [fetchData])

  const mood = calculateMarketMood({ ...marketData, ...trendingData })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Market Overview</h2>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all bg-gray-700 hover:bg-gray-600 text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
          {indices.map(symbol => {
            const data = marketData[symbol]
            const pct = data?.changePercent ?? 0
            const positive = pct >= 0
            const sparkData = data ? generateSparklineData(data.c, data.pc) : []
            return (
              <div key={symbol} onClick={() => onSelectStock(symbol)}
                className="rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.02] bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 hover:border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-300">{symbol}</span>
                  {positive ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                </div>
                {loading ? <Skeleton className="h-8 w-24" /> : (
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xl font-bold text-white">{formatCurrency(data?.c)}</div>
                      <div className={`text-sm font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>{positive ? '+' : ''}{pct.toFixed(2)}%</div>
                    </div>
                    <MiniSparkline data={sparkData} positive={positive} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <FearGreedIndicator value={mood} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4 text-white">Trending Stocks</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {trending.map(symbol => {
              const data = trendingData[symbol]
              const change = data?.changePercent ?? 0
              return (
                <HeatMapCell key={symbol} value={change} label={symbol} onClick={() => onSelectStock(symbol)} />
              )
            })}
          </div>
        </div>
        <div className="space-y-4">
          <EarningsCalendar onSelect={onSelectStock} />
        </div>
      </div>
    </div>
  )
}

// ============ STOCK CHART COMPONENT ============
// Calculate Simple Moving Average
function calculateSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close
      }
      result.push(sum / period)
    }
  }
  return result
}

function StockChart({ symbol, range = '1mo', interval = '1d', onRangeData }) {
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)

  // Determine if we should show SMAs based on range
  const showSMA50 = ['3mo', '6mo', '1y', '5y'].includes(range)
  const showSMA200 = ['1y', '5y'].includes(range)

  useEffect(() => {
    const fetchChart = async () => {
      setLoading(true)
      try {
        const data = await yahooFetch(symbol, 'chart', { range, interval })
        console.log('Chart API response for', symbol, ':', data)

        let formatted = []

        // Format 1: Proxy pre-formatted response { data: [{time, open, high, low, close, volume}] }
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          console.log('Using proxy format, data points:', data.data.length)
          formatted = data.data.map(d => ({
            time: d.time * 1000,
            date: new Date(d.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
          })).filter(d => d.close !== null && d.close !== undefined)
        }
        // Format 2: Raw Yahoo format { chart: { result: [{ timestamp, indicators }] } }
        else if (data && data.chart && data.chart.result && data.chart.result[0]) {
          console.log('Using raw Yahoo format')
          const result = data.chart.result[0]
          const timestamps = result.timestamp || []
          const quotes = result.indicators?.quote?.[0] || {}

          formatted = timestamps.map((t, i) => ({
            time: t * 1000,
            date: new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            open: quotes.open?.[i],
            high: quotes.high?.[i],
            low: quotes.low?.[i],
            close: quotes.close?.[i],
            volume: quotes.volume?.[i]
          })).filter(d => d.close !== null && d.close !== undefined)
        }
        // Format 3: Direct array response
        else if (Array.isArray(data) && data.length > 0) {
          console.log('Using direct array format')
          formatted = data.map(d => ({
            time: (d.time || d.timestamp || d.date) * 1000,
            date: new Date((d.time || d.timestamp || d.date) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
          })).filter(d => d.close !== null && d.close !== undefined)
        }

        // Calculate SMAs if we have enough data
        if (formatted.length > 0) {
          const sma50 = calculateSMA(formatted, 50)
          const sma200 = calculateSMA(formatted, 200)
          formatted = formatted.map((d, i) => ({
            ...d,
            sma50: sma50[i],
            sma200: sma200[i]
          }))
        }

        console.log('Formatted chart data points:', formatted.length)
        setChartData(formatted)

        // Calculate and report range data for price change display
        if (onRangeData && formatted.length >= 2) {
          const firstPrice = formatted[0].close
          const lastPrice = formatted[formatted.length - 1].close
          const changeForRange = lastPrice - firstPrice
          const changePercentForRange = ((lastPrice - firstPrice) / firstPrice) * 100
          onRangeData({ change: changeForRange, changePercent: changePercentForRange })
        }
      } catch (err) {
        console.error('Chart fetch error:', err)
        setChartData([])
      }
      setLoading(false)
    }
    fetchChart()
  }, [symbol, range, interval, onRangeData])

  if (loading) {
    return <div className="h-64 bg-gray-700/30 rounded-xl animate-pulse" />
  }

  if (chartData.length === 0) {
    return (
      <div className="h-64 bg-gray-700/30 rounded-xl flex items-center justify-center text-gray-400">
        No chart data available
      </div>
    )
  }

  const firstPrice = chartData[0]?.close || 0
  const lastPrice = chartData[chartData.length - 1]?.close || 0
  const isPositive = lastPrice >= firstPrice
  const chartColor = isPositive ? '#22c55e' : '#ef4444'

  const minPrice = Math.min(...chartData.map(d => d.low || d.close).filter(Boolean))
  const maxPrice = Math.max(...chartData.map(d => d.high || d.close).filter(Boolean))
  const maxVolume = Math.max(...chartData.map(d => d.volume || 0))

  // Check if we have valid SMA data to show
  const hasSMA50Data = showSMA50 && chartData.some(d => d.sma50 !== null)
  const hasSMA200Data = showSMA200 && chartData.some(d => d.sma200 !== null)

  return (
    <div className="space-y-2">
      {/* Price Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id={`chartGradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minPrice * 0.99, maxPrice * 1.01]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              width={50}
            />
            <RechartsTooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value, name) => {
                if (name === 'sma50') return [`$${value?.toFixed(2)}`, '50 SMA']
                if (name === 'sma200') return [`$${value?.toFixed(2)}`, '200 SMA']
                return [`$${value?.toFixed(2)}`, 'Price']
              }}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#chartGradient-${symbol})`}
            />
            {hasSMA50Data && (
              <Line
                type="monotone"
                dataKey="sma50"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                connectNulls
              />
            )}
            {hasSMA200Data && (
              <Line
                type="monotone"
                dataKey="sma200"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="6 3"
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* SMA Legend */}
      {(hasSMA50Data || hasSMA200Data) && (
        <div className="flex items-center justify-center gap-4 text-xs">
          {hasSMA50Data && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-amber-500" style={{ borderTop: '2px dashed #f59e0b' }} />
              <span className="text-gray-400">50 SMA</span>
            </div>
          )}
          {hasSMA200Data && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-violet-500" style={{ borderTop: '2px dashed #8b5cf6' }} />
              <span className="text-gray-400">200 SMA</span>
            </div>
          )}
        </div>
      )}

      {/* Volume Chart */}
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 5, left: 5, bottom: 0 }}>
            <Bar
              dataKey="volume"
              fill="#6b7280"
              opacity={0.5}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ============ INSIDER ACTIVITY COMPONENT ============
// Classify transaction codes - handles various formats like "S", "S-Sale", "Sale", etc.
const classifyTransaction = (code) => {
  if (!code) return 'other'
  const c = code.toUpperCase()
  if (c.startsWith('P') || c.includes('PURCHASE')) return 'buy'
  if (c.startsWith('S') || c.includes('SALE')) return 'sell'
  if (c.startsWith('M') || c.includes('EXERCISE') || c.includes('EXEMPT')) return 'exercise'
  if (c.startsWith('F') || c.includes('TAX')) return 'tax'
  if (c.startsWith('G') || c.includes('GIFT')) return 'gift'
  return 'other'
}

const getTransactionDisplay = (code) => {
  const type = classifyTransaction(code)
  switch (type) {
    case 'buy': return { label: 'Buy', color: 'text-green-400', bg: 'bg-green-500/20' }
    case 'sell': return { label: 'Sell', color: 'text-red-400', bg: 'bg-red-500/20' }
    case 'exercise': return { label: 'Exercise', color: 'text-blue-400', bg: 'bg-blue-500/20' }
    case 'tax': return { label: 'Tax', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
    case 'gift': return { label: 'Gift', color: 'text-purple-400', bg: 'bg-purple-500/20' }
    default: return { label: 'Other', color: 'text-gray-400', bg: 'bg-gray-500/20' }
  }
}

function InsiderActivity({ symbol }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetchInsider = async () => {
      setLoading(true)
      try {
        const response = await fetch(`https://stock-api-proxy-seven.vercel.app/api/finnhub?endpoint=stock/insider-transactions&symbol=${symbol}`)
        if (response.ok) {
          const result = await response.json()
          console.log('Insider data:', result.data?.slice(0, 3))
          setData(result.data || [])
        } else {
          setData([])
        }
      } catch (err) {
        console.error('Insider data error:', err)
        setData([])
      }
      setLoading(false)
    }
    fetchInsider()
  }, [symbol])

  if (loading) {
    return (
      <div className="rounded-xl bg-gray-700/30 p-4">
        <div className="h-6 w-32 animate-shimmer rounded mb-2" />
        <div className="h-4 w-48 animate-shimmer rounded" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return null
  }

  // Filter last 90 days
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const recentData = data.filter(t => new Date(t.transactionDate) >= ninetyDaysAgo)

  // Use the same classification function for summary counts
  const buys = recentData.filter(t => classifyTransaction(t.transactionCode) === 'buy').length
  const sells = recentData.filter(t => classifyTransaction(t.transactionCode) === 'sell').length

  return (
    <div className="rounded-xl bg-gray-700/30 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-medium text-gray-400">Insider Activity</h3>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div className="mt-2 text-sm text-gray-300">
        {buys} buy{buys !== 1 ? 's' : ''}, {sells} sell{sells !== 1 ? 's' : ''} in last 90 days
      </div>

      {expanded && (
        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
          {data.slice(0, 10).map((t, i) => {
            const type = getTransactionDisplay(t.transactionCode)
            return (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-gray-800/50">
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">{t.name}</div>
                  <div className="text-gray-500">{new Date(t.transactionDate).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded ${type.bg} ${type.color}`}>{type.label}</span>
                  <div className="text-right">
                    <div className="text-white">{Math.abs(t.change || 0).toLocaleString()} shares</div>
                    {t.transactionPrice > 0 && (
                      <div className="text-gray-400">${t.transactionPrice.toFixed(2)}</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ RELATIVE STRENGTH VS SPY ============
function RelativeStrength({ symbol, range, interval }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchComparison = async () => {
      if (symbol === 'SPY') {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        // Fetch both stock and SPY data in parallel
        const [stockData, spyData] = await Promise.all([
          yahooFetch(symbol, 'chart', { range, interval }),
          yahooFetch('SPY', 'chart', { range, interval })
        ])

        // Parse chart data
        const parseChart = (data) => {
          if (data && Array.isArray(data.data) && data.data.length > 0) {
            return data.data.filter(d => d.close !== null)
          } else if (data?.chart?.result?.[0]) {
            const result = data.chart.result[0]
            const timestamps = result.timestamp || []
            const quotes = result.indicators?.quote?.[0] || {}
            return timestamps.map((t, i) => ({
              time: t,
              close: quotes.close?.[i]
            })).filter(d => d.close !== null)
          }
          return []
        }

        const stockChart = parseChart(stockData)
        const spyChart = parseChart(spyData)

        if (stockChart.length >= 2 && spyChart.length >= 2) {
          const stockStart = stockChart[0].close
          const stockEnd = stockChart[stockChart.length - 1].close
          const stockChange = ((stockEnd - stockStart) / stockStart) * 100

          const spyStart = spyChart[0].close
          const spyEnd = spyChart[spyChart.length - 1].close
          const spyChange = ((spyEnd - spyStart) / spyStart) * 100

          const relativeStrength = stockChange - spyChange

          setData({
            stockChange,
            spyChange,
            relativeStrength
          })
        }
      } catch (err) {
        console.error('Relative strength error:', err)
      }
      setLoading(false)
    }
    fetchComparison()
  }, [symbol, range, interval])

  if (symbol === 'SPY' || loading || !data) {
    return null
  }

  const outperforming = data.relativeStrength > 0

  return (
    <div className="rounded-xl bg-gray-700/30 p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-3">Relative Strength vs SPY</h3>
      <div className="flex items-center gap-4">
        {/* Stock performance */}
        <div className="flex-1">
          <div className="text-xs text-gray-500 mb-1">{symbol}</div>
          <div className={`font-mono text-lg font-semibold ${data.stockChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.stockChange >= 0 ? '+' : ''}{data.stockChange.toFixed(2)}%
          </div>
        </div>
        {/* VS indicator */}
        <div className="text-gray-600 text-xs">vs</div>
        {/* SPY performance */}
        <div className="flex-1">
          <div className="text-xs text-gray-500 mb-1">SPY</div>
          <div className={`font-mono text-lg font-semibold ${data.spyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.spyChange >= 0 ? '+' : ''}{data.spyChange.toFixed(2)}%
          </div>
        </div>
        {/* Relative strength */}
        <div className={`px-3 py-2 rounded-lg ${outperforming ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
          <div className="text-xs text-gray-400 mb-0.5">Relative</div>
          <div className={`font-mono font-bold ${outperforming ? 'text-green-400' : 'text-red-400'}`}>
            {outperforming ? '+' : ''}{data.relativeStrength.toFixed(2)}%
          </div>
        </div>
      </div>
      {/* Visual bar */}
      <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-px h-full bg-gray-600" />
        </div>
        <div
          className={`absolute top-0 h-full rounded-full transition-all ${outperforming ? 'bg-green-500' : 'bg-red-500'}`}
          style={{
            width: `${Math.min(Math.abs(data.relativeStrength) * 2, 50)}%`,
            left: outperforming ? '50%' : 'auto',
            right: outperforming ? 'auto' : '50%'
          }}
        />
      </div>
      <div className="mt-1 text-xs text-center text-gray-500">
        {outperforming ? 'Outperforming' : 'Underperforming'} the market
      </div>
    </div>
  )
}

// ============ STOCK DETAIL MODAL ============
function StockDetail({ symbol, onClose }) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNews, setShowNews] = useState(false)
  const [chartRange, setChartRange] = useState('1d')
  const [rangeChange, setRangeChange] = useState(null)

  const rangeOptions = [
    { value: '1d', label: '1D', interval: '5m', displayLabel: 'today' },
    { value: '5d', label: '1W', interval: '15m', displayLabel: 'past week' },
    { value: '1mo', label: '1M', interval: '1d', displayLabel: 'past month' },
    { value: '3mo', label: '3M', interval: '1d', displayLabel: 'past 3 months' },
    { value: '6mo', label: '6M', interval: '1d', displayLabel: 'past 6 months' },
    { value: '1y', label: '1Y', interval: '1d', displayLabel: 'past year' },
    { value: '5y', label: '5Y', interval: '1wk', displayLabel: 'past 5 years' }
  ]

  const currentRangeOption = rangeOptions.find(r => r.value === chartRange) || rangeOptions[2]

  // Reset rangeChange when chartRange changes
  useEffect(() => {
    setRangeChange(null)
  }, [chartRange])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const data = await yahooFetch(symbol)
        if (data) {
          setQuote(normalizeYahooQuote(data))
        }
      } catch (err) {
        console.error('Quote fetch error:', err)
      }
      setLoading(false)
    }
    fetchData()
  }, [symbol])

  // Use range change for non-1d ranges, quote change for 1d
  const displayChange = chartRange !== '1d' && rangeChange ? rangeChange.change : (quote?.change || 0)
  const displayPctChange = chartRange !== '1d' && rangeChange ? rangeChange.changePercent : (quote?.changePercent || 0)
  const positive = displayChange >= 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 z-50" onClick={onClose}>
      <div
        className="bg-gray-800/95 backdrop-blur w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden border-t sm:border border-gray-700 shadow-2xl transform transition-transform"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - sticky on mobile with gradient tint */}
        <div className={`sticky top-0 z-10 backdrop-blur p-4 border-b border-gray-700 flex items-center justify-between ${positive ? 'bg-gradient-to-r from-green-900/20 to-gray-800/95' : 'bg-gradient-to-r from-red-900/20 to-gray-800/95'}`}>
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-base sm:text-lg">{symbol.charAt(0)}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white">{symbol}</h2>
                {quote?.marketState && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    quote.marketState === 'REGULAR'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {quote.marketState === 'REGULAR' ? 'Open' : quote.marketState === 'PRE' ? 'Pre-Market' : quote.marketState === 'POST' ? 'After Hours' : 'Closed'}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 truncate">{loading ? 'Loading...' : (quote?.name || symbol)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              onClick={() => setShowNews(true)}
              aria-label="View news"
              className="p-2 sm:p-2.5 rounded-lg hover:bg-gray-700 active:bg-gray-600 transition-colors"
            >
              <Newspaper className="w-5 h-5 text-gray-400" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 sm:p-2.5 rounded-lg hover:bg-gray-700 active:bg-gray-600 transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-blue-500 animate-spin" /></div>
        ) : (
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto max-h-[calc(95vh-80px)] sm:max-h-[calc(90vh-80px)]">
            {/* Price Header */}
            <div className="flex items-baseline gap-2 sm:gap-4 flex-wrap">
              <span className="text-3xl sm:text-4xl font-bold text-white">{formatCurrency(quote?.c)}</span>
              <span className={`text-base sm:text-lg font-medium px-2.5 sm:px-3 py-1 rounded-full ${positive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {positive ? '+' : ''}{displayPctChange?.toFixed(2)}% <span className="text-xs opacity-75">{currentRangeOption.displayLabel}</span>
              </span>
              <span className={`text-sm ${positive ? 'text-green-400' : 'text-red-400'}`}>
                {positive ? '+' : ''}{formatCurrency(displayChange)}
              </span>
            </div>

            {/* Chart with Range Selector */}
            <div className="rounded-xl bg-gray-700/30 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-400">Price Chart</h3>
                <div className="flex gap-1">
                  {rangeOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => setChartRange(option.value)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                        chartRange === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <StockChart symbol={symbol} range={chartRange} interval={currentRangeOption.interval} onRangeData={setRangeChange} />
            </div>

            {/* Key Metrics - only show metrics with valid data */}
            {(() => {
              const metrics = [
                { label: 'Open', value: quote?.o, format: v => formatCurrency(v) },
                { label: 'High', value: quote?.h, format: v => formatCurrency(v) },
                { label: 'Low', value: quote?.l, format: v => formatCurrency(v) },
                { label: 'Prev Close', value: quote?.pc, format: v => formatCurrency(v) },
                { label: 'Volume', value: quote?.volume, format: v => formatVolume(v) },
                { label: 'Avg Volume', value: quote?.avgVolume, format: v => formatVolume(v) },
                { label: '52W Range', value: quote?.weekLow52 && quote?.weekHigh52 ? [quote.weekLow52, quote.weekHigh52] : null, format: v => `${formatCurrency(v[0])} - ${formatCurrency(v[1])}` },
                { label: 'P/E Ratio', value: quote?.peRatio, format: v => v.toFixed(2) },
                { label: 'Market Cap', value: quote?.marketCap, format: v => formatLargeNumber(v) }
              ].filter(m => m.value && (typeof m.value !== 'number' || m.value > 0))

              return metrics.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {metrics.map(m => (
                    <div key={m.label} className="rounded-lg p-4 bg-gray-700/30">
                      <div className="text-sm text-gray-400">{m.label}</div>
                      <div className="font-medium text-white">{m.format(m.value)}</div>
                    </div>
                  ))}
                </div>
              ) : null
            })()}

            {/* Relative Strength vs SPY */}
            <RelativeStrength symbol={symbol} range={chartRange} interval={currentRangeOption.interval} />

            {/* Insider Activity */}
            <InsiderActivity symbol={symbol} />
          </div>
        )}
      </div>
      {showNews && <StockNewsModal symbol={symbol} onClose={() => setShowNews(false)} />}
    </div>
  )
}

// ============ WATCHLIST ============
function Watchlist({ watchlist, setWatchlist, onSelectStock }) {
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const { addToast } = useToast()

  const fetchQuotes = useCallback(async () => {
    if (!watchlist || watchlist.length === 0) return
    setLoading(true)
    const newQuotes = {}
    // Yahoo has no rate limits - fetch all in parallel
    const results = await Promise.allSettled(
      watchlist.map(symbol => yahooFetch(symbol))
    )
    results.forEach((result, i) => {
      const symbol = watchlist[i]
      if (result.status === 'fulfilled' && result.value) {
        const normalized = normalizeYahooQuote(result.value)
        if (normalized && normalized.c > 0) {
          newQuotes[symbol] = normalized
        }
      }
    })
    setQuotes(newQuotes)
    setLoading(false)
  }, [watchlist])

  useEffect(() => { fetchQuotes(); const interval = setInterval(fetchQuotes, 60000); return () => clearInterval(interval) }, [fetchQuotes])

  const addSymbol = async (symbol) => {
    if (watchlist.includes(symbol)) { addToast('Already in watchlist', 'error'); return }
    try {
      const data = await yahooFetch(symbol)
      const normalized = normalizeYahooQuote(data)
      if (!normalized || normalized.c === 0) { addToast('Invalid symbol', 'error'); return }
      const newWatchlist = [...watchlist, symbol]
      setWatchlist(newWatchlist)
      setQuotes(prev => ({ ...prev, [symbol]: normalized }))
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
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold text-white">Watchlist</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(!showSearch)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-all">
            <Plus className="w-4 h-4" /> Add Stock
          </button>
          <button onClick={fetchQuotes} disabled={loading} className="p-2 rounded-lg transition-all bg-gray-700 hover:bg-gray-600">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''} text-gray-300`} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="max-w-md">
          <PredictiveSearch onSelect={addSymbol} inline placeholder="Search to add..." />
        </div>
      )}

      <WatchlistInsights watchlist={watchlist} quotes={quotes} />

      {watchlist && watchlist.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {watchlist.map(symbol => {
            const quote = quotes[symbol]
            const pct = quote?.changePercent ?? 0
            const positive = pct >= 0
            const sparkData = quote ? generateSparklineData(quote.c, quote.pc) : []
            return (
              <div key={symbol} className="rounded-xl p-4 border transition-all hover:scale-[1.02] bg-gray-800/50 border-gray-700 hover:border-gray-600">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => onSelectStock(symbol)} className="text-lg font-bold hover:text-blue-400 text-white">{symbol}</button>
                  <button onClick={() => removeSymbol(symbol)} className="p-1 hover:bg-red-600/20 rounded text-gray-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {quote ? (
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-bold text-white">{formatCurrency(quote.c)}</div>
                      <div className={`text-sm font-medium flex items-center gap-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>
                        {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {positive ? '+' : ''}{pct.toFixed(2)}%
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
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Star className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">Watchlist is empty</h3>
          <p className="text-gray-400">Add stocks to track them here</p>
        </div>
      )}
    </div>
  )
}

// ============ MARKET MOVERS (SIMPLIFIED EXPLORE) ============
function MarketMovers({ onSelectStock }) {
  const [gainers, setGainers] = useState([])
  const [losers, setLosers] = useState([])
  const [loading, setLoading] = useState(true)

  const popularStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'JPM', 'V', 'MA', 'DIS', 'NFLX', 'PYPL', 'INTC', 'CRM']

  const fetchData = useCallback(async () => {
    setLoading(true)
    const stockData = []
    // Yahoo has no rate limits - fetch all in parallel
    const results = await Promise.allSettled(
      popularStocks.map(symbol => yahooFetch(symbol))
    )
    results.forEach((result, i) => {
      const symbol = popularStocks[i]
      if (result.status === 'fulfilled' && result.value) {
        const normalized = normalizeYahooQuote(result.value)
        if (normalized && normalized.c > 0) {
          stockData.push({ symbol, price: normalized.c, change: normalized.changePercent || 0 })
        }
      }
    })
    const sorted = stockData.sort((a, b) => b.change - a.change)
    setGainers(sorted.slice(0, 5))
    setLosers(sorted.slice(-5).reverse())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const StockList = ({ title, stocks, isGainers }) => (
    <div className="rounded-xl p-4 border bg-gray-800/50 border-gray-700">
      <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
        {isGainers ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
        {title}
      </h3>
      <div className="space-y-2">
        {loading ? (
          [1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)
        ) : stocks.map((stock, i) => (
          <button key={stock.symbol} onClick={() => onSelectStock(stock.symbol)}
            className="w-full flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-gray-700/50">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm w-4">{i + 1}</span>
              <span className="font-medium text-white">{stock.symbol}</span>
            </div>
            <div className="text-right">
              <div className="text-white">{formatCurrency(stock.price)}</div>
              <div className={isGainers ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
                {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Market Movers</h2>
          <p className="text-gray-400">Today's top gainers and losers</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all bg-gray-700 hover:bg-gray-600 text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StockList title="Top Gainers" stocks={gainers} isGainers={true} />
        <StockList title="Top Losers" stocks={losers} isGainers={false} />
      </div>
    </div>
  )
}

// ============ TIME AGO HELPER ============
const formatTimeAgo = (timestamp) => {
  const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

// ============ CONVERT PROXY RESPONSE TO ARRAY ============
const parseNewsResponse = (data) => {
  // If it's already an array, return it
  if (Array.isArray(data)) {
    return data
  }

  // If it's an object with numeric keys (proxy format), convert to array
  if (data && typeof data === 'object') {
    // Filter out non-news properties like "_cached"
    const articles = Object.entries(data)
      .filter(([key, value]) => {
        // Only include numeric keys that have valid article objects
        return !isNaN(parseInt(key)) &&
               value &&
               typeof value === 'object' &&
               value.headline
      })
      .map(([, value]) => value)

    return articles
  }

  return []
}

// ============ NEWS CACHE ============
const newsCache = {
  data: {},
  timestamps: {},
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes

  get(key) {
    const cached = this.data[key]
    const timestamp = this.timestamps[key]
    if (cached && timestamp && (Date.now() - timestamp < this.CACHE_DURATION)) {
      return { articles: cached, age: Date.now() - timestamp }
    }
    return null
  },

  set(key, articles) {
    this.data[key] = articles
    this.timestamps[key] = Date.now()
  },

  getAge(key) {
    const timestamp = this.timestamps[key]
    return timestamp ? Date.now() - timestamp : null
  }
}

// ============ NEWS PAGE - STOCK-SPECIFIC NEWS ============
function NewsPage({ watchlist }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tab, setTab] = useState('movers')
  const [cacheAge, setCacheAge] = useState(null)
  const [loadedStocks, setLoadedStocks] = useState([])
  const [hasMore, setHasMore] = useState(true)
  const [moversStocks, setMoversStocks] = useState([])

  // Popular stocks for movers (will be sorted by actual price change)
  const POPULAR_FOR_MOVERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META', 'AMD', 'JPM', 'V']
  const MAX_WATCHLIST_STOCKS = 5

  const tabs = [
    { id: 'movers', label: 'Market Movers', icon: TrendingUp },
    { id: 'feed', label: 'Your Watchlist', icon: Star }
  ]

  // Helper: delay between requests
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  // Fetch company news for a single symbol with caching
  const fetchSingleStockNews = useCallback(async (symbol) => {
    const cacheKey = `news_${symbol}`
    const cached = newsCache.get(cacheKey)
    if (cached) {
      return { articles: cached.articles, fromCache: true }
    }

    const today = new Date()
    const weekAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
    const to = today.toISOString().split('T')[0]
    const from = weekAgo.toISOString().split('T')[0]

    try {
      const data = await finnhubFetch(`/company-news?symbol=${symbol}&from=${from}&to=${to}`)
      const articles = parseNewsResponse(data).slice(0, 4).map(a => ({ ...a, ticker: symbol }))
      newsCache.set(cacheKey, articles)
      return { articles, fromCache: false }
    } catch (err) {
      console.log(`Failed to fetch news for ${symbol}:`, err)
      return { articles: [], fromCache: false }
    }
  }, [])

  // Fetch news for multiple symbols with delays
  const fetchMultipleStockNews = useCallback(async (symbols, existingNews = []) => {
    const allArticles = [...existingNews]
    let anyFromCache = existingNews.length > 0

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i]
      const result = await fetchSingleStockNews(symbol)
      allArticles.push(...result.articles)
      if (result.fromCache) anyFromCache = true

      // Add delay between non-cached requests to prevent rate limiting
      if (!result.fromCache && i < symbols.length - 1) {
        await delay(150)
      }
    }

    // Deduplicate and sort
    const seen = new Set()
    const unique = allArticles
      .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      .filter(article => {
        if (seen.has(article.headline)) return false
        seen.add(article.headline)
        return true
      })

    return { articles: unique, fromCache: anyFromCache }
  }, [fetchSingleStockNews])

  // Fetch actual top movers first
  const fetchTopMovers = useCallback(async () => {
    const results = await Promise.allSettled(
      POPULAR_FOR_MOVERS.map(s => yahooFetch(s))
    )
    const stockData = []
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        const normalized = normalizeYahooQuote(result.value)
        if (normalized && normalized.c > 0) {
          const absChange = Math.abs(normalized.changePercent || 0)
          stockData.push({ symbol: POPULAR_FOR_MOVERS[i], change: absChange })
        }
      }
    })
    // Sort by absolute change to get biggest movers
    return stockData.sort((a, b) => b.change - a.change).slice(0, 5).map(s => s.symbol)
  }, [])

  // Initial fetch
  const fetchNews = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setHasMore(false)

    // Clear cache on force refresh
    if (forceRefresh) {
      newsCache.data = {}
      newsCache.timestamps = {}
    }

    let stocksToFetch = []

    if (tab === 'movers') {
      // Fetch actual top movers first
      const topMovers = await fetchTopMovers()
      setMoversStocks(topMovers)
      stocksToFetch = topMovers.slice(0, 3)
      setHasMore(topMovers.length > 3)
    } else if (tab === 'feed') {
      // Watchlist stocks only
      stocksToFetch = (watchlist || []).slice(0, MAX_WATCHLIST_STOCKS)
    }

    setLoadedStocks(stocksToFetch)

    if (stocksToFetch.length === 0) {
      setNews([])
      setLoading(false)
      return
    }

    const result = await fetchMultipleStockNews(stocksToFetch)
    setNews(result.articles)

    // Set cache age indicator
    const firstStockCache = newsCache.getAge(`news_${stocksToFetch[0]}`)
    setCacheAge(firstStockCache)

    setLoading(false)
  }, [tab, watchlist, fetchMultipleStockNews, fetchTopMovers])

  // Load more news
  const loadMoreNews = useCallback(async () => {
    if (loadingMore || !hasMore || tab !== 'movers') return

    setLoadingMore(true)

    const additionalStocks = moversStocks.filter(s => !loadedStocks.includes(s)).slice(0, 2)

    if (additionalStocks.length === 0) {
      setHasMore(false)
      setLoadingMore(false)
      return
    }

    const result = await fetchMultipleStockNews(additionalStocks, news)
    setNews(result.articles)
    setLoadedStocks([...loadedStocks, ...additionalStocks])

    // Check if more stocks available
    const allLoaded = [...loadedStocks, ...additionalStocks]
    const remaining = moversStocks.filter(s => !allLoaded.includes(s))
    setHasMore(remaining.length > 0)

    setLoadingMore(false)
  }, [loadingMore, hasMore, loadedStocks, news, fetchMultipleStockNews, moversStocks, tab])

  // Fetch on tab change
  useEffect(() => {
    fetchNews()
  }, [tab])

  // Format cache age
  const formatCacheAge = (ms) => {
    if (!ms) return null
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'Just updated'
    if (minutes === 1) return 'Updated 1 min ago'
    return `Updated ${minutes} min ago`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Stock News</h2>
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-400">Latest market news</p>
            {cacheAge && !loading && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                • {formatCacheAge(cacheAge)}
              </span>
            )}
          </div>
        </div>
        <button onClick={() => fetchNews(true)} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl transition-colors bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl whitespace-nowrap transition-all font-medium ${
              tab === t.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Watchlist info message */}
      {tab === 'watchlist' && watchlist && watchlist.length > MAX_WATCHLIST_STOCKS && !loading && (
        <div className="text-sm text-gray-400 bg-gray-800/50 rounded-lg px-4 py-2 border border-gray-700">
          Showing news for your top {MAX_WATCHLIST_STOCKS} watchlist stocks: {watchlist.slice(0, MAX_WATCHLIST_STOCKS).join(', ')}
        </div>
      )}

      {/* Watchlist empty state */}
      {tab === 'watchlist' && (!watchlist || watchlist.length === 0) && !loading && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Star className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">Add stocks to your watchlist</h3>
          <p className="text-gray-400">News from your watchlist stocks will appear here</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-xl animate-pulse bg-gray-800" />
          ))}
        </div>
      )}

      {/* Empty watchlist prompt for Your Feed */}
      {!loading && tab === 'feed' && (!watchlist || watchlist.length === 0) && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Star className="w-12 h-12 mx-auto mb-4 text-yellow-400/50" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">No watchlist stocks</h3>
          <p className="text-gray-400">Add stocks to your watchlist on the Dashboard to see personalized news here</p>
        </div>
      )}

      {/* No news state */}
      {!loading && news.length === 0 && tab !== 'feed' && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Newspaper className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">No news found</h3>
          <p className="text-gray-400">Try refreshing or check back later</p>
        </div>
      )}

      {/* No news state for feed with watchlist */}
      {!loading && news.length === 0 && tab === 'feed' && watchlist && watchlist.length > 0 && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Newspaper className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">No recent news</h3>
          <p className="text-gray-400">No news found for your watchlist stocks</p>
        </div>
      )}

      {/* News articles */}
      {!loading && news.length > 0 && (
        <div className="space-y-3">
          {news.map((article, i) => {
            const summary = article.summary || ''
            return (
              <a key={`${article.ticker}-${i}`} href={article.url} target="_blank" rel="noopener noreferrer"
                className="block rounded-xl border transition-all hover:scale-[1.002] bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800 overflow-hidden group">
                <div className="flex gap-4 p-4">
                  {/* Stock Badge */}
                  {article.ticker && (
                    <div className="flex-shrink-0">
                      <span className="inline-block px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg">
                        {article.ticker}
                      </span>
                    </div>
                  )}
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium line-clamp-2 text-white group-hover:text-blue-400 transition-colors mb-1">
                      {article.headline}
                    </h3>
                    {summary && (
                      <p className="text-sm text-gray-400 line-clamp-2 mb-2">
                        {summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="text-gray-300">{article.source}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(article.datetime)}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            )
          })}

          {/* Load More button */}
          {hasMore && tab !== 'watchlist' && (
            <button
              onClick={loadMoreNews}
              disabled={loadingMore}
              className="w-full py-3 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300 font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading more...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Load more news
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============ SETTINGS PAGE ============
function SettingsPage({ syncStatus, onShowTour }) {
  const { user, signIn, signOut: handleSignOut } = useAuth()

  const handleClear = () => {
    if (window.confirm('Clear all local data? Cloud data will remain.')) {
      localStorage.clear()
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <p className="text-sm text-gray-400">Manage your account and preferences</p>
      </div>

      <div className="rounded-xl border p-6 bg-gray-800 border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium text-white">Account</h3>
        </div>
        {user ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName} className="w-12 h-12 rounded-full border-2 border-blue-500" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center">
                  <User className="w-6 h-6 text-gray-400" />
                </div>
              )}
              <div>
                <div className="font-medium text-white">{user.displayName}</div>
                <div className="text-sm text-gray-400">{user.email}</div>
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
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-600 hover:bg-gray-700 rounded-xl text-white transition-colors">
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Cloud className="w-5 h-5 text-blue-400" />
                <span className="font-medium text-white">Sync across devices</span>
              </div>
              <p className="text-sm mb-3 text-gray-300">
                Sign in to sync your watchlist and settings across all your devices.
              </p>
              <button onClick={signIn}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white transition-colors">
                <LogIn className="w-4 h-4" />
                Sign in with Google
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border p-6 bg-gray-800 border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium text-white">About</h3>
        </div>
        <p className="text-sm text-gray-400">
          Stock Research Hub provides free stock data with 15-minute delayed quotes.
          Sign in with Google to sync your watchlist across devices.
        </p>
      </div>

      <div className="rounded-xl border p-6 bg-gray-800 border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <HelpCircle className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium text-white">Help</h3>
        </div>
        <p className="text-sm mb-4 text-gray-400">
          New to Stock Research Hub? Take a quick tour to learn the basics.
        </p>
        <button onClick={onShowTour}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white flex items-center gap-2 transition-colors">
          <Sparkles className="w-4 h-4" />
          Show Tour
        </button>
      </div>

      <div className="rounded-xl border p-6 bg-gray-800 border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <Trash2 className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium text-white">Data Management</h3>
        </div>
        <p className="text-sm mb-4 text-gray-400">
          Clear all locally stored data. Cloud data will remain if you're signed in.
        </p>
        <button onClick={handleClear}
          className="px-4 py-2.5 bg-red-600 hover:bg-red-700 rounded-xl text-white flex items-center gap-2 transition-colors">
          <Trash2 className="w-4 h-4" />
          Clear All Local Data
        </button>
      </div>
    </div>
  )
}

// ============ BACK TO TOP BUTTON ============
function BackToTopButton() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setShow(window.scrollY > 400)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!show) return null

  return (
    <button
      onClick={scrollToTop}
      aria-label="Back to top"
      className="fixed bottom-24 md:bottom-8 right-4 z-30 p-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
    >
      <ArrowUp className="w-5 h-5 text-white" />
    </button>
  )
}

// ============ APP CONTENT ============
function AppContent() {
  const { user, loading: authLoading, signIn } = useAuth()
  const { addToast } = useToast()
  const [activePage, setActivePage] = useState('dashboard')
  const [selectedStock, setSelectedStock] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('tour_completed'))
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('watchlist')
    return saved ? JSON.parse(saved) : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA']
  })
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('user_settings')
    return saved ? JSON.parse(saved) : {}
  })
  const [dismissedSyncBanner, setDismissedSyncBanner] = useState(() => sessionStorage.getItem('dismissed_sync_banner') === 'true')

  const watchlistSync = useCloudSync('watchlist', watchlist, setWatchlist, user)
  const settingsSync = useCloudSync('settings', settings, setSettings, user)

  const syncStatus = {
    synced: user ? (watchlistSync.synced && settingsSync.synced) : false,
    syncing: user ? (watchlistSync.syncing || settingsSync.syncing) : false
  }

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

  // Scroll to top when switching pages
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activePage])

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

  const dismissBanner = () => {
    setDismissedSyncBanner(true)
    sessionStorage.setItem('dismissed_sync_banner', 'true')
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0 bg-[#0a0e17] noise-bg">
      <DesktopNav activePage={activePage} setActivePage={setActivePage}
        onSearchOpen={() => setShowSearch(true)} syncStatus={syncStatus} />
      <MobileBottomNav activePage={activePage} setActivePage={setActivePage} onSearchOpen={() => setShowSearch(true)} />

      {!user && !dismissedSyncBanner && (
        <div className="border-b bg-blue-900/20 border-blue-500/30">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="w-4 h-4 text-blue-400" />
              <span className="text-gray-300">Sign in to sync your data across devices</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={signIn} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm">
                Sign in
              </button>
              <button onClick={dismissBanner} className="p-1 rounded hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 pb-24 md:pb-6">
        <div key={activePage} className="animate-page-enter">
          {activePage === 'dashboard' && <Dashboard watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} />}
          {activePage === 'explore' && <ExplorePage onSelectStock={setSelectedStock} />}
          {activePage === 'insights' && <AIInsights finnhubFetch={finnhubFetch} />}
          {activePage === 'screener' && <ScreenerTab onSelectStock={setSelectedStock} />}
          {activePage === 'earnings' && <EarningsTab onSelectStock={setSelectedStock} watchlist={watchlist} />}
          {activePage === 'news' && <NewsPage watchlist={watchlist} />}
          {activePage === 'watchlist' && <Watchlist watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} />}
          {activePage === 'settings' && <SettingsPage syncStatus={syncStatus} onShowTour={() => setShowTour(true)} />}
        </div>
      </main>

      {selectedStock && <StockDetail symbol={selectedStock} onClose={() => setSelectedStock(null)} />}
      {showSearch && <PredictiveSearch onSelect={setSelectedStock} onClose={() => setShowSearch(false)} />}
      {showTour && <OnboardingTour onComplete={() => setShowTour(false)} onOpenSearch={() => setShowSearch(true)} setActivePage={setActivePage} />}
      <BackToTopButton />
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
