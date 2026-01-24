import { useState } from 'react'
import { HelpCircle, Lightbulb, AlertTriangle, Clock } from 'lucide-react'

// Info tooltip component - appears on hover
export function InfoTooltip({ text, darkMode }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className={`p-0.5 rounded-full ${darkMode ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {show && (
        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs rounded-lg shadow-lg z-50 w-56 ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-900 text-white'}`}>
          {text}
          <div className={`absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent ${darkMode ? 'border-t-gray-700' : 'border-t-gray-900'}`}></div>
        </div>
      )}
    </div>
  )
}

// Section explainer - collapsible help section
export function SectionExplainer({ title, description, darkMode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`mb-4 p-3 rounded-lg ${darkMode ? 'bg-blue-900/20 border border-blue-500/30' : 'bg-blue-50 border border-blue-100'}`}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 w-full text-left">
        <Lightbulb className="w-4 h-4 text-blue-400" />
        <span className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>{title}</span>
        <span className={`text-xs ml-auto ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{expanded ? 'Hide' : 'What is this?'}</span>
      </button>
      {expanded && (
        <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{description}</p>
      )}
    </div>
  )
}

// Delayed data badge
export function DelayedBadge({ darkMode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${darkMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'}`}>
      <Clock className="w-3 h-3" />
      15min delay
    </span>
  )
}

// Last updated timestamp
export function LastUpdated({ timestamp, darkMode }) {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return (
    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
      Updated {date.toLocaleTimeString()}
    </span>
  )
}

// Loading skeleton
export function Skeleton({ className }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />
}

// Empty state component
export function EmptyState({ icon: Icon, title, description, action, darkMode }) {
  return (
    <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
      {Icon && <Icon className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />}
      <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{title}</h3>
      {description && <p className={`mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{description}</p>}
      {action}
    </div>
  )
}

// Metric explanations - common financial terms
export const METRIC_EXPLANATIONS = {
  peRatio: "Price-to-Earnings ratio. Compares stock price to earnings per share. Lower often means cheaper, but compare within same industry. A P/E of 15-20 is typical for established companies.",
  marketCap: "Total company value (stock price x shares). Large cap (>$10B) = more stable, Mid cap ($2-10B) = growth potential, Small cap (<$2B) = higher risk/reward.",
  beta: "Measures volatility vs the market. Beta of 1 = moves with market, >1 = more volatile, <1 = less volatile. Tech stocks often have beta >1.",
  week52High: "Highest price in the past year. Stocks near 52-week highs may indicate strength or be overvalued.",
  week52Low: "Lowest price in the past year. Stocks near 52-week lows may be bargains or have fundamental problems.",
  volume: "Number of shares traded. Higher volume = more liquidity and interest. Compare to average volume.",
  avgVolume: "Average daily trading volume over 30 days. Helps identify unusual trading activity.",
  eps: "Earnings Per Share. Company profit divided by shares. Higher is generally better.",
  dividend: "Cash payment to shareholders. Dividend yield is annual dividend / stock price.",
  rsi: "Relative Strength Index. Measures momentum. Above 70 = overbought (may fall), below 30 = oversold (may rise).",
  movingAverage: "Average price over a period. 50-day and 200-day are common. Price above MA = bullish trend.",
  supportResistance: "Support is a price floor where buying increases. Resistance is a ceiling where selling increases.",
  sentiment: "Market mood based on news, social media, and trading patterns. Bullish = optimistic, Bearish = pessimistic."
}

// Sentiment badge with explanation
export function SentimentBadge({ sentiment, darkMode, showExplanation = false }) {
  const config = {
    bullish: {
      color: 'bg-green-500/20 text-green-400',
      label: 'Bullish',
      explanation: 'Positive outlook - news and indicators suggest price may rise'
    },
    bearish: {
      color: 'bg-red-500/20 text-red-400',
      label: 'Bearish',
      explanation: 'Negative outlook - news and indicators suggest price may fall'
    },
    neutral: {
      color: 'bg-gray-500/20 text-gray-400',
      label: 'Neutral',
      explanation: 'Mixed signals - no strong direction indicated'
    }
  }

  const { color, label, explanation } = config[sentiment] || config.neutral

  return (
    <div className="inline-flex items-center gap-1">
      <span className={`px-2 py-0.5 rounded-full text-xs ${color}`}>{label}</span>
      {showExplanation && <InfoTooltip text={explanation} darkMode={darkMode} />}
    </div>
  )
}

// High Activity explanation card (replaces "Unusual Activity")
export function HighActivityCard({ activities, onSelect, darkMode }) {
  if (!activities || activities.length === 0) return null

  return (
    <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-purple-900/20 to-gray-800 border-purple-500/30' : 'bg-purple-50 border-purple-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-purple-400" />
        <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Stocks in Motion</h3>
        <InfoTooltip
          text="These stocks have unusually high trading activity today. This means lots of people are buying or selling - worth investigating why!"
          darkMode={darkMode}
        />
      </div>
      <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Higher than normal trading volume detected
      </p>
      <div className="space-y-2">
        {activities.slice(0, 3).map((item, i) => (
          <button
            key={i}
            onClick={() => onSelect(item.symbol)}
            className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-purple-100'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.symbol}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400`}>
                {item.volumeRatio ? `${item.volumeRatio}x volume` : 'High activity'}
              </span>
            </div>
            <span className={`text-sm ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {item.change >= 0 ? '+' : ''}{item.change?.toFixed(1)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Market status indicator
export function MarketStatus({ darkMode }) {
  const now = new Date()
  const hours = now.getUTCHours()
  const minutes = now.getUTCMinutes()
  const day = now.getUTCDay()

  // Convert to EST (UTC-5 or UTC-4 during DST)
  const estHours = (hours - 5 + 24) % 24

  let status = 'closed'
  let label = 'Market Closed'
  let color = 'bg-gray-500'

  // Weekday check
  if (day >= 1 && day <= 5) {
    if (estHours >= 4 && estHours < 9.5) {
      status = 'premarket'
      label = 'Pre-Market'
      color = 'bg-yellow-500'
    } else if (estHours >= 9.5 && estHours < 16) {
      status = 'open'
      label = 'Market Open'
      color = 'bg-green-500'
    } else if (estHours >= 16 && estHours < 20) {
      status = 'afterhours'
      label = 'After Hours'
      color = 'bg-orange-500'
    }
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
      <span className={`w-2 h-2 rounded-full ${color} ${status === 'open' ? 'animate-pulse' : ''}`}></span>
      <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
    </div>
  )
}

// Disclaimer footer
export function DisclaimerFooter({ darkMode }) {
  return (
    <div className={`mt-8 p-4 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
      <p className={`text-xs text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        Data is delayed 15 minutes. This app is for informational purposes only and is not financial advice.
        Always do your own research before making investment decisions.
      </p>
    </div>
  )
}

// First time user tip
export function FirstTimeTip({ id, title, description, darkMode, onDismiss }) {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(`tip_dismissed_${id}`) === 'true'
  })

  if (dismissed) return null

  const handleDismiss = () => {
    localStorage.setItem(`tip_dismissed_${id}`, 'true')
    setDismissed(true)
    onDismiss?.()
  }

  return (
    <div className={`mb-4 p-4 rounded-lg border ${darkMode ? 'bg-green-900/20 border-green-500/30' : 'bg-green-50 border-green-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Lightbulb className="w-5 h-5 text-green-400 mt-0.5" />
          <div>
            <h4 className={`font-medium ${darkMode ? 'text-green-300' : 'text-green-800'}`}>{title}</h4>
            <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{description}</p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className={`text-xs ${darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
