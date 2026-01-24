import { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react'
import {
  TrendingUp, TrendingDown, Plus, X, Settings, BarChart3, Newspaper,
  Home, Clock, RefreshCw, Star, Trash2, AlertCircle, CheckCircle,
  Activity, Search, Moon, Sun, Zap, Calendar,
  AlertTriangle, ChevronRight, HelpCircle, Sparkles,
  Cloud, CloudOff, LogIn, LogOut, User, Brain
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
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

// ============ RATE LIMITER ============
class RateLimiter {
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls
    this.windowMs = windowMs
    this.calls = []
    this.waitingUntil = null
  }

  async throttle() {
    const now = Date.now()
    this.calls = this.calls.filter(time => now - time < this.windowMs)

    if (this.calls.length >= this.maxCalls) {
      const waitTime = this.windowMs - (now - this.calls[0]) + 100
      this.waitingUntil = now + waitTime
      const actualWait = Math.min(waitTime, 5000)
      await new Promise(resolve => setTimeout(resolve, actualWait))
      this.waitingUntil = null
      return this.throttle()
    }

    this.calls.push(now)
    return true
  }

  getStatus() {
    const now = Date.now()
    this.calls = this.calls.filter(time => now - time < this.windowMs)
    const remaining = this.maxCalls - this.calls.length
    const waitTimeLeft = this.waitingUntil ? Math.max(0, this.waitingUntil - now) : 0
    return { used: this.calls.length, remaining, isLimited: remaining <= 0, waitTimeLeft }
  }
}

const rateLimiter = new RateLimiter(60, 60000)

// ============ API HELPERS ============
const PROXY_BASE_URL = 'https://stock-api-proxy-seven.vercel.app/api/finnhub'

const finnhubFetch = async (endpoint, timeout = 10000) => {
  await rateLimiter.throttle()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const endpointParts = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
  const [path, queryString] = endpointParts.split('?')

  let proxyUrl = `${PROXY_BASE_URL}?endpoint=${path}`
  if (queryString) {
    proxyUrl += `&${queryString}`
  }

  console.log('finnhubFetch - endpoint:', endpoint)
  console.log('finnhubFetch - proxyUrl:', proxyUrl)

  try {
    const response = await fetch(proxyUrl, { signal: controller.signal })
    clearTimeout(timeoutId)

    console.log('finnhubFetch - response status:', response.status)

    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment.')
    }
    if (!response.ok) {
      const errorText = await response.text()
      console.error('finnhubFetch - error response:', errorText)
      throw new Error(`API Error: ${response.status}`)
    }
    const data = await response.json()
    console.log('finnhubFetch - data:', data)
    return data
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
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

  // Step 0 = Welcome, Step 5 = Finish (both centered modals)
  const steps = [
    {
      type: 'welcome',
      title: 'Welcome to Stock Research Hub!',
      description: 'Your personal dashboard for stock research, AI-powered insights, and real-time market news.',
      emoji: '🚀'
    },
    {
      type: 'highlight',
      target: '[data-tour="overview"]',
      title: 'Market Overview',
      description: 'Track major indices like S&P 500 and see trending stocks at a glance.',
      position: 'bottom'
    },
    {
      type: 'highlight',
      target: '[data-tour="watchlist"]',
      title: 'Your Watchlist',
      description: 'Build and monitor your personal list of stocks. Add any stock you want to track.',
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
      const data = await finnhubFetch(`/search?q=${encodeURIComponent(q)}`)
      const resultArray = data && Array.isArray(data.result) ? data.result : []
      setResults(resultArray.slice(0, 6).map(r => ({ symbol: r.symbol, name: r.description })))
      setSelectedIndex(0)
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, 250), [])

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
    { id: 'overview', label: 'Home', icon: Home },
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'insights', label: 'AI', icon: Brain },
    { id: 'settings', label: 'More', icon: Settings }
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800/95 backdrop-blur-lg border-t border-gray-700 z-40 safe-area-pb">
      <div className="flex items-center justify-around py-2">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setActivePage(item.id)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all ${
              activePage === item.id ? 'text-blue-500' : 'text-gray-400'
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
    { id: 'overview', label: 'Overview', icon: Home, tour: 'overview' },
    { id: 'watchlist', label: 'Watchlist', icon: Star, tour: 'watchlist' },
    { id: 'explore', label: 'Movers', icon: TrendingUp, tour: 'movers' },
    { id: 'insights', label: 'AI Insights', icon: Brain, tour: 'insights' },
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
            <div className="hidden sm:flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-gray-700/50 text-gray-300">
              <Activity className="w-3 h-3" />
              <span>{rateLimitStatus.remaining}/60</span>
            </div>
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

// ============ MARKET OVERVIEW ============
function MarketOverview({ onSelectStock, darkMode }) {
  const [marketData, setMarketData] = useState({})
  const [trendingData, setTrendingData] = useState({})
  const [loading, setLoading] = useState(true)
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM']
  const trending = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN', 'AMD']

  const fetchData = useCallback(async () => {
    setLoading(true)
    const market = {}, trend = {}
    for (const symbol of [...indices, ...trending]) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`)
        if (data && typeof data.c === 'number') {
          if (indices.includes(symbol)) market[symbol] = { ...data, timestamp: new Date() }
          else trend[symbol] = { ...data, timestamp: new Date() }
        }
      } catch {}
    }
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

// ============ STOCK DETAIL MODAL ============
function StockDetail({ symbol, onClose, darkMode }) {
  const [quote, setQuote] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNews, setShowNews] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [q, p] = await Promise.all([
          finnhubFetch(`/quote?symbol=${symbol}`),
          finnhubFetch(`/stock/profile2?symbol=${symbol}`)
        ])
        setQuote({ ...q, timestamp: new Date() })
        setProfile(p)
      } catch {}
      finally { setLoading(false) }
    }
    fetchData()
  }, [symbol])

  const change = quote ? quote.c - quote.pc : 0
  const pctChange = quote?.pc ? (change / quote.pc) * 100 : 0
  const positive = change >= 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-gray-700 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {profile?.logo && <img src={profile.logo} alt={symbol} className="w-12 h-12 rounded-xl bg-white p-1" />}
            <div>
              <h2 className="text-xl font-bold text-white">{symbol}</h2>
              <p className="text-gray-400">{profile?.name || 'Loading...'}</p>
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
            <div className="rounded-xl p-6 bg-gradient-to-br from-gray-700/50 to-gray-800/50">
              <div className="flex items-baseline gap-4 flex-wrap">
                <span className="text-4xl font-bold text-white">{formatCurrency(quote?.c)}</span>
                <span className={`text-lg font-medium px-3 py-1 rounded-full ${positive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {positive ? '+' : ''}{pctChange.toFixed(2)}%
                </span>
              </div>
              {quote?.timestamp && (
                <div className="text-sm mt-2 flex items-center gap-1 text-gray-400">
                  <Clock className="w-4 h-4" /> {formatTimestamp(quote.timestamp)}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{ label: 'Open', value: quote?.o }, { label: 'High', value: quote?.h }, { label: 'Low', value: quote?.l }, { label: 'Prev Close', value: quote?.pc }].map(item => (
                <div key={item.label} className="rounded-lg p-4 bg-gray-700/30">
                  <div className="text-sm text-gray-400">{item.label}</div>
                  <div className="font-medium text-white">{formatCurrency(item.value)}</div>
                </div>
              ))}
            </div>

            {profile && (
              <div className="rounded-xl p-6 bg-gray-700/30">
                <h3 className="text-lg font-semibold mb-4 text-white">Company Info</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-400">Industry:</span> <span className="text-white">{profile.finnhubIndustry || 'N/A'}</span></div>
                  <div><span className="text-gray-400">Market Cap:</span> <span className="text-white">{formatLargeNumber((profile.marketCapitalization || 0) * 1e6)}</span></div>
                  <div><span className="text-gray-400">Exchange:</span> <span className="text-white">{profile.exchange || 'N/A'}</span></div>
                  <div><span className="text-gray-400">Country:</span> <span className="text-white">{profile.country || 'N/A'}</span></div>
                </div>
              </div>
            )}
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
    for (const symbol of watchlist) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`)
        if (data && typeof data.c === 'number') {
          newQuotes[symbol] = { ...data, timestamp: new Date() }
        }
      } catch {}
    }
    setQuotes(newQuotes)
    setLoading(false)
  }, [watchlist])

  useEffect(() => { fetchQuotes(); const interval = setInterval(fetchQuotes, 60000); return () => clearInterval(interval) }, [fetchQuotes])

  const addSymbol = async (symbol) => {
    if (watchlist.includes(symbol)) { addToast('Already in watchlist', 'error'); return }
    try {
      const data = await finnhubFetch(`/quote?symbol=${symbol}`)
      if (!data || (data.c === 0 && data.h === 0)) { addToast('Invalid symbol', 'error'); return }
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
    for (const symbol of popularStocks) {
      try {
        const data = await finnhubFetch(`/quote?symbol=${symbol}`)
        if (data && typeof data.c === 'number' && data.pc) {
          const change = ((data.c - data.pc) / data.pc) * 100
          stockData.push({ symbol, price: data.c, change })
        }
      } catch {}
    }
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

  // Initial stocks (reduced to prevent rate limit)
  const INITIAL_MOVERS = ['AAPL', 'MSFT', 'NVDA']
  const MORE_MOVERS = ['GOOGL', 'AMZN', 'TSLA', 'META', 'SPY', 'QQQ']
  const MAX_WATCHLIST_STOCKS = 3

  const tabs = [
    { id: 'movers', label: 'Market Movers', icon: TrendingUp },
    { id: 'watchlist', label: 'Your Watchlist', icon: Star },
    { id: 'trending', label: 'Trending', icon: Zap }
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

  // Initial fetch
  const fetchNews = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setHasMore(true)

    // Clear cache on force refresh
    if (forceRefresh) {
      newsCache.data = {}
      newsCache.timestamps = {}
    }

    let stocksToFetch = []
    let moreAvailable = false

    if (tab === 'movers') {
      stocksToFetch = INITIAL_MOVERS
      moreAvailable = true
    } else if (tab === 'watchlist') {
      stocksToFetch = (watchlist || []).slice(0, MAX_WATCHLIST_STOCKS)
      moreAvailable = false
    } else if (tab === 'trending') {
      stocksToFetch = INITIAL_MOVERS // Use same as movers for trending
      moreAvailable = true
    }

    setLoadedStocks(stocksToFetch)
    setHasMore(moreAvailable)

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
  }, [tab, watchlist, fetchMultipleStockNews])

  // Load more news
  const loadMoreNews = useCallback(async () => {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)

    const additionalStocks = MORE_MOVERS.filter(s => !loadedStocks.includes(s)).slice(0, 3)

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
    const remaining = MORE_MOVERS.filter(s => !allLoaded.includes(s))
    setHasMore(remaining.length > 0)

    setLoadingMore(false)
  }, [loadingMore, hasMore, loadedStocks, news, fetchMultipleStockNews])

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

      {/* No news state */}
      {!loading && news.length === 0 && (tab !== 'watchlist' || (watchlist && watchlist.length > 0)) && (
        <div className="rounded-xl p-12 border text-center bg-gray-800/50 border-gray-700">
          <Newspaper className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium mb-2 text-gray-300">No news found</h3>
          <p className="text-gray-400">Try refreshing or check back later</p>
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
  const [activePage, setActivePage] = useState('overview')
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
  const [rateLimitStatus, setRateLimitStatus] = useState({ used: 0, remaining: 60, isLimited: false, waitTimeLeft: 0 })
  const [dismissedSyncBanner, setDismissedSyncBanner] = useState(() => sessionStorage.getItem('dismissed_sync_banner') === 'true')

  const watchlistSync = useCloudSync('watchlist', watchlist, setWatchlist, user)
  const settingsSync = useCloudSync('settings', settings, setSettings, user)

  const syncStatus = {
    synced: user ? (watchlistSync.synced && settingsSync.synced) : false,
    syncing: user ? (watchlistSync.syncing || settingsSync.syncing) : false
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
      <DesktopNav activePage={activePage} setActivePage={setActivePage} rateLimitStatus={rateLimitStatus}
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

      {rateLimitStatus.isLimited && (
        <div className="border-b bg-yellow-900/20 border-yellow-500/30">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-center gap-3">
            <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
            <span className="text-sm text-yellow-300">
              Rate limit reached. Waiting {Math.ceil(rateLimitStatus.waitTimeLeft / 1000)}s...
            </span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activePage === 'overview' && <MarketOverview onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'watchlist' && <Watchlist watchlist={watchlist} setWatchlist={setWatchlist} onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'explore' && <MarketMovers onSelectStock={setSelectedStock} darkMode={darkMode} />}
        {activePage === 'insights' && <AIInsights darkMode={darkMode} finnhubFetch={finnhubFetch} />}
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
