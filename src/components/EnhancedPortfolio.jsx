import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import {
  Plus, Trash2, Edit2, Download, TrendingUp, TrendingDown, DollarSign,
  Wallet, PieChart as PieIcon, BarChart3, Search, X, HelpCircle, Lightbulb
} from 'lucide-react'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

// Info tooltip component
function InfoTooltip({ text, darkMode }) {
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
        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs rounded-lg shadow-lg z-50 w-48 ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-900 text-white'}`}>
          {text}
        </div>
      )}
    </div>
  )
}

// Section explanation
function SectionExplainer({ darkMode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`mb-4 p-3 rounded-lg ${darkMode ? 'bg-blue-900/20 border border-blue-500/30' : 'bg-blue-50 border border-blue-100'}`}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 w-full text-left">
        <Lightbulb className="w-4 h-4 text-blue-400" />
        <span className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>About Portfolio Tracker</span>
        <span className={`text-xs ml-auto ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{expanded ? 'Hide' : 'What is this?'}</span>
      </button>
      {expanded && (
        <p className={`mt-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Track your investments by adding positions with purchase price and date.
          See your total portfolio value, gains/losses, and allocation breakdown.
          This is for tracking purposes only - no real trades are made.
        </p>
      )}
    </div>
  )
}

export default function EnhancedPortfolio({ apiKey, darkMode, portfolio, setPortfolio, watchlist = [], finnhubFetch, addToast }) {
  const [quotes, setQuotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [showAddPosition, setShowAddPosition] = useState(false)
  const [editingPosition, setEditingPosition] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  // Form state
  const [formData, setFormData] = useState({
    symbol: '',
    shares: '',
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    notes: ''
  })

  // Safe toast function
  const showToast = (message, type) => {
    if (addToast && typeof addToast === 'function') {
      addToast(message, type)
    }
  }

  // Ensure portfolio has valid structure
  const safePortfolio = {
    cash: portfolio?.cash ?? 0,
    positions: Array.isArray(portfolio?.positions) ? portfolio.positions : [],
    history: Array.isArray(portfolio?.history) ? portfolio.history : []
  }

  // Fetch quotes for all positions
  const fetchQuotes = useCallback(async () => {
    if (!safePortfolio.positions || safePortfolio.positions.length === 0) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const newQuotes = {}
      for (const position of safePortfolio.positions) {
        if (!position?.symbol) continue
        try {
          const data = await finnhubFetch(`/quote?symbol=${position.symbol}`, apiKey)
          if (data && typeof data.c === 'number') {
            newQuotes[position.symbol] = data
          }
        } catch (err) {
          console.warn(`Failed to fetch quote for ${position.symbol}:`, err)
        }
      }
      setQuotes(newQuotes)
    } catch (err) {
      console.error('Error fetching quotes:', err)
      setError('Failed to load some price data')
    } finally {
      setLoading(false)
    }
  }, [safePortfolio.positions, apiKey, finnhubFetch])

  useEffect(() => {
    fetchQuotes()
    const interval = setInterval(fetchQuotes, 60000)
    return () => clearInterval(interval)
  }, [fetchQuotes])

  // Search stocks
  const searchStocks = useCallback(async (query) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const response = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${apiKey}`)
      const data = await response.json()
      setSearchResults((data.result || []).slice(0, 5))
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }, [apiKey])

  useEffect(() => {
    const timer = setTimeout(() => searchStocks(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchStocks])

  // Calculate portfolio metrics
  const calculateMetrics = () => {
    let totalValue = safePortfolio.cash || 0
    let totalCost = 0
    let todayChange = 0

    const positionsWithValues = safePortfolio.positions.map(position => {
      if (!position) return null

      const quote = quotes[position.symbol]
      const currentPrice = quote?.c || position.purchasePrice || 0
      const previousClose = quote?.pc || currentPrice
      const shares = Number(position.shares) || 0
      const purchasePrice = Number(position.purchasePrice) || 0

      const currentValue = currentPrice * shares
      const costBasis = purchasePrice * shares
      const gainLoss = currentValue - costBasis
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0
      const dayChange = (currentPrice - previousClose) * shares

      totalValue += currentValue
      totalCost += costBasis
      todayChange += dayChange

      return {
        ...position,
        currentPrice,
        currentValue,
        costBasis,
        gainLoss,
        gainLossPercent,
        dayChange,
        allocation: 0
      }
    }).filter(Boolean)

    // Calculate allocations
    positionsWithValues.forEach(p => {
      p.allocation = totalValue > 0 ? (p.currentValue / totalValue) * 100 : 0
    })

    const totalGainLoss = totalValue - totalCost - (safePortfolio.cash || 0)
    const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0

    // Find best and worst performers
    const sorted = [...positionsWithValues].sort((a, b) => b.gainLossPercent - a.gainLossPercent)
    const bestPerformer = sorted[0] || null
    const worstPerformer = sorted.length > 1 ? sorted[sorted.length - 1] : null

    return {
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercent,
      todayChange,
      todayChangePercent: totalValue > 0 ? (todayChange / (totalValue - todayChange)) * 100 : 0,
      positions: positionsWithValues,
      bestPerformer,
      worstPerformer,
      cash: safePortfolio.cash || 0
    }
  }

  const metrics = calculateMetrics()

  // Add position
  const handleAddPosition = async () => {
    if (!formData.symbol || !formData.shares || !formData.purchasePrice) {
      showToast('Please fill in all required fields', 'error')
      return
    }

    const newPosition = {
      id: Date.now().toString(),
      symbol: formData.symbol.toUpperCase(),
      shares: parseFloat(formData.shares),
      purchasePrice: parseFloat(formData.purchasePrice),
      purchaseDate: formData.purchaseDate,
      notes: formData.notes
    }

    setPortfolio(prev => ({
      ...prev,
      positions: [...(prev?.positions || []), newPosition]
    }))

    setFormData({ symbol: '', shares: '', purchasePrice: '', purchaseDate: new Date().toISOString().split('T')[0], notes: '' })
    setShowAddPosition(false)
    setSearchQuery('')
    showToast(`Added ${newPosition.symbol} to portfolio`, 'success')
  }

  // Update position
  const handleUpdatePosition = () => {
    if (!editingPosition) return

    setPortfolio(prev => ({
      ...prev,
      positions: (prev?.positions || []).map(p =>
        p.id === editingPosition.id ? { ...editingPosition } : p
      )
    }))

    setEditingPosition(null)
    showToast('Position updated', 'success')
  }

  // Delete position
  const handleDeletePosition = (id) => {
    if (!window.confirm('Remove this position?')) return

    setPortfolio(prev => ({
      ...prev,
      positions: (prev?.positions || []).filter(p => p.id !== id)
    }))
    showToast('Position removed', 'info')
  }

  // Quick add from watchlist
  const handleQuickAdd = async (symbol) => {
    try {
      const quote = await finnhubFetch(`/quote?symbol=${symbol}`, apiKey)
      setFormData({
        symbol,
        shares: '',
        purchasePrice: quote?.c?.toFixed(2) || '',
        purchaseDate: new Date().toISOString().split('T')[0],
        notes: ''
      })
      setShowAddPosition(true)
    } catch {
      showToast('Failed to get current price', 'error')
    }
  }

  // Export portfolio as CSV
  const exportCSV = () => {
    if (metrics.positions.length === 0) {
      showToast('No positions to export', 'error')
      return
    }

    const headers = ['Symbol', 'Shares', 'Purchase Price', 'Purchase Date', 'Notes', 'Current Value', 'Gain/Loss']
    const rows = metrics.positions.map(p => [
      p.symbol,
      p.shares,
      p.purchasePrice,
      p.purchaseDate,
      p.notes || '',
      p.currentValue?.toFixed(2) || '0',
      p.gainLoss?.toFixed(2) || '0'
    ])

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'portfolio.csv'
    a.click()
    URL.revokeObjectURL(url)
    showToast('Portfolio exported', 'success')
  }

  // Pie chart data
  const pieData = metrics.positions.map((p, i) => ({
    name: p.symbol,
    value: p.currentValue || 0,
    color: COLORS[i % COLORS.length]
  })).filter(p => p.value > 0)

  // Safe watchlist
  const safeWatchlist = Array.isArray(watchlist) ? watchlist : []

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Portfolio</h2>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Track your investments and performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddPosition(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Position
          </button>
          {metrics.positions.length > 0 && (
            <button
              onClick={exportCSV}
              className={`p-2.5 rounded-xl transition-colors ${darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'}`}
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <SectionExplainer darkMode={darkMode} />

      {error && (
        <div className={`p-3 rounded-lg ${darkMode ? 'bg-yellow-900/20 border border-yellow-500/30' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className={`text-sm ${darkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>{error}</p>
        </div>
      )}

      {/* Portfolio Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gradient-to-br from-blue-900/30 to-gray-800 border-gray-700' : 'bg-gradient-to-br from-blue-50 to-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-blue-400" />
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Total Value</span>
            <InfoTooltip text="The total current value of all your positions plus available cash" darkMode={darkMode} />
          </div>
          <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {formatCurrency(metrics.totalValue)}
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className={`w-5 h-5 ${metrics.totalGainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`} />
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Total Gain/Loss</span>
            <InfoTooltip text="The difference between your current portfolio value and what you paid for all positions" darkMode={darkMode} />
          </div>
          <div className={`text-2xl font-bold ${metrics.totalGainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.totalGainLoss >= 0 ? '+' : ''}{formatCurrency(metrics.totalGainLoss)}
          </div>
          <div className={`text-sm ${metrics.totalGainLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.totalGainLossPercent >= 0 ? '+' : ''}{metrics.totalGainLossPercent.toFixed(2)}%
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            {metrics.todayChange >= 0 ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Today</span>
          </div>
          <div className={`text-2xl font-bold ${metrics.todayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.todayChange >= 0 ? '+' : ''}{formatCurrency(metrics.todayChange)}
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Cash</span>
          </div>
          <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {formatCurrency(metrics.cash)}
          </div>
        </div>
      </div>

      {/* Allocation Chart & Stats */}
      {metrics.positions.length > 0 && pieData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-4">
              <PieIcon className="w-5 h-5 text-blue-400" />
              <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Allocation</h3>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                      border: darkMode ? '1px solid #374151' : '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: darkMode ? '#fff' : '#000'
                    }}
                    labelStyle={{ color: darkMode ? '#fff' : '#000' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {pieData.map((entry, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></div>
                  <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{entry.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Best/Worst Performers */}
          <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h3 className={`font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Performance Highlights</h3>
            <div className="space-y-4">
              {metrics.bestPerformer && (
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-green-900/20 border border-green-500/20' : 'bg-green-50 border border-green-100'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Best Performer</div>
                      <div className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{metrics.bestPerformer.symbol}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-green-400 font-bold">+{metrics.bestPerformer.gainLossPercent?.toFixed(2) || '0.00'}%</div>
                      <div className="text-green-400 text-sm">+{formatCurrency(metrics.bestPerformer.gainLoss || 0)}</div>
                    </div>
                  </div>
                </div>
              )}
              {metrics.worstPerformer && metrics.worstPerformer !== metrics.bestPerformer && (
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-red-900/20 border border-red-500/20' : 'bg-red-50 border border-red-100'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Worst Performer</div>
                      <div className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{metrics.worstPerformer.symbol}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-red-400 font-bold">{metrics.worstPerformer.gainLossPercent?.toFixed(2) || '0.00'}%</div>
                      <div className="text-red-400 text-sm">{formatCurrency(metrics.worstPerformer.gainLoss || 0)}</div>
                    </div>
                  </div>
                </div>
              )}
              {!metrics.bestPerformer && (
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Add positions to see performance highlights</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Add from Watchlist */}
      {safeWatchlist.length > 0 && (
        <div className={`rounded-xl p-4 border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h3 className={`font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Quick Add from Watchlist</h3>
          <div className="flex flex-wrap gap-2">
            {safeWatchlist.slice(0, 8).map(symbol => (
              <button
                key={symbol}
                onClick={() => handleQuickAdd(symbol)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              >
                + {symbol}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Positions List */}
      {metrics.positions.length > 0 ? (
        <div className={`rounded-xl border overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}>
                <tr>
                  <th className={`text-left p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Symbol</th>
                  <th className={`text-right p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Shares</th>
                  <th className={`text-right p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Avg Cost</th>
                  <th className={`text-right p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Current</th>
                  <th className={`text-right p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Value</th>
                  <th className={`text-right p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Gain/Loss</th>
                  <th className={`text-center p-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {metrics.positions.map((position) => (
                  <tr key={position.id} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700/30' : 'border-gray-100 hover:bg-gray-50'} transition-colors`}>
                    <td className={`p-3 font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {position.symbol}
                      {position.notes && (
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{position.notes}</div>
                      )}
                    </td>
                    <td className={`p-3 text-right ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{position.shares}</td>
                    <td className={`p-3 text-right ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{formatCurrency(position.purchasePrice)}</td>
                    <td className={`p-3 text-right ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{formatCurrency(position.currentPrice)}</td>
                    <td className={`p-3 text-right font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatCurrency(position.currentValue)}</td>
                    <td className={`p-3 text-right ${position.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      <div>{position.gainLoss >= 0 ? '+' : ''}{formatCurrency(position.gainLoss)}</div>
                      <div className="text-xs">{position.gainLossPercent >= 0 ? '+' : ''}{position.gainLossPercent?.toFixed(2) || '0.00'}%</div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditingPosition(position)}
                          className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePosition(position.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl p-12 border text-center ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
          <Wallet className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <h3 className={`text-lg font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>No positions yet</h3>
          <p className={`mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Add your first position to start tracking your investments</p>
          <button
            onClick={() => setShowAddPosition(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
          >
            Add Position
          </button>
        </div>
      )}

      {/* Add Position Modal */}
      {showAddPosition && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowAddPosition(false)}>
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl p-6 max-w-md w-full border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Add Position</h3>
              <button onClick={() => setShowAddPosition(false)} className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Symbol Search */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Symbol *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.symbol || searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value.toUpperCase())
                      setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))
                    }}
                    placeholder="Search symbol..."
                    className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 placeholder-gray-400'}`}
                  />
                  {searchResults.length > 0 && (
                    <div className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-lg z-10 max-h-48 overflow-y-auto ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
                      {searchResults.map((result) => (
                        <button
                          key={result.symbol}
                          onClick={() => {
                            setFormData(prev => ({ ...prev, symbol: result.symbol }))
                            setSearchQuery('')
                            setSearchResults([])
                          }}
                          className={`w-full p-2 text-left transition-colors ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-50'}`}
                        >
                          <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{result.symbol}</span>
                          <span className={`ml-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{result.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Shares *</label>
                  <input
                    type="number"
                    value={formData.shares}
                    onChange={(e) => setFormData(prev => ({ ...prev, shares: e.target.value }))}
                    placeholder="100"
                    className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 placeholder-gray-400'}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Purchase Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.purchasePrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, purchasePrice: e.target.value }))}
                    placeholder="150.00"
                    className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 placeholder-gray-400'}`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Purchase Date</label>
                <input
                  type="date"
                  value={formData.purchaseDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Notes</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 placeholder-gray-400'}`}
                />
              </div>

              <button
                onClick={handleAddPosition}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-colors"
              >
                Add Position
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Position Modal */}
      {editingPosition && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setEditingPosition(null)}>
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl p-6 max-w-md w-full border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Edit {editingPosition.symbol}</h3>
              <button onClick={() => setEditingPosition(null)} className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
                <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Shares</label>
                  <input
                    type="number"
                    value={editingPosition.shares}
                    onChange={(e) => setEditingPosition(prev => ({ ...prev, shares: parseFloat(e.target.value) || 0 }))}
                    className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Purchase Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingPosition.purchasePrice}
                    onChange={(e) => setEditingPosition(prev => ({ ...prev, purchasePrice: parseFloat(e.target.value) || 0 }))}
                    className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Notes</label>
                <input
                  type="text"
                  value={editingPosition.notes || ''}
                  onChange={(e) => setEditingPosition(prev => ({ ...prev, notes: e.target.value }))}
                  className={`w-full px-4 py-2.5 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200'}`}
                />
              </div>

              <button
                onClick={handleUpdatePosition}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
