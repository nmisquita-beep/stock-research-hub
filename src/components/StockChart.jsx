import { useEffect, useRef, useState } from 'react'
import { createChart } from 'lightweight-charts'
import { BarChart2, TrendingUp, Minus } from 'lucide-react'

const TIME_RANGES = [
  { label: '1D', days: 1, resolution: '5' },
  { label: '1W', days: 7, resolution: '15' },
  { label: '1M', days: 30, resolution: '60' },
  { label: '3M', days: 90, resolution: 'D' },
  { label: '6M', days: 180, resolution: 'D' },
  { label: '1Y', days: 365, resolution: 'D' },
  { label: 'ALL', days: 1825, resolution: 'W' }
]

export default function StockChart({ symbol, apiKey, darkMode, height = 400 }) {
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
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
  const calculateMA = (data, period) => {
    const result = []
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0)
      result.push({ time: data[i].time, value: sum / period })
    }
    return result
  }

  useEffect(() => {
    if (!chartContainerRef.current || !symbol || !apiKey) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        const range = TIME_RANGES.find(r => r.label === timeRange) || TIME_RANGES[3]
        const to = Math.floor(Date.now() / 1000)
        const from = to - (range.days * 24 * 60 * 60)

        const response = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${range.resolution}&from=${from}&to=${to}&token=${apiKey}`
        )
        const data = await response.json()

        if (data.s === 'no_data' || !data.c) {
          setError('No data available for this time range')
          setLoading(false)
          return
        }

        const candles = data.t.map((time, i) => ({
          time: time,
          open: data.o[i],
          high: data.h[i],
          low: data.l[i],
          close: data.c[i],
          volume: data.v[i]
        }))

        setPriceData(candles)

        // Clear existing chart
        if (chartRef.current) {
          chartRef.current.remove()
        }

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
          mainSeries.setData(candles)
        } else if (chartType === 'line') {
          mainSeries = chart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
          })
          mainSeries.setData(candles.map(c => ({ time: c.time, value: c.close })))
        } else {
          mainSeries = chart.addAreaSeries({
            topColor: 'rgba(59, 130, 246, 0.4)',
            bottomColor: 'rgba(59, 130, 246, 0.0)',
            lineColor: '#3b82f6',
            lineWidth: 2,
          })
          mainSeries.setData(candles.map(c => ({ time: c.time, value: c.close })))
        }

        // Add volume
        const volumeSeries = chart.addHistogramSeries({
          color: '#6b7280',
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          scaleMargins: { top: 0.85, bottom: 0 },
        })
        volumeSeries.setData(candles.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        })))

        // Add moving averages
        if (showMA20 && candles.length >= 20) {
          const ma20 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 })
          ma20.setData(calculateMA(candles, 20))
        }
        if (showMA50 && candles.length >= 50) {
          const ma50 = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1 })
          ma50.setData(calculateMA(candles, 50))
        }
        if (showMA200 && candles.length >= 200) {
          const ma200 = chart.addLineSeries({ color: '#ec4899', lineWidth: 1 })
          ma200.setData(calculateMA(candles, 200))
        }

        // Crosshair move handler
        chart.subscribeCrosshairMove((param) => {
          if (param.time) {
            const candle = candles.find(c => c.time === param.time)
            if (candle) {
              setHoverData(candle)
            }
          } else {
            setHoverData(null)
          }
        })

        chart.timeScale().fitContent()
        setLoading(false)
      } catch (err) {
        console.error('Chart error:', err)
        setError('Failed to load chart data')
        setLoading(false)
      }
    }

    fetchData()

    // Resize handler
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [symbol, apiKey, darkMode, timeRange, chartType, showMA20, showMA50, showMA200, height])

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
        <div className="flex items-center gap-1">
          {TIME_RANGES.map(range => (
            <button
              key={range.label}
              onClick={() => setTimeRange(range.label)}
              className={`px-2 py-1 text-xs rounded ${
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
          {/* Chart Type */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setChartType('area')}
              className={`p-1.5 rounded ${chartType === 'area' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Area Chart"
            >
              <TrendingUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('candle')}
              className={`p-1.5 rounded ${chartType === 'candle' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Candlestick Chart"
            >
              <BarChart2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded ${chartType === 'line' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Line Chart"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          {/* Moving Averages */}
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setShowMA20(!showMA20)}
              className={`px-2 py-1 rounded ${showMA20 ? 'bg-amber-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              MA20
            </button>
            <button
              onClick={() => setShowMA50(!showMA50)}
              className={`px-2 py-1 rounded ${showMA50 ? 'bg-purple-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              MA50
            </button>
            <button
              onClick={() => setShowMA200(!showMA200)}
              className={`px-2 py-1 rounded ${showMA200 ? 'bg-pink-500 text-white' : darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
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
          <span>C: {formatPrice(hoverData.close)}</span>
          <span>Vol: {hoverData.volume?.toLocaleString()}</span>
        </div>
      )}

      {/* Chart Container */}
      <div ref={chartContainerRef} className="relative" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`animate-pulse ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading chart...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{error}</div>
          </div>
        )}
      </div>

      {/* Legend */}
      {(showMA20 || showMA50 || showMA200) && (
        <div className={`px-3 py-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex gap-4 text-xs`}>
          {showMA20 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500"></span> MA20</span>}
          {showMA50 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500"></span> MA50</span>}
          {showMA200 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-pink-500"></span> MA200</span>}
        </div>
      )}
    </div>
  )
}
