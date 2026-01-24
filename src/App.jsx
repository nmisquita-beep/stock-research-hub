import { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react'
import {
  TrendingUp, TrendingDown, Plus, X, Settings, BarChart3, Newspaper,
  Home, Clock, RefreshCw, Star, Trash2, AlertCircle, CheckCircle,
  Activity, Search, Moon, Sun, Zap, Calendar,
  AlertTriangle, ChevronRight, HelpCircle, Sparkles,
  Cloud, CloudOff, LogIn, LogOut, User, Brain,
  Filter, Grid3X3, PieChart, Target, DollarSign, Award, Layers,
  ArrowUpRight, ArrowDownRight, Info, Building, ChevronDown, Eye
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
    avgVolume: data.averageDailyVolume3Month || data.averageVolume || 0,
    name: data.shortName || data.longName || '',
    exchange: data.exchange || '',
    currency: data.currency || 'USD',
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
  const changes = Object.values(stocksData).map(d => d && d.pc ? ((d.c - d.pc) / d.pc) * 100 : 0)
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
      setSyncing(true)
      try {
        const docSnap = await getDoc(docRef)
        if (!docSnap.exists()) {
          await setDoc(docRef, { value: localValueRef.current, updatedAt: new Date().toISOString() })
        }
      } catch (error) {
        console.error('Migration error:', error)
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
function Tooltip({ children, content }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block overflow-visible" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs bg-gray-900 text-white rounded-lg whitespace-nowrap z-[100] shadow-lg border border-gray-700 pointer-events-none">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />
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
        <span className="text-gray-300 text-sm font-medium">Market Mood</span>
        <span className="text-xl">{label.emoji}</span>
      </div>
      <div className="relative h-3 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full mb-2">
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-800 transition-all duration-500"
          style={{ left: `calc(${value}% - 8px)` }} />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">Fear</span>
        <span className={`text-sm font-medium ${label.color}`}>{label.text}</span>
        <span className="text-xs text-gray-400">Greed</span>
      </div>
    </div>
  )
}

// ============ FRIENDLY GUIDED TOUR ============
function OnboardingTour({ onComplete }) {
  const [step, setStep] = useState(0)
  const [highlightRect, setHighlightRect] = useState(null)
  const [isAnimating, setIsAnimating] = useState(false)

  // Step 0 = Welcome, Step 4 = Finish (both centered modals)
  const steps = [
    {
      type: 'welcome',
      title: 'Welcome to Stock Research Hub!',
      description: 'Your personal dashboard for stock research, AI-powered insights, and real-time market news.',
      emoji: '🚀'
    },
    {
      type: 'highlight',
      target: '[data-tour="dashboard"]',
      title: 'Dashboard',
      description: 'Your home base - market indices, your watchlist, and top movers all in one place.',
      position: 'bottom'
    },
    {
      type: 'highlight',
      target: '[data-tour="insights"]',
      title: 'AI Stock Analysis',
      description: 'Get AI-powered insights on any stock - risks, opportunities, and recommendations.',
      position: 'bottom'
    },
    {
      type: 'highlight',
      target: '[data-tour="news"]',
      title: 'Stock News',
      description: 'Stay updated with real stock market news from companies you care about.',
      position: 'bottom'
    },
    {
      type: 'finish',
      title: "You're All Set!",
      description: 'Start exploring the market. Use the search (/) to find any stock instantly.',
      emoji: '🎉'
    }
  ]

  const currentStep = steps[step]
  const isModal = currentStep.type === 'welcome' || currentStep.type === 'finish'
  const totalSteps = steps.length

  useEffect(() => {
    if (isModal) {
      setHighlightRect(null)
      return
    }

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
      } else {
        setHighlightRect(null)
      }
    }

    updateHighlight()
    window.addEventListener('resize', updateHighlight)
    window.addEventListener('scroll', updateHighlight)
    return () => {
      window.removeEventListener('resize', updateHighlight)
      window.removeEventListener('scroll', updateHighlight)
    }
  }, [step, currentStep])

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

  // Calculate tooltip position for highlight steps
  const getTooltipPosition = () => {
    if (!highlightRect) return {}

    const padding = 12
    const tooltipHeight = 160
    let top = highlightRect.top + highlightRect.height + padding
    let left = highlightRect.left + highlightRect.width / 2

    // If tooltip would go off bottom, position above
    if (top + tooltipHeight > window.innerHeight - 20) {
      top = highlightRect.top - tooltipHeight - padding
    }

    // Keep within horizontal bounds
    const tooltipWidth = 320
    if (left - tooltipWidth / 2 < 20) left = tooltipWidth / 2 + 20
    if (left + tooltipWidth / 2 > window.innerWidth - 20) left = window.innerWidth - tooltipWidth / 2 - 20

    const arrowOnTop = top > highlightRect.top

    return { top, left, arrowOnTop }
  }

  const tooltipPos = getTooltipPosition()

  return (
    <div className={`fixed inset-0 z-[200] transition-opacity duration-300 ${isAnimating ? 'opacity-50' : 'opacity-100'}`}>
      {/* Semi-transparent overlay - users can still see the site */}
      <div className="absolute inset-0 bg-black/50" onClick={handleSkip} />

      {/* Highlight cutout for non-modal steps */}
      {!isModal && highlightRect && (
        <>
          {/* Spotlight effect - brighten the highlighted element */}
          <div
            className="absolute rounded-xl transition-all duration-300 ease-out pointer-events-none"
            style={{
              top: highlightRect.top,
              left: highlightRect.left,
              width: highlightRect.width,
              height: highlightRect.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              background: 'transparent',
              border: '3px solid #3b82f6',
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
              boxShadow: '0 0 30px 10px rgba(59, 130, 246, 0.4)',
              transition: 'all 0.3s ease-out'
            }}
          />
        </>
      )}

      {/* Welcome/Finish Modal (centered) */}
      {isModal && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl max-w-md w-full overflow-hidden transform transition-all">
            <div className="p-8 text-center">
              <div className="text-5xl mb-4">{currentStep.emoji}</div>
              <h2 className="text-2xl font-bold text-white mb-3">{currentStep.title}</h2>
              <p className="text-gray-400 leading-relaxed">{currentStep.description}</p>
            </div>
            <div className="px-8 pb-8 flex flex-col gap-3">
              <button
                onClick={handleNext}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                {currentStep.type === 'welcome' ? "Let's Take a Tour" : 'Start Exploring'}
              </button>
              {currentStep.type === 'welcome' && (
                <button
                  onClick={handleSkip}
                  className="w-full py-2 text-gray-400 hover:text-gray-300 text-sm transition-colors"
                >
                  Skip tour, I'll explore on my own
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tooltip for highlight steps */}
      {!isModal && highlightRect && (
        <div
          className="absolute w-80 transition-all duration-300 ease-out"
          style={{
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
            transform: 'translateX(-50%)'
          }}
        >
          {/* Arrow pointing to element */}
          {!tooltipPos.arrowOnTop && (
            <div className="flex justify-center -mb-2">
              <div className="w-4 h-4 bg-gray-800 border-l border-t border-gray-600 transform rotate-45" />
            </div>
          )}

          <div className="bg-gray-800 rounded-xl border border-gray-600 shadow-2xl overflow-hidden">
            {/* Progress dots */}
            <div className="flex justify-center gap-1.5 pt-4">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === step ? 'bg-blue-500 w-6' : i < step ? 'bg-blue-400 w-2' : 'bg-gray-600 w-2'
                  }`}
                />
              ))}
            </div>

            {/* Content */}
            <div className="p-5">
              <h3 className="text-lg font-bold text-white mb-2">{currentStep.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{currentStep.description}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-5 pb-5">
              <button
                onClick={handleSkip}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Skip
              </button>
              <div className="flex gap-2">
                {step > 1 && (
                  <button
                    onClick={handleBack}
                    className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {step === steps.length - 2 ? 'Finish' : 'Next'}
                </button>
              </div>
            </div>
          </div>

          {/* Arrow pointing to element (bottom) */}
          {tooltipPos.arrowOnTop && (
            <div className="flex justify-center -mt-2">
              <div className="w-4 h-4 bg-gray-800 border-r border-b border-gray-600 transform rotate-45" />
            </div>
          )}
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { border-color: #3b82f6; }
          50% { border-color: #60a5fa; }
        }
      `}</style>
    </div>
  )
}

// ============ PREDICTIVE SEARCH ============
function PredictiveSearch({ onSelect, onClose, placeholder = "Search stocks...", inline = false }) {
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
      // Use Yahoo search - no rate limits
      const data = await yahooFetch(q, 'search')
      let resultArray = []
      if (data && data.quotes && Array.isArray(data.quotes)) {
        resultArray = data.quotes
          .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
          .slice(0, 6)
          .map(r => ({ symbol: r.symbol, name: r.shortname || r.longname || r.symbol }))
      }
      setResults(resultArray)
      setSelectedIndex(0)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, 200), [])

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
            placeholder={placeholder} className="bg-transparent text-white placeholder-gray-400 outline-none flex-1 text-sm" />
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
                <Plus className="w-4 h-4 text-gray-400" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl border border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value.toUpperCase())} onKeyDown={handleKeyDown}
            placeholder={placeholder} className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none text-lg" />
          <kbd className="px-2 py-1 text-xs bg-gray-700 rounded text-gray-300">ESC</kbd>
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
              <ChevronRight className="w-4 h-4 text-gray-400" />
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

// ============ EARNINGS CALENDAR ============
function EarningsCalendar({ onSelect, darkMode }) {
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
function WatchlistInsights({ watchlist, quotes, darkMode }) {
  if (!watchlist || watchlist.length === 0) return null

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
          {loading ? [1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />) : news.length > 0 ? news.map((article, i) => {
            const hasImage = article.image && article.image.length > 10
            const summary = article.summary || ''
            return (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="block bg-gray-700/30 hover:bg-gray-700/50 rounded-lg transition-all group overflow-hidden">
                <div className="flex">
                  {hasImage && (
                    <div className="hidden sm:block w-28 h-24 flex-shrink-0">
                      <img src={article.image} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
                    </div>
                  )}
                  <div className="flex-1 p-4">
                    <h4 className="text-white font-medium group-hover:text-blue-400 line-clamp-2 mb-1">{article.headline}</h4>
                    {summary && (
                      <p className="text-sm text-gray-400 line-clamp-1 mb-2">{summary}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-300">{article.source}</span>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(article.datetime)}
                      </span>
                    </div>
                  </div>
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
function MobileBottomNav({ activePage, setActivePage, darkMode }) {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'insights', label: 'AI', icon: Brain },
    { id: 'screener', label: 'Screener', icon: Filter },
    { id: 'sectors', label: 'Sectors', icon: PieChart },
    { id: 'settings', label: 'More', icon: Grid3X3 }
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800/95 backdrop-blur-lg border-t border-gray-700 z-40 safe-area-pb">
      <div className="flex items-center justify-around py-2">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setActivePage(item.id)}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-all ${
              activePage === item.id ? 'text-blue-500' : 'text-gray-400'
            }`}>
            <item.icon className="w-5 h-5" />
            <span className="text-[10px]">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// ============ DESKTOP NAVIGATION ============
function DesktopNav({ activePage, setActivePage, onSearchOpen, darkMode, toggleDarkMode, syncStatus }) {
  const { user, loading: authLoading, signIn, signOut: handleSignOut } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, tour: 'dashboard' },
    { id: 'insights', label: 'AI Insights', icon: Brain, tour: 'insights' },
    { id: 'screener', label: 'Screener', icon: Filter },
    { id: 'earnings', label: 'Earnings', icon: Calendar },
    { id: 'sectors', label: 'Sectors', icon: PieChart },
    { id: 'news', label: 'News', icon: Newspaper, tour: 'news' },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  return (
    <nav className="bg-gray-800/80 backdrop-blur-lg border-b border-gray-700 sticky top-0 z-40 overflow-visible">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg hidden sm:block text-white">Stock Research Hub</span>
          </div>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActivePage(item.id)}
                data-tour={item.tour}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  activePage === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' : 'text-gray-300 hover:bg-gray-700'
                }`}>
                <item.icon className="w-4 h-4" />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-visible">
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
              <button data-tour="search" onClick={onSearchOpen} className="p-2 rounded-lg transition-colors hover:bg-gray-700 text-gray-300">
                <Search className="w-5 h-5" />
              </button>
            </Tooltip>
            <Tooltip content="Toggle theme">
              <button onClick={toggleDarkMode} className="p-2 rounded-lg transition-colors hover:bg-gray-700 text-gray-300">
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </Tooltip>
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
function AIMarketPulse({ marketData, moversData }) {
  const [pulse, setPulse] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchPulse = async () => {
      if (!marketData || Object.keys(marketData).length === 0) return

      // Check cache
      const cached = aiCache.get('marketPulse', 'marketPulse')
      if (cached) {
        setPulse(cached)
        return
      }

      setLoading(true)
      try {
        const indices = Object.entries(marketData).map(([sym, data]) => {
          const change = data.pc ? ((data.c - data.pc) / data.pc * 100).toFixed(2) : 0
          return `${sym}: ${change >= 0 ? '+' : ''}${change}%`
        }).join(', ')

        const gainers = moversData?.gainers?.slice(0, 3).map(s => `${s.symbol} +${s.change.toFixed(1)}%`).join(', ') || 'N/A'
        const losers = moversData?.losers?.slice(0, 3).map(s => `${s.symbol} ${s.change.toFixed(1)}%`).join(', ') || 'N/A'

        const prompt = `Today's Market:
Indices: ${indices}
Top Gainers: ${gainers}
Top Losers: ${losers}

2-3 sentence market pulse. Start with mood (Bullish/Bearish/Mixed), then explain WHY with specific stocks/sectors.`

        console.log('AI Prompt (Market Pulse):', prompt)
        const insight = await groqFetch(prompt, {}, false)
        setPulse(insight)
        aiCache.set('marketPulse', insight)
      } catch (err) {
        console.error('Market pulse error:', err)
      }
      setLoading(false)
    }

    fetchPulse()
  }, [marketData, moversData])

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-4 border border-purple-500/20 animate-pulse">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <span className="text-sm font-medium text-purple-300">AI Market Pulse</span>
        </div>
        <div className="h-12 bg-gray-700/50 rounded" />
      </div>
    )
  }

  if (!pulse) return null

  return (
    <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-4 border border-purple-500/20">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-5 h-5 text-purple-400" />
        <span className="text-sm font-medium text-purple-300">AI Market Pulse</span>
        <Sparkles className="w-4 h-4 text-purple-400" />
      </div>
      <p className="text-gray-200 text-sm leading-relaxed">{pulse}</p>
    </div>
  )
}

// ============ SECTORS TAB ============
const SECTORS = [
  { name: 'Technology', symbol: 'XLK', color: 'from-blue-500 to-cyan-500' },
  { name: 'Healthcare', symbol: 'XLV', color: 'from-green-500 to-emerald-500' },
  { name: 'Financials', symbol: 'XLF', color: 'from-yellow-500 to-amber-500' },
  { name: 'Consumer Disc.', symbol: 'XLY', color: 'from-pink-500 to-rose-500' },
  { name: 'Communication', symbol: 'XLC', color: 'from-purple-500 to-violet-500' },
  { name: 'Industrials', symbol: 'XLI', color: 'from-gray-500 to-slate-500' },
  { name: 'Consumer Staples', symbol: 'XLP', color: 'from-orange-500 to-amber-500' },
  { name: 'Energy', symbol: 'XLE', color: 'from-red-500 to-orange-500' },
  { name: 'Utilities', symbol: 'XLU', color: 'from-teal-500 to-cyan-500' },
  { name: 'Real Estate', symbol: 'XLRE', color: 'from-indigo-500 to-blue-500' },
  { name: 'Materials', symbol: 'XLB', color: 'from-lime-500 to-green-500' }
]

function SectorsTab({ onSelectStock, darkMode }) {
  const [sectorData, setSectorData] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedSector, setSelectedSector] = useState(null)
  const [sectorAnalysis, setSectorAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)

  useEffect(() => {
    const fetchSectors = async () => {
      setLoading(true)
      const data = {}
      const results = await Promise.allSettled(
        SECTORS.map(s => yahooFetch(s.symbol))
      )
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          const normalized = normalizeYahooQuote(result.value)
          if (normalized) {
            data[SECTORS[i].symbol] = normalized
          }
        }
      })
      setSectorData(data)
      setLoading(false)
    }
    fetchSectors()
  }, [])

  const analyzeSector = async (sector) => {
    setSelectedSector(sector)
    setSectorAnalysis(null)

    const cacheKey = `sector_${sector.symbol}`
    const cached = aiCache.get(cacheKey, 'sectors')
    if (cached) {
      setSectorAnalysis(cached)
      return
    }

    setAnalysisLoading(true)
    try {
      const data = sectorData[sector.symbol]
      const change = data?.pc ? ((data.c - data.pc) / data.pc * 100).toFixed(2) : 0

      const prompt = `Sector: ${sector.name} (ETF: ${sector.symbol})
Performance: ${change >= 0 ? '+' : ''}${change}% today
Price: $${data?.c?.toFixed(2) || 'N/A'}

Is ${sector.name} sector bullish or bearish? What's driving it? 2 sentences, be specific.`

      console.log('AI Prompt (Sector):', prompt)
      const insight = await groqFetch(prompt, {}, false)
      setSectorAnalysis(insight)
      aiCache.set(cacheKey, insight)
    } catch (err) {
      setSectorAnalysis('Analysis unavailable')
    }
    setAnalysisLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <PieChart className="w-7 h-7 text-blue-400" />
          Sector Performance
        </h2>
        <p className="text-gray-400 mt-1">S&P 500 sector breakdown with AI analysis</p>
      </div>

      {/* Sector Heat Map */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {SECTORS.map(sector => {
          const data = sectorData[sector.symbol]
          const change = data?.pc ? ((data.c - data.pc) / data.pc * 100) : 0
          const isPositive = change >= 0
          return (
            <button
              key={sector.symbol}
              onClick={() => analyzeSector(sector)}
              className={`rounded-xl p-4 text-left transition-all hover:scale-105 border ${
                selectedSector?.symbol === sector.symbol
                  ? 'border-blue-500 ring-2 ring-blue-500/30'
                  : 'border-gray-700 hover:border-gray-600'
              } ${isPositive ? 'bg-green-900/20' : 'bg-red-900/20'}`}
            >
              <div className="text-xs text-gray-400 mb-1">{sector.symbol}</div>
              <div className="font-medium text-white text-sm truncate">{sector.name}</div>
              {loading ? (
                <div className="h-5 bg-gray-700 rounded animate-pulse mt-2" />
              ) : (
                <div className={`text-lg font-bold mt-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                  {isPositive ? '+' : ''}{change.toFixed(2)}%
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Sector Analysis */}
      {selectedSector && (
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${selectedSector.color} flex items-center justify-center`}>
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white">{selectedSector.name}</h3>
              <p className="text-gray-400 text-sm">{selectedSector.symbol}</p>
            </div>
          </div>

          {analysisLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-gray-700 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-gray-700 rounded animate-pulse w-1/2" />
            </div>
          ) : sectorAnalysis ? (
            <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">AI Analysis</span>
              </div>
              <p className="text-gray-200 text-sm">{sectorAnalysis}</p>
            </div>
          ) : null}

          <button
            onClick={() => onSelectStock(selectedSector.symbol)}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm flex items-center gap-2"
          >
            <Eye className="w-4 h-4" />
            View {selectedSector.symbol} Details
          </button>
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
    description: 'Low P/E with strong growth potential',
    icon: Target,
    color: 'from-green-500 to-emerald-600',
    stocks: ['META', 'GOOG', 'INTC', 'T', 'VZ', 'GM', 'F', 'WFC']
  },
  {
    id: 'dividend',
    name: 'Dividend Champions',
    description: 'Consistent dividend growers',
    icon: DollarSign,
    color: 'from-blue-500 to-indigo-600',
    stocks: ['JNJ', 'PG', 'KO', 'PEP', 'MMM', 'XOM', 'CVX', 'VZ']
  },
  {
    id: 'momentum',
    name: 'Momentum Plays',
    description: 'Strong recent performance',
    icon: TrendingUp,
    color: 'from-purple-500 to-pink-600',
    stocks: ['NVDA', 'META', 'AMZN', 'NFLX', 'AMD', 'AVGO', 'CRM', 'NOW']
  },
  {
    id: 'turnaround',
    name: 'Turnaround Candidates',
    description: 'Down but fundamentals improving',
    icon: RefreshCw,
    color: 'from-orange-500 to-red-600',
    stocks: ['INTC', 'BA', 'DIS', 'PYPL', 'NKE', 'SBUX', 'TGT', 'WBD']
  },
  {
    id: 'ai-favorites',
    name: 'AI Favorites',
    description: 'Stocks AI is most bullish on',
    icon: Brain,
    color: 'from-cyan-500 to-blue-600',
    stocks: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AAPL', 'META', 'TSM', 'AVGO']
  }
]

function ScreenerTab({ onSelectStock, darkMode }) {
  const [selectedScreen, setSelectedScreen] = useState(null)
  const [screenResults, setScreenResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [aiReasoning, setAiReasoning] = useState(null)

  const runScreen = async (screen) => {
    setSelectedScreen(screen)
    setLoading(true)
    setAiReasoning(null)

    const cacheKey = `screen_${screen.id}`
    const cached = aiCache.get(cacheKey, 'screener')
    if (cached) {
      setScreenResults(cached.results)
      setAiReasoning(cached.reasoning)
      setLoading(false)
      return
    }

    try {
      // Fetch data for screen stocks
      const results = await Promise.allSettled(
        screen.stocks.map(s => yahooFetch(s))
      )

      const stockData = []
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          const normalized = normalizeYahooQuote(result.value)
          if (normalized && normalized.c > 0) {
            const change = normalized.pc ? ((normalized.c - normalized.pc) / normalized.pc * 100) : 0
            stockData.push({
              symbol: screen.stocks[i],
              name: normalized.name,
              price: normalized.c,
              change,
              pe: normalized.peRatio,
              marketCap: normalized.marketCap
            })
          }
        }
      })

      setScreenResults(stockData)

      // Get AI reasoning
      const prompt = `Screen: "${screen.name}" - ${screen.description}
Stocks in this screen:
${stockData.map(s => `- ${s.symbol}: $${s.price?.toFixed(2) || 'N/A'}, ${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}% today, P/E: ${s.pe?.toFixed(1) || 'N/A'}`).join('\n')}

Explain in 2 sentences why these specific stocks (${stockData.map(s => s.symbol).join(', ')}) fit the "${screen.name}" criteria. Be specific about each company.`

      console.log('AI Prompt (Screener):', prompt)
      const reasoning = await groqFetch(prompt, {}, false)
      setAiReasoning(reasoning)

      aiCache.set(cacheKey, { results: stockData, reasoning })
    } catch (err) {
      console.error('Screen error:', err)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Filter className="w-7 h-7 text-green-400" />
          AI Stock Screener
        </h2>
        <p className="text-gray-400 mt-1">AI-curated stock screens for different strategies</p>
      </div>

      {/* Screen Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${screen.color} flex items-center justify-center`}>
                <screen.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-medium text-white">{screen.name}</h3>
                <p className="text-xs text-gray-400">{screen.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Screen Results */}
      {selectedScreen && (
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <selectedScreen.icon className="w-5 h-5" />
            {selectedScreen.name} Results
          </h3>

          {aiReasoning && (
            <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-500/20 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">AI Reasoning</span>
              </div>
              <p className="text-gray-200 text-sm">{aiReasoning}</p>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-gray-700 rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {screenResults.map(stock => (
                <button
                  key={stock.symbol}
                  onClick={() => onSelectStock(stock.symbol)}
                  className="w-full flex items-center justify-between p-4 rounded-lg bg-gray-700/30 hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center">
                      <span className="text-white font-bold">{stock.symbol.charAt(0)}</span>
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-white">{stock.symbol}</div>
                      <div className="text-xs text-gray-400 truncate max-w-[150px]">{stock.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-medium">{formatCurrency(stock.price)}</div>
                    <div className={`text-sm ${stock.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                    </div>
                  </div>
                </button>
              ))}
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

function EarningsTab({ onSelectStock, watchlist, darkMode }) {
  const [earnings, setEarnings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [predictions, setPredictions] = useState({})
  const [loadingPrediction, setLoadingPrediction] = useState(null)

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

  const getPrediction = async (stock) => {
    const cacheKey = `earnings_${stock.symbol}`
    const cached = aiCache.get(cacheKey, 'earnings')
    if (cached) {
      setPredictions(prev => ({ ...prev, [stock.symbol]: cached }))
      return
    }

    setLoadingPrediction(stock.symbol)
    try {
      const prompt = `Company: ${stock.name || stock.symbol} (${stock.symbol})
Report Date: ${stock.date}
Expected EPS: $${stock.expectedEps}
Previous EPS: $${stock.prevEps}
Current Price: $${stock.price?.toFixed(2) || 'N/A'}

Will ${stock.symbol} BEAT, MISS, or MEET earnings expectations?
Respond with JSON only: {"prediction": "BEAT" or "MISS" or "MEET", "confidence": "HIGH" or "MEDIUM" or "LOW", "reason": "one sentence specific to ${stock.symbol}'s business"}`

      console.log('AI Prompt (Earnings):', prompt)
      const rawPrediction = await groqFetch(prompt, {}, true)
      const parsed = parseAiJson(rawPrediction)

      if (parsed && parsed.prediction) {
        setPredictions(prev => ({ ...prev, [stock.symbol]: parsed }))
        aiCache.set(cacheKey, parsed)
      } else {
        // Fallback: try to extract from text
        const fallback = {
          prediction: rawPrediction.includes('BEAT') ? 'BEAT' : rawPrediction.includes('MISS') ? 'MISS' : 'MEET',
          confidence: rawPrediction.includes('HIGH') ? 'HIGH' : rawPrediction.includes('LOW') ? 'LOW' : 'MEDIUM',
          reason: rawPrediction.slice(0, 150)
        }
        setPredictions(prev => ({ ...prev, [stock.symbol]: fallback }))
        aiCache.set(cacheKey, fallback)
      }
    } catch {
      setPredictions(prev => ({ ...prev, [stock.symbol]: { prediction: 'N/A', confidence: 'LOW', reason: 'Prediction unavailable' } }))
    }
    setLoadingPrediction(null)
  }

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
          <p className="text-gray-400 mt-1">Upcoming earnings with AI predictions</p>
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
          {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedEarnings.map(stock => {
            const isThisWeek = new Date(stock.date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            return (
              <div
                key={stock.symbol}
                className={`rounded-xl p-4 border transition-all ${
                  isThisWeek ? 'bg-yellow-900/20 border-yellow-500/30' : 'bg-gray-800/50 border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <button onClick={() => onSelectStock(stock.symbol)} className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <span className="text-white font-bold">{stock.symbol.charAt(0)}</span>
                      </div>
                      <div>
                        <div className="font-bold text-white">{stock.symbol}</div>
                        <div className="text-sm text-gray-400">{stock.name}</div>
                      </div>
                    </button>
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
                    <button
                      onClick={() => getPrediction(stock)}
                      disabled={loadingPrediction === stock.symbol}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      {loadingPrediction === stock.symbol ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Brain className="w-4 h-4" />
                      )}
                      Predict
                    </button>
                  </div>
                </div>

                {predictions[stock.symbol] && (
                  <div className="mt-4 p-3 bg-purple-900/20 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-purple-300">AI Prediction</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        predictions[stock.symbol].prediction === 'BEAT' ? 'bg-green-500/30 text-green-400' :
                        predictions[stock.symbol].prediction === 'MISS' ? 'bg-red-500/30 text-red-400' :
                        'bg-yellow-500/30 text-yellow-400'
                      }`}>
                        {predictions[stock.symbol].prediction || 'N/A'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        predictions[stock.symbol].confidence === 'HIGH' ? 'bg-blue-500/30 text-blue-400' :
                        predictions[stock.symbol].confidence === 'LOW' ? 'bg-gray-500/30 text-gray-400' :
                        'bg-purple-500/30 text-purple-400'
                      }`}>
                        {predictions[stock.symbol].confidence || 'MEDIUM'} confidence
                      </span>
                    </div>
                    <p className="text-gray-200 text-sm">{predictions[stock.symbol].reason || predictions[stock.symbol]}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ COMBINED DASHBOARD ============
function Dashboard({ watchlist, setWatchlist, onSelectStock, darkMode }) {
  const [marketData, setMarketData] = useState({})
  const [watchlistQuotes, setWatchlistQuotes] = useState({})
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
  const popularStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'JPM', 'V', 'MA', 'DIS', 'NFLX', 'PYPL', 'INTC', 'CRM']

  const fetchAllData = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setLoading(true)

    // Use ref to get current watchlist without causing dependency changes
    const currentWatchlist = watchlistRef.current || []

    // Combine all symbols to fetch (remove duplicates)
    const allSymbols = [...new Set([...indices, ...currentWatchlist, ...popularStocks])]

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

    // Calculate movers from popular stocks
    const stockData = popularStocks
      .filter(s => allData[s] && allData[s].pc > 0)
      .map(s => ({
        symbol: s,
        price: allData[s].c,
        change: ((allData[s].c - allData[s].pc) / allData[s].pc) * 100
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

      {/* AI Market Pulse */}
      <AIMarketPulse marketData={marketData} moversData={moversData} />

      {/* Market Indices Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {indices.map(symbol => {
          const data = marketData[symbol]
          const change = data ? data.c - data.pc : 0
          const pctChange = data?.pc ? (change / data.pc) * 100 : 0
          const positive = change >= 0
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
                    <div className={`text-sm font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>{positive ? '+' : ''}{pctChange.toFixed(2)}%</div>
                  </div>
                  <MiniSparkline data={sparkData} positive={positive} />
                </div>
              )}
            </div>
          )
        })}
        <FearGreedIndicator value={mood} />
      </div>

      {/* Your Watchlist Section */}
      <div className="space-y-4">
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
            {watchlist.map(symbol => {
              const quote = watchlistQuotes[symbol]
              const change = quote ? quote.c - quote.pc : 0
              const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
              const positive = change >= 0
              const sparkData = quote ? generateSparklineData(quote.c, quote.pc) : []
              return (
                <div
                  key={symbol}
                  onClick={() => onSelectStock(symbol)}
                  className="rounded-xl p-3 border transition-all hover:scale-[1.02] bg-gray-800/50 border-gray-700 hover:border-blue-500 cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-white">{symbol}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSymbol(symbol); }}
                      className="p-1 hover:bg-red-600/20 rounded text-gray-400 hover:text-red-400 z-10"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {quote ? (
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-lg font-bold text-white">{formatCurrency(quote.c)}</div>
                        <div className={`text-xs font-medium flex items-center gap-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>
                          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {positive ? '+' : ''}{pctChange.toFixed(2)}%
                        </div>
                      </div>
                      <MiniSparkline data={sparkData} positive={positive} height={32} />
                    </div>
                  ) : (
                    <Skeleton className="h-10 w-full" />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl p-8 border text-center bg-gray-800/50 border-gray-700">
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
          <div className="rounded-xl p-4 border bg-gray-800/50 border-gray-700">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Top Gainers
            </h4>
            <div className="space-y-2">
              {loading ? (
                [1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)
              ) : moversData.gainers.map((stock, i) => (
                <button key={stock.symbol} onClick={() => onSelectStock(stock.symbol)}
                  className="w-full flex items-center justify-between p-2 rounded-lg transition-colors hover:bg-gray-700/50">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs w-3">{i + 1}</span>
                    <span className="font-medium text-white text-sm">{stock.symbol}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-green-400 text-sm font-medium">+{stock.change.toFixed(2)}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Top Losers */}
          <div className="rounded-xl p-4 border bg-gray-800/50 border-gray-700">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Top Losers
            </h4>
            <div className="space-y-2">
              {loading ? (
                [1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)
              ) : moversData.losers.map((stock, i) => (
                <button key={stock.symbol} onClick={() => onSelectStock(stock.symbol)}
                  className="w-full flex items-center justify-between p-2 rounded-lg transition-colors hover:bg-gray-700/50">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs w-3">{i + 1}</span>
                    <span className="font-medium text-white text-sm">{stock.symbol}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-red-400 text-sm font-medium">{stock.change.toFixed(2)}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Browse Stocks Section */}
      <BrowseStocks onSelectStock={onSelectStock} allQuotes={{ ...marketData, ...watchlistQuotes }} />
    </div>
  )
}

// ============ BROWSE STOCKS COMPONENT ============
const STOCK_CATEGORIES = [
  {
    name: 'Tech Giants',
    color: 'text-blue-400',
    stocks: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA']
  },
  {
    name: 'Finance',
    color: 'text-yellow-400',
    stocks: ['JPM', 'BAC', 'GS', 'V', 'MA', 'BRK-B']
  },
  {
    name: 'Healthcare',
    color: 'text-green-400',
    stocks: ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK']
  },
  {
    name: 'Consumer',
    color: 'text-pink-400',
    stocks: ['WMT', 'COST', 'MCD', 'NKE', 'SBUX', 'DIS']
  },
  {
    name: 'Energy',
    color: 'text-orange-400',
    stocks: ['XOM', 'CVX', 'COP']
  }
]

function BrowseStocks({ onSelectStock, allQuotes }) {
  const [browseData, setBrowseData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBrowseStocks = async () => {
      setLoading(true)
      const allSymbols = STOCK_CATEGORIES.flatMap(c => c.stocks)
      const toFetch = allSymbols.filter(s => !allQuotes[s])

      if (toFetch.length > 0) {
        const results = await Promise.allSettled(
          toFetch.map(symbol => yahooFetch(symbol))
        )
        const newData = { ...allQuotes }
        results.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value) {
            const normalized = normalizeYahooQuote(result.value)
            if (normalized && normalized.c > 0) {
              newData[toFetch[i]] = normalized
            }
          }
        })
        setBrowseData(newData)
      } else {
        setBrowseData(allQuotes)
      }
      setLoading(false)
    }
    fetchBrowseStocks()
  }, [allQuotes])

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        <Grid3X3 className="w-5 h-5 text-purple-400" />
        Browse Stocks
      </h3>

      {STOCK_CATEGORIES.map(category => (
        <div key={category.name} className="space-y-2">
          <h4 className={`text-sm font-medium ${category.color}`}>{category.name}</h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-2">
            {category.stocks.map(symbol => {
              const quote = browseData[symbol]
              const change = quote?.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0
              const positive = change >= 0
              return (
                <button
                  key={symbol}
                  onClick={() => onSelectStock(symbol)}
                  className={`p-2 rounded-lg border transition-all hover:scale-105 cursor-pointer ${
                    positive ? 'bg-green-900/20 border-green-500/30 hover:border-green-500' : 'bg-red-900/20 border-red-500/30 hover:border-red-500'
                  }`}
                >
                  <div className="text-xs font-bold text-white">{symbol}</div>
                  {loading ? (
                    <div className="h-4 bg-gray-700 rounded animate-pulse mt-1" />
                  ) : (
                    <>
                      <div className="text-xs text-gray-300">${quote?.c?.toFixed(2) || '—'}</div>
                      <div className={`text-xs font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>
                        {positive ? '+' : ''}{change.toFixed(1)}%
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============ MARKET OVERVIEW (LEGACY - KEPT FOR REFERENCE) ============
function MarketOverview({ onSelectStock, darkMode }) {
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
            const change = data ? data.c - data.pc : 0
            const pctChange = data?.pc ? (change / data.pc) * 100 : 0
            const positive = change >= 0
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
                      <div className={`text-sm font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>{positive ? '+' : ''}{pctChange.toFixed(2)}%</div>
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
              const change = data && data.pc ? ((data.c - data.pc) / data.pc) * 100 : 0
              return (
                <HeatMapCell key={symbol} value={change} label={symbol} onClick={() => onSelectStock(symbol)} />
              )
            })}
          </div>
        </div>
        <div className="space-y-4">
          <EarningsCalendar onSelect={onSelectStock} darkMode={darkMode} />
        </div>
      </div>
    </div>
  )
}

// ============ STOCK CHART COMPONENT ============
function StockChart({ symbol, range = '1mo', interval = '1d' }) {
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)

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

        console.log('Formatted chart data points:', formatted.length)
        setChartData(formatted)
      } catch (err) {
        console.error('Chart fetch error:', err)
        setChartData([])
      }
      setLoading(false)
    }
    fetchChart()
  }, [symbol, range, interval])

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

  return (
    <div className="space-y-2">
      {/* Price Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
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
              formatter={(value) => [`$${value?.toFixed(2)}`, 'Price']}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#chartGradient-${symbol})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

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

// ============ STOCK DETAIL MODAL ============
function StockDetail({ symbol, onClose, darkMode }) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNews, setShowNews] = useState(false)
  const [chartRange, setChartRange] = useState('1mo')
  const [aiSummary, setAiSummary] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const rangeOptions = [
    { value: '1d', label: '1D', interval: '5m' },
    { value: '5d', label: '1W', interval: '15m' },
    { value: '1mo', label: '1M', interval: '1d' },
    { value: '3mo', label: '3M', interval: '1d' },
    { value: '6mo', label: '6M', interval: '1d' },
    { value: '1y', label: '1Y', interval: '1d' },
    { value: '5y', label: '5Y', interval: '1wk' }
  ]

  const currentRangeOption = rangeOptions.find(r => r.value === chartRange) || rangeOptions[2]

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

  // Fetch AI summary
  useEffect(() => {
    const fetchAiSummary = async () => {
      if (!quote) return

      const cacheKey = `stock_summary_${symbol}`
      const cached = aiCache.get(cacheKey, 'stockAnalysis')
      if (cached) {
        setAiSummary(cached)
        return
      }

      setAiLoading(true)
      try {
        const change = quote.changePercent || 0
        const prompt = `Stock: ${symbol} (${quote.name || symbol})
Current Price: $${quote.c?.toFixed(2) || 'N/A'}
Change Today: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%
52-Week High: $${quote.weekHigh52?.toFixed(2) || 'N/A'}
52-Week Low: $${quote.weekLow52?.toFixed(2) || 'N/A'}
P/E Ratio: ${quote.peRatio?.toFixed(1) || 'N/A'}

Explain why ${symbol} is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% today. Be specific to THIS company - mention earnings, news, sector trends, or catalysts. 2 sentences max.`

        console.log('AI Prompt (Stock Summary):', prompt)
        const summary = await groqFetch(prompt, {}, false)
        setAiSummary(summary)
        aiCache.set(cacheKey, summary)
      } catch (err) {
        console.error('AI summary error:', err)
      }
      setAiLoading(false)
    }

    fetchAiSummary()
  }, [quote, symbol])

  const change = quote?.change || 0
  const pctChange = quote?.changePercent || 0
  const positive = change >= 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden border border-gray-700 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">{symbol.charAt(0)}</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{symbol}</h2>
              <p className="text-gray-400">{quote?.name || 'Loading...'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNews(true)} className="p-2 rounded-lg hover:bg-gray-700">
              <Newspaper className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-700">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-blue-500 animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-80px)]">
            {/* Price Header */}
            <div className="flex items-baseline gap-4 flex-wrap">
              <span className="text-4xl font-bold text-white">{formatCurrency(quote?.c)}</span>
              <span className={`text-lg font-medium px-3 py-1 rounded-full ${positive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {positive ? '+' : ''}{pctChange?.toFixed(2)}%
              </span>
              <span className={`text-sm ${positive ? 'text-green-400' : 'text-red-400'}`}>
                {positive ? '+' : ''}{formatCurrency(change)}
              </span>
            </div>

            {/* AI Quick Summary */}
            <div className="bg-purple-900/20 rounded-xl p-4 border border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">Why is {symbol} moving?</span>
              </div>
              {aiLoading ? (
                <div className="h-10 bg-gray-700/50 rounded animate-pulse" />
              ) : aiSummary ? (
                <p className="text-gray-200 text-sm">{aiSummary}</p>
              ) : (
                <p className="text-gray-400 text-sm">Loading AI analysis...</p>
              )}
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
              <StockChart symbol={symbol} range={chartRange} interval={currentRangeOption.interval} />
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Open</div>
                <div className="font-medium text-white">{formatCurrency(quote?.o)}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Day Range</div>
                <div className="font-medium text-white">{formatCurrency(quote?.l)} - {formatCurrency(quote?.h)}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">52W Range</div>
                <div className="font-medium text-white">{formatCurrency(quote?.weekLow52)} - {formatCurrency(quote?.weekHigh52)}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Prev Close</div>
                <div className="font-medium text-white">{formatCurrency(quote?.pc)}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Volume</div>
                <div className="font-medium text-white">{quote?.volume?.toLocaleString() || 'N/A'}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Avg Volume</div>
                <div className="font-medium text-white">{quote?.avgVolume?.toLocaleString() || 'N/A'}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">P/E Ratio</div>
                <div className="font-medium text-white">{quote?.peRatio?.toFixed(2) || 'N/A'}</div>
              </div>
              <div className="rounded-lg p-4 bg-gray-700/30">
                <div className="text-sm text-gray-400">Market Cap</div>
                <div className="font-medium text-white">{formatLargeNumber(quote?.marketCap)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {showNews && <StockNewsModal symbol={symbol} onClose={() => setShowNews(false)} />}
    </div>
  )
}

// ============ WATCHLIST ============
function Watchlist({ watchlist, setWatchlist, onSelectStock, darkMode }) {
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

      <WatchlistInsights watchlist={watchlist} quotes={quotes} darkMode={darkMode} />

      {watchlist && watchlist.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {watchlist.map(symbol => {
            const quote = quotes[symbol]
            const change = quote ? quote.c - quote.pc : 0
            const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
            const positive = change >= 0
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
function MarketMovers({ onSelectStock, darkMode }) {
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
        if (normalized && normalized.c > 0 && normalized.pc > 0) {
          const change = ((normalized.c - normalized.pc) / normalized.pc) * 100
          stockData.push({ symbol, price: normalized.c, change })
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
function NewsPage({ darkMode, watchlist }) {
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
        if (normalized && normalized.c > 0 && normalized.pc > 0) {
          const change = Math.abs((normalized.c - normalized.pc) / normalized.pc * 100)
          stockData.push({ symbol: POPULAR_FOR_MOVERS[i], change })
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
            <p className="text-sm text-gray-400">Real stock market news - no fluff</p>
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
            const hasImage = article.image && article.image.length > 10
            const summary = article.summary || ''
            return (
              <a key={`${article.ticker}-${i}`} href={article.url} target="_blank" rel="noopener noreferrer"
                className="block rounded-xl border transition-all hover:scale-[1.002] bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800 overflow-hidden group">
                <div className="flex">
                  {/* Thumbnail */}
                  {hasImage && (
                    <div className="hidden sm:block w-36 h-28 flex-shrink-0">
                      <img
                        src={article.image}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    </div>
                  )}
                  {/* Content */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start gap-2 mb-1.5">
                      {/* Ticker Badge */}
                      {article.ticker && (
                        <span className="flex-shrink-0 px-2 py-0.5 bg-blue-600/20 text-blue-400 text-xs font-bold rounded">
                          {article.ticker}
                        </span>
                      )}
                      <h3 className="font-medium line-clamp-2 text-white group-hover:text-blue-400 transition-colors">
                        {article.headline}
                      </h3>
                    </div>
                    {summary && (
                      <p className="text-sm text-gray-400 line-clamp-1 mb-2">
                        {summary}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-300 font-medium">{article.source}</span>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-400 flex items-center gap-1">
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
function SettingsPage({ darkMode, syncStatus, onShowTour }) {
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

// ============ APP CONTENT ============
function AppContent() {
  const { user, loading: authLoading, signIn } = useAuth()
  const { addToast } = useToast()
  const [activePage, setActivePage] = useState('dashboard')
  const [selectedStock, setSelectedStock] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
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
    <div className="min-h-screen pb-20 md:pb-0 transition-colors bg-gray-900">
      <DesktopNav activePage={activePage} setActivePage={setActivePage}
        onSearchOpen={() => setShowSearch(true)} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} syncStatus={syncStatus} />
      <MobileBottomNav activePage={activePage} setActivePage={setActivePage} darkMode={darkMode} />

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

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activePage === 'dashboard' && <Dashboard watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'insights' && <AIInsights darkMode={darkMode} finnhubFetch={finnhubFetch} />}
        {activePage === 'screener' && <ScreenerTab onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'earnings' && <EarningsTab onSelectStock={setSelectedStock} watchlist={watchlist} darkMode={darkMode} />}
        {activePage === 'sectors' && <SectorsTab onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'news' && <NewsPage darkMode={darkMode} watchlist={watchlist} />}
        {activePage === 'settings' && <SettingsPage darkMode={darkMode} syncStatus={syncStatus} onShowTour={() => setShowTour(true)} />}
      </main>

      {selectedStock && <StockDetail symbol={selectedStock} onClose={() => setSelectedStock(null)} darkMode={darkMode} />}
      {showSearch && <PredictiveSearch onSelect={setSelectedStock} onClose={() => setShowSearch(false)} />}
      {showTour && <OnboardingTour onComplete={() => setShowTour(false)} />}
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
