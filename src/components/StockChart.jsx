import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { BarChart2, TrendingUp, Minus, RefreshCw, AlertCircle } from 'lucide-react'

const TIME_RANGES = [
  { label: '1D', days: 1, resolution: '5' },
  { label: '1W', days: 7, resolution: '15' },
  { label: '1M', days: 30, resolution: '60' },
  { label: '3M', days: 90, resolution: 'D' },
  { label: '6M', days: 180, resolution: 'D' },
  { label: '1Y', days: 365, resolution: 'D' },
  { label: 'ALL', days: 1825, resolution: 'W' }
]

const PROXY_BASE_URL = 'https://stock-api-proxy-seven.vercel.app/api/finnhub'

export default function StockChart({ symbol, darkMode, height = 300 }) {
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const [chartType, setChartType] = useState('area') // 'area', 'candle', 'line'
  const [timeRange, setTimeRange] = useState('3M')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showMA20, setShowMA20] = useState(false)
  const [showMA50, setShowMA50] = useState(false)
  const [showMA200, setShowMA200] = useState(false)
  const [priceData, setPriceData] = useState([])
  const [hoverData, setHoverData] = useState(null)

  // Calculate moving average
  const calculateMA = useCallback((data, period) => {
    if (!data || data.length < period) return []
    const result = []
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + (b.close || 0), 0)
      result.push({ time: data[i].time, value: sum / period })
    }
    return result
  }, [])

  // Fetch and render chart data
  const fetchData = useCallback(async () => {
    if (!symbol) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const range = TIME_RANGES.find(r => r.label === timeRange) || TIME_RANGES[3]
      const to = Math.floor(Date.now() / 1000)
      const from = to - (range.days * 24 * 60 * 60)

      const response = await fetch(
        `${PROXY_BASE_URL}?endpoint=stock/candle&symbol=${symbol}&resolution=${range.resolution}&from=${from}&to=${to}`
      )

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const data = await response.json()

      if (data.s === 'no_data' || !data.c || !Array.isArray(data.c) || data.c.length === 0) {
        setError('No data available for this time range')
        setPriceData([])
        setLoading(false)
        return
      }

      // Validate and transform data
      const candles = []
      for (let i = 0; i < data.t.length; i++) {
        if (data.t[i] && data.o[i] != null && data.h[i] != null && data.l[i] != null && data.c[i] != null) {
          candles.push({
            time: data.t[i],
            open: data.o[i],
            high: data.h[i],
            low: data.l[i],
            close: data.c[i],
            volume: data.v?.[i] || 0
          })
        }
      }

      // Sort by time and remove duplicates
      candles.sort((a, b) => a.time - b.time)
      const uniqueCandles = candles.filter((candle, index, self) =>
        index === self.findIndex(c => c.time === candle.time)
      )

      if (uniqueCandles.length === 0) {
        setError('No valid data points')
        setPriceData([])
        setLoading(false)
        return
      }

      setPriceData(uniqueCandles)
      setLoading(false)
    } catch (err) {
      console.error('Chart data error:', err)
      setError('Failed to load chart data')
      setPriceData([])
      setLoading(false)
    }
  }, [symbol, timeRange])

  // Fetch data when dependencies change
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Create/update chart when data or settings change
  useEffect(() => {
    if (!chartContainerRef.current || priceData.length === 0) return

    // Clean up existing chart
    if (chartRef.current) {
      try {
        chartRef.current.remove()
      } catch (e) {
        console.warn('Error removing chart:', e)
      }
      chartRef.current = null
      seriesRef.current = null
    }

    try {
      // Create new chart
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: height,
        layout: {
          background: { type: 'solid', color: darkMode ? '#1f2937' : '#ffffff' },
          textColor: darkMode ? '#9ca3af' : '#6b7280',
        },
        grid: {
          vertLines: { color: darkMode ? '#374151' : '#e5e7eb' },
          horzLines: { color: darkMode ? '#374151' : '#e5e7eb' },
        },
        crosshair: {
          mode: 1,
        },
        rightPriceScale: {
          borderColor: darkMode ? '#374151' : '#e5e7eb',
        },
        timeScale: {
          borderColor: darkMode ? '#374151' : '#e5e7eb',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      })

      chartRef.current = chart

      // Add main series based on chart type
      let mainSeries
      if (chartType === 'candle') {
        mainSeries = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderDownColor: '#ef4444',
          borderUpColor: '#22c55e',
          wickDownColor: '#ef4444',
          wickUpColor: '#22c55e',
        })
        mainSeries.setData(priceData)
      } else if (chartType === 'line') {
        mainSeries = chart.addLineSeries({
          color: '#3b82f6',
          lineWidth: 2,
        })
        mainSeries.setData(priceData.map(c => ({ time: c.time, value: c.close })))
      } else {
        mainSeries = chart.addAreaSeries({
          topColor: 'rgba(59, 130, 246, 0.4)',
          bottomColor: 'rgba(59, 130, 246, 0.0)',
          lineColor: '#3b82f6',
          lineWidth: 2,
        })
        mainSeries.setData(priceData.map(c => ({ time: c.time, value: c.close })))
      }

      seriesRef.current = mainSeries

      // Add volume if we have volume data
      if (priceData.some(c => c.volume > 0)) {
        const volumeSeries = chart.addHistogramSeries({
          color: '#6b7280',
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          scaleMargins: { top: 0.85, bottom: 0 },
        })
        volumeSeries.setData(priceData.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        })))
      }

      // Add moving averages
      if (showMA20 && priceData.length >= 20) {
        const ma20Data = calculateMA(priceData, 20)
        if (ma20Data.length > 0) {
          const ma20 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 })
          ma20.setData(ma20Data)
        }
      }
      if (showMA50 && priceData.length >= 50) {
        const ma50Data = calculateMA(priceData, 50)
        if (ma50Data.length > 0) {
          const ma50 = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 })
          ma50.setData(ma50Data)
        }
      }
      if (showMA200 && priceData.length >= 200) {
        const ma200Data = calculateMA(priceData, 200)
        if (ma200Data.length > 0) {
          const ma200 = chart.addLineSeries({ color: '#ec4899', lineWidth: 1 })
          ma200.setData(ma200Data)
        }
      }

      // Crosshair move handler
      chart.subscribeCrosshairMove((param) => {
        if (param.time) {
          const candle = priceData.find(c => c.time === param.time)
          if (candle) {
            setHoverData(candle)
          }
        } else {
          setHoverData(null)
        }
      })

      chart.timeScale().fitContent()

    } catch (err) {
      console.error('Chart creation error:', err)
      setError('Failed to render chart')
    }

    return () => {
      if (chartRef.current) {
        try {
          chartRef.current.remove()
        } catch (e) {
          console.warn('Error cleaning up chart:', e)
        }
        chartRef.current = null
        seriesRef.current = null
      }
    }
  }, [priceData, darkMode, chartType, showMA20, showMA50, showMA200, height, calculateMA])

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const formatPrice = (price) => {
    if (price === undefined || price === null) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
  }

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className={`rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      {/* Chart Controls */}
      <div className={`p-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex items-center gap-1 flex-wrap">
          {TIME_RANGES.map(range => (
            <button
              key={range.label}
              onClick={() => setTimeRange(range.label)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                timeRange === range.label
                  ? 'bg-blue-600 text-white'
                  : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={fetchData}
            disabled={loading}
            className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Chart Type */}
          <div className="flex items-center gap-0.5 bg-gray-700/30 rounded-lg p-0.5">
            <button
              onClick={() => setChartType('area')}
              className={`p-1.5 rounded ${chartType === 'area' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'}`}
              title="Area Chart"
            >
              <TrendingUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('candle')}
              className={`p-1.5 rounded ${chartType === 'candle' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'}`}
              title="Candlestick Chart"
            >
              <BarChart2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded ${chartType === 'line' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'}`}
              title="Line Chart"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          {/* Moving Averages */}
          <div className="hidden sm:flex items-center gap-1 text-xs">
            <button
              onClick={() => setShowMA20(!showMA20)}
              className={`px-2 py-1 rounded-lg transition-colors ${showMA20 ? 'bg-amber-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              MA20
            </button>
            <button
              onClick={() => setShowMA50(!showMA50)}
              className={`px-2 py-1 rounded-lg transition-colors ${showMA50 ? 'bg-purple-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              MA50
            </button>
            <button
              onClick={() => setShowMA200(!showMA200)}
              className={`px-2 py-1 rounded-lg transition-colors ${showMA200 ? 'bg-pink-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              MA200
            </button>
          </div>
        </div>
      </div>

      {/* Hover Data */}
      {hoverData && (
        <div className={`px-3 py-2 text-xs flex flex-wrap gap-4 ${darkMode ? 'bg-gray-700/50 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
          <span>{formatDate(hoverData.time)}</span>
          <span>O: {formatPrice(hoverData.open)}</span>
          <span>H: {formatPrice(hoverData.high)}</span>
          <span>L: {formatPrice(hoverData.low)}</span>
          <span className="font-medium">C: {formatPrice(hoverData.close)}</span>
          {hoverData.volume > 0 && <span>Vol: {hoverData.volume?.toLocaleString()}</span>}
        </div>
      )}

      {/* Chart Container */}
      <div ref={chartContainerRef} className="relative" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2">
              <RefreshCw className={`w-5 h-5 animate-spin ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading chart...</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <AlertCircle className={`w-8 h-8 mx-auto mb-2 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{error}</div>
              <button
                onClick={fetchData}
                className={`mt-2 px-3 py-1 text-sm rounded-lg ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      {(showMA20 || showMA50 || showMA200) && priceData.length > 0 && (
        <div className={`px-3 py-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex gap-4 text-xs`}>
          {showMA20 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500"></span> <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>MA20</span></span>}
          {showMA50 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500"></span> <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>MA50</span></span>}
          {showMA200 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-pink-500"></span> <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>MA200</span></span>}
        </div>
      )}
    </div>
  )
}
