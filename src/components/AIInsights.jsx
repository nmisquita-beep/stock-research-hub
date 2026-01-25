import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Sparkles, Search, RefreshCw, TrendingUp, TrendingDown, Minus, X, Clock, AlertTriangle, BarChart3, CheckCircle, Target, Zap, Shield, Activity, Award, ArrowUpRight, ArrowDownRight, ChevronRight, ExternalLink } from 'lucide-react'

const GROQ_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/groq'
const YAHOO_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/yahoo'
const FINNHUB_PROXY_URL = 'https://stock-api-proxy-seven.vercel.app/api/finnhub'

// Yahoo Finance API helper
const yahooFetch = async (symbol, type = 'quote', options = {}) => {
  let url = `${YAHOO_PROXY_URL}?symbol=${encodeURIComponent(symbol)}`
  if (type !== 'quote') url += `&type=${type}`
  if (options.range) url += `&range=${options.range}`
  if (options.interval) url += `&interval=${options.interval}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Yahoo API Error: ${response.status}`)
  return await response.json()
}

// Finnhub API helper
const finnhubFetch = async (endpoint, params = {}) => {
  const queryParams = new URLSearchParams(params).toString()
  const url = `${FINNHUB_PROXY_URL}?endpoint=${encodeURIComponent(endpoint)}${queryParams ? '&' + queryParams : ''}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Finnhub API Error: ${response.status}`)
  return await response.json()
}

// Format large numbers
const formatLargeNumber = (value) => {
  if (!value || value === 0 || isNaN(value)) return null
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

// Debounce helper
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Calculate detailed metrics from price/volume data
const calculateMetrics = (prices, volumes, quote) => {
  if (!prices || prices.length === 0) return null

  const currentPrice = prices[prices.length - 1]
  const len = prices.length
  const weekAgo = prices[Math.max(0, len - 5)]
  const monthAgo = prices[Math.max(0, len - 21)]
  const threeMonthAgo = prices[0]

  // Moving averages
  const ma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, len)
  const ma50 = len >= 50 ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 : ma20

  // Volatility (standard deviation)
  const mean = prices.reduce((a, b) => a + b, 0) / len
  const volatility = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / len)

  // Price momentum
  const weekChange = weekAgo > 0 ? ((currentPrice - weekAgo) / weekAgo * 100) : null
  const monthChange = monthAgo > 0 ? ((currentPrice - monthAgo) / monthAgo * 100) : null
  const threeMonthChange = threeMonthAgo > 0 ? ((currentPrice - threeMonthAgo) / threeMonthAgo * 100) : null

  // 52-week position
  const fiftyTwoWeekPosition = quote.fiftyTwoWeekHigh && quote.fiftyTwoWeekLow
    ? ((currentPrice - quote.fiftyTwoWeekLow) / (quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow) * 100)
    : null

  // Volume analysis
  const avgVolume = volumes && volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0
  const recentVolume = volumes && volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : avgVolume
  const volumeTrend = avgVolume > 0 ? ((recentVolume - avgVolume) / avgVolume * 100) : 0

  // Trend detection
  const isUptrend = ma20 > ma50 && currentPrice > ma20
  const isDowntrend = ma20 < ma50 && currentPrice < ma20
  const trend = isUptrend ? 'UPTREND' : isDowntrend ? 'DOWNTREND' : 'SIDEWAYS'

  // Support/resistance from recent prices
  const recentHigh = Math.max(...prices.slice(-20))
  const recentLow = Math.min(...prices.slice(-20))

  // RSI calculation
  let gains = 0, losses = 0
  for (let i = Math.max(0, len - 14); i < len - 1; i++) {
    const change = prices[i + 1] - prices[i]
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / 14
  const avgLoss = losses / 14
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  const rsi = Math.round(100 - (100 / (1 + rs)))

  return {
    currentPrice,
    weekChange: weekChange?.toFixed(2),
    monthChange: monthChange?.toFixed(2),
    threeMonthChange: threeMonthChange?.toFixed(2),
    ma20: ma20.toFixed(2),
    ma50: ma50.toFixed(2),
    volatility: volatility.toFixed(2),
    volatilityPercent: (volatility / mean * 100).toFixed(2),
    fiftyTwoWeekPosition: fiftyTwoWeekPosition?.toFixed(0),
    volumeTrend: volumeTrend.toFixed(0),
    trend,
    recentHigh: recentHigh.toFixed(2),
    recentLow: recentLow.toFixed(2),
    priceVsMa20: ((currentPrice - ma20) / ma20 * 100).toFixed(2),
    priceVsMa50: ((currentPrice - ma50) / ma50 * 100).toFixed(2),
    rsi,
    rsiStatus: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral'
  }
}

// Analyze news for themes and sentiment
const analyzeNews = (news) => {
  if (!news || news.length === 0) return { themes: [], sentiment: 'neutral', headlines: [], positiveCount: 0, negativeCount: 0, totalArticles: 0 }

  const headlines = news.slice(0, 15).map(n => n.headline)

  // Keyword detection for themes
  const themeKeywords = {
    'earnings': ['earnings', 'revenue', 'profit', 'eps', 'quarterly', 'beat', 'miss', 'guidance', 'forecast'],
    'product': ['launch', 'product', 'release', 'announce', 'new', 'unveil', 'introduce', 'rollout'],
    'ai': ['ai', 'artificial intelligence', 'machine learning', 'chatgpt', 'openai', 'llm', 'generative'],
    'legal': ['lawsuit', 'sue', 'legal', 'court', 'settlement', 'regulatory', 'sec', 'ftc', 'doj', 'antitrust'],
    'leadership': ['ceo', 'cfo', 'executive', 'appoint', 'resign', 'hire', 'fired', 'management', 'board'],
    'acquisition': ['acquire', 'merger', 'buy', 'deal', 'takeover', 'acquisition', 'bid'],
    'layoffs': ['layoff', 'cut', 'reduce', 'workforce', 'job', 'restructur', 'downsize'],
    'expansion': ['expand', 'growth', 'market', 'international', 'new market', 'scale'],
    'partnership': ['partner', 'collaboration', 'alliance', 'deal', 'agreement', 'joint venture'],
    'competition': ['compet', 'rival', 'market share', 'versus', 'against', 'battle']
  }

  const detectedThemes = []
  const headlineLower = headlines.join(' ').toLowerCase()

  for (const [theme, keywords] of Object.entries(themeKeywords)) {
    if (keywords.some(kw => headlineLower.includes(kw))) {
      detectedThemes.push(theme)
    }
  }

  // Sentiment detection
  const positiveWords = ['beat', 'surge', 'soar', 'gain', 'rise', 'growth', 'strong', 'bullish', 'upgrade', 'buy', 'outperform', 'record', 'profit', 'success', 'breakthrough', 'rally', 'jump', 'boom']
  const negativeWords = ['miss', 'fall', 'drop', 'decline', 'down', 'weak', 'bearish', 'downgrade', 'sell', 'underperform', 'crash', 'plunge', 'loss', 'fail', 'concern', 'risk', 'slump', 'tumble', 'cut']

  let positiveCount = 0
  let negativeCount = 0

  positiveWords.forEach(w => {
    positiveCount += (headlineLower.match(new RegExp(`\\b${w}`, 'gi')) || []).length
  })
  negativeWords.forEach(w => {
    negativeCount += (headlineLower.match(new RegExp(`\\b${w}`, 'gi')) || []).length
  })

  const sentiment = positiveCount > negativeCount + 2 ? 'positive'
    : negativeCount > positiveCount + 2 ? 'negative'
    : 'mixed'

  return {
    themes: detectedThemes.slice(0, 5),
    sentiment,
    headlines: headlines.slice(0, 8),
    positiveCount,
    negativeCount,
    totalArticles: news.length
  }
}

// Company context for major stocks
const getCompanyContext = (symbol) => {
  const contexts = {
    'AAPL': 'Apple Inc. Consumer electronics giant. Key products: iPhone (50%+ revenue), Mac, iPad, Services (App Store, iCloud, Apple Music), Wearables (Watch, AirPods). CEO Tim Cook. Focus: AI integration, Vision Pro AR/VR, Services growth. Risks: iPhone dependency, China exposure, regulatory scrutiny. Market cap leader.',
    'MSFT': 'Microsoft. Enterprise software leader. Key: Azure (cloud #2 behind AWS), Office 365, Windows, LinkedIn, Gaming (Xbox, Activision). CEO Satya Nadella. Focus: AI (OpenAI partnership, Copilot integration), Cloud growth. Risks: Cloud competition with AWS/Google, PC market decline.',
    'GOOGL': 'Alphabet/Google. Digital advertising dominance (80%+ search market share). Key: Search, YouTube, Google Cloud (growing fast), Android, Waymo (autonomous vehicles). CEO Sundar Pichai. Focus: AI (Gemini), Cloud growth, YouTube monetization. Risks: AI disruption to search, regulatory antitrust.',
    'AMZN': 'Amazon. E-commerce and cloud leader. Key: E-commerce (40%+ US market), AWS (cloud #1, profit driver), Advertising (fast-growing), Prime ecosystem. CEO Andy Jassy. Focus: AWS growth, cost efficiency, ads. Risks: Retail margin pressure, labor costs, competition.',
    'NVDA': 'NVIDIA. AI chip dominance. Key: Data center GPUs (AI training), Gaming GPUs, AI software (CUDA). CEO Jensen Huang. Focus: AI infrastructure, data center expansion, automotive. Risks: Concentration in AI boom, competition from AMD/Intel/custom chips, China restrictions.',
    'TSLA': 'Tesla. EV and energy leader. Key: Model 3/Y (volume), Model S/X (premium), Energy storage, FSD (Full Self-Driving). CEO Elon Musk. Focus: Volume growth, FSD development, Cybertruck ramp, robotaxi. Risks: Intensifying competition, margin pressure, Musk distraction, execution.',
    'META': 'Meta Platforms. Social media dominance. Key: Facebook, Instagram, WhatsApp, Reality Labs (Quest, metaverse). CEO Mark Zuckerberg. Focus: AI integration, Reels growth, metaverse long-term bet. Risks: TikTok competition, regulatory, metaverse losses ($15B+/year).',
    'NFLX': 'Netflix. Streaming leader with 250M+ subscribers globally. CEO Ted Sarandos. Focus: Ad tier growth, password sharing crackdown revenue, gaming expansion. Risks: Content costs ($17B+/year), streaming wars, market saturation.',
    'AMD': 'Advanced Micro Devices. Chip competitor to Intel and NVIDIA. Key: Ryzen CPUs (consumer), EPYC (server, gaining share), Radeon GPUs, MI300 (AI). CEO Lisa Su. Focus: Data center growth, AI GPU competition. Risks: NVIDIA dominance in AI, Intel recovery.',
    'GOOG': 'Alphabet Class C shares (no voting rights). Same company as GOOGL. Digital advertising, Search, YouTube, Cloud, AI. Trading at slight discount to GOOGL typically.',
    'JPM': 'JPMorgan Chase. Largest US bank by assets. Key: Consumer banking, Investment banking (top tier), Asset management, Trading. CEO Jamie Dimon. Focus: Net interest income, credit quality, technology investment. Risks: Recession, credit losses, regulatory.',
    'V': 'Visa. Payment network leader (60%+ global market). Key: Transaction processing, cross-border payments, new flows (B2B). Focus: New payment flows, crypto/blockchain, emerging markets. Risks: Regulation, Mastercard competition, fintech disruption.',
    'MA': 'Mastercard. Payment network #2 (30%+ global market). Key: Transaction processing, cross-border, analytics. Focus: New payment flows, emerging markets. Risks: Regulation, Visa competition, fintech disruption.',
    'JNJ': 'Johnson & Johnson. Healthcare conglomerate. Key: Pharmaceuticals (60%+ revenue), MedTech devices. Consumer health spun off (Kenvue). Focus: Pharma pipeline, acquisitions. Risks: Patent cliffs, litigation, drug pricing.',
    'UNH': 'UnitedHealth Group. Healthcare giant. Key: Insurance (UnitedHealthcare), Optum (services, PBM, data). Largest US health insurer. Focus: Optum growth, Medicare Advantage. Risks: Regulatory, political risk, competition.',
    'WMT': 'Walmart. Retail giant. Key: US stores (4,700+), E-commerce (Walmart+), International. Largest private employer. Focus: E-commerce growth, automation, advertising. Risks: Amazon competition, labor costs, margin pressure.',
    'PG': 'Procter & Gamble. Consumer staples leader. Key brands: Tide, Pampers, Gillette, Oral-B, Bounty. Dividend aristocrat (65+ years of increases). Focus: Premiumization, emerging markets. Risks: Inflation, private label competition.',
    'HD': 'Home Depot. Home improvement retail #1. Key: 2,300+ stores, Pro customers (growing), e-commerce. Focus: Pro market share, supply chain. Risks: Housing market slowdown, interest rates.',
    'CRM': 'Salesforce. Cloud CRM leader. Key: Sales Cloud, Service Cloud, Marketing Cloud, Slack, Tableau. CEO Marc Benioff. Focus: AI (Einstein), profitability. Risks: Competition (Microsoft, Oracle), growth slowdown.',
    'COST': 'Costco. Membership warehouse retail. Key: Membership model (high renewal 90%+), Kirkland brand. Focus: E-commerce, international expansion. Risks: Inflation, competition, labor.',
    'AVGO': 'Broadcom. Semiconductor and infrastructure software. Key: Data center chips, networking, storage, VMware acquisition. Focus: AI networking, software recurring revenue. Risks: Integration, cyclicality.',
    'LLY': 'Eli Lilly. Pharmaceutical leader. Key drugs: Mounjaro/Zepbound (diabetes/obesity blockbusters), Verzenio (cancer). Focus: Obesity drug ramp, pipeline. Risks: Competition, drug pricing, supply constraints.',
    'NVO': 'Novo Nordisk. Pharmaceutical (Denmark). Key drugs: Ozempic, Wegovy (GLP-1 obesity/diabetes). Leader in diabetes care. Focus: Obesity market expansion, manufacturing scale. Risks: Competition (Lilly), supply, pricing.',
    'ABBV': 'AbbVie. Pharmaceutical. Key drugs: Skyrizi, Rinvoq (immunology, replacing Humira), Botox (Allergan). Focus: Immunology growth, pipeline. Risks: Humira biosimilar competition, patent cliffs.',
    'ORCL': 'Oracle. Enterprise software and cloud. Key: Cloud infrastructure (OCI), Database, ERP (Fusion). CEO Safra Catz. Focus: Cloud growth, AI workloads. Risks: AWS/Azure competition, legacy transition.',
    'MRK': 'Merck. Pharmaceutical. Key drugs: Keytruda (cancer immunotherapy, biggest drug globally), Gardasil (HPV vaccine). Focus: Keytruda indications, pipeline. Risks: Keytruda patent cliff (2028), concentration.',
    'ADBE': 'Adobe. Creative and document software. Key: Creative Cloud (Photoshop, Premiere), Document Cloud (Acrobat), Experience Cloud. Focus: AI (Firefly), pricing power. Risks: Competition, AI disruption to creative tools.',
    'KO': 'Coca-Cola. Beverage leader. Key brands: Coca-Cola, Sprite, Fanta, Minute Maid, Costa Coffee. Dividend king (60+ years of increases). Focus: Premiumization, zero-sugar growth. Risks: Health trends, sugar taxes.',
    'PEP': 'PepsiCo. Beverages and snacks. Key brands: Pepsi, Gatorade, Frito-Lay (Doritos, Lays), Quaker. More diversified than KO with snacks. Focus: Snack growth, emerging markets. Risks: Health trends, competition.',
    'TMO': 'Thermo Fisher Scientific. Life sciences equipment leader. Key: Lab equipment, reagents, clinical trials, pharma services. Focus: Biopharma, diagnostics. Risks: Biotech funding cycles, competition.',
    'INTC': 'Intel. Legacy chip giant in turnaround. Key: PC chips (declining share), Data center, Foundry services (new). CEO Pat Gelsinger. Focus: Foundry, process technology catch-up. Risks: AMD/NVIDIA competition, execution, capital intensity.',
    'DIS': 'Walt Disney. Entertainment conglomerate. Key: Disney+/Hulu (streaming), Parks (profit driver), ESPN, Studios. CEO Bob Iger. Focus: Streaming profitability, parks expansion. Risks: Streaming losses, cord-cutting, content costs.',
    'CSCO': 'Cisco. Networking equipment leader. Key: Routers, switches, security, collaboration (Webex). Focus: Software/subscription transition, security. Risks: Cloud shift, competition, IT spending.',
    'ACN': 'Accenture. IT consulting leader. Key: Consulting, technology services, outsourcing. Global footprint. Focus: AI services, cloud migration. Risks: IT spending cycles, competition.',
    'IBM': 'IBM. Legacy tech in transformation. Key: Hybrid cloud (Red Hat), AI (watsonx), Consulting. CEO Arvind Krishna. Focus: Red Hat growth, AI enterprise. Risks: Declining legacy, competition.',
    'QCOM': 'Qualcomm. Mobile chip leader. Key: Snapdragon (smartphone), 5G modems, licensing (patent royalties). Focus: Auto, IoT diversification, PC chips. Risks: Apple modem development, China risk, smartphone cycle.',
    'NOW': 'ServiceNow. Enterprise workflow software. Key: IT service management, HR, customer service automation. CEO Bill McDermott. Focus: AI automation, platform expansion. Risks: Competition, IT spending.',
    'INTU': 'Intuit. Financial software. Key: TurboTax, QuickBooks (SMB accounting), Credit Karma, Mailchimp. Focus: AI-powered tax/accounting, SMB ecosystem. Risks: Competition, IRS free file threat.',
    'TXN': 'Texas Instruments. Analog semiconductor leader. Key: Analog chips (auto, industrial), embedded processors. Focus: Auto/industrial growth, in-house manufacturing. Risks: Cyclicality, China, inventory.',
    'AMAT': 'Applied Materials. Semiconductor equipment leader. Key: Chip manufacturing equipment, services. Focus: Leading-edge tools, China exposure management. Risks: Cyclicality, China restrictions, competition.',
    'BKNG': 'Booking Holdings. Online travel leader. Key: Booking.com, Priceline, Kayak, OpenTable. Focus: Connected trip, payments. Risks: Economic sensitivity, competition (Airbnb, Google).',
    'ISRG': 'Intuitive Surgical. Robotic surgery leader. Key: da Vinci surgical robots, recurring instruments/services. Focus: Procedure growth, new systems. Risks: Competition entering, capital equipment cycles.',
    'AXP': 'American Express. Premium credit cards. Key: Card fees, travel services, high-spend customers. Focus: Millennial/Gen Z acquisition, travel recovery. Risks: Economic sensitivity, competition, regulation.',
    'SPGI': 'S&P Global. Financial data and ratings. Key: Credit ratings, Market Intelligence (data), Indices (S&P 500). Focus: Data/analytics growth, ESG. Risks: Debt issuance cycles, regulation.',
    'GS': 'Goldman Sachs. Investment bank. Key: Trading, Investment banking, Asset management. CEO David Solomon. Focus: Asset management growth, consumer exit. Risks: Market volatility, trading revenue, regulation.',
    'BLK': 'BlackRock. Asset management giant ($10T+ AUM). Key: iShares ETFs, Aladdin platform. CEO Larry Fink. Focus: ETF flows, Aladdin licensing. Risks: Fee pressure, market downturn, ESG backlash.',
    'BA': 'Boeing. Aerospace and defense. Key: Commercial aircraft (737, 787), Defense, Services. Focus: 737 MAX recovery, quality control, supply chain. Risks: Safety issues, Airbus competition, execution, China.',
    'CAT': 'Caterpillar. Construction and mining equipment. Key: Construction machines, mining trucks, engines. Focus: Infrastructure, electrification. Risks: Cyclicality, commodity prices, China.',
    'DE': 'Deere & Company. Agricultural equipment leader. Key: Tractors, combines, precision agriculture technology. Focus: Precision ag tech, autonomy. Risks: Farm income cycles, commodity prices, interest rates.',
    'RTX': 'RTX Corporation (Raytheon). Defense and aerospace. Key: Missiles (Patriot), Jet engines (Pratt & Whitney), Collins Aerospace. Focus: Defense spending, commercial aero recovery. Risks: Engine issues, government budgets.',
    'UNP': 'Union Pacific. Railroad. Key: Western US freight rail network. Focus: Efficiency (Precision Scheduled Railroading), volume growth. Risks: Economic sensitivity, regulation, labor.',
    'NEE': 'NextEra Energy. Utility and renewables leader. Key: Florida Power & Light (regulated), NextEra Energy Resources (renewables). Focus: Renewables growth, transmission. Risks: Interest rates, policy changes.',
    'T': 'AT&T. Telecom. Key: Wireless (postpaid focus), Fiber broadband. Spun off WarnerMedia. Focus: Wireless growth, fiber expansion, debt reduction. Risks: Competition (Verizon, T-Mobile), capital intensity.',
    'VZ': 'Verizon. Telecom. Key: Wireless (premium network), FiOS. Focus: 5G, fixed wireless, cost efficiency. Risks: Competition, capital intensity, consumer wireless saturation.',
    'CVX': 'Chevron. Oil and gas major. Key: Upstream (production), Downstream (refining), Hess acquisition. Focus: Permian Basin, LNG, lower carbon. Risks: Oil prices, energy transition, Hess litigation.',
    'XOM': 'Exxon Mobil. Largest US oil company. Key: Upstream, Downstream, Chemical, Pioneer acquisition. Focus: Permian Basin, LNG, carbon capture. Risks: Oil prices, energy transition, regulatory.',
    'COP': 'ConocoPhillips. Independent E&P (exploration/production). Key: Permian, Alaska, LNG. Focus: Low-cost production, capital returns. Risks: Oil prices, commodity cycles.',
    'LIN': 'Linde. Industrial gases leader. Key: Oxygen, nitrogen, hydrogen for manufacturing, healthcare. Focus: Clean hydrogen, electronics. Risks: Industrial demand, energy costs.',
    'LOW': 'Lowes. Home improvement retail #2. Key: 1,700+ stores, Pro market (growing). Focus: Pro market share, omnichannel. Risks: Housing market, HD competition, rates.',
    'MCD': 'McDonalds. Fast food leader. Key: 40,000+ global locations, mostly franchised. Focus: Digital/delivery, value menu, international. Risks: Labor costs, competition, consumer sentiment.',
    'SBUX': 'Starbucks. Coffee chain leader. Key: 35,000+ global stores, loyalty program. New CEO Brian Niccol (from Chipotle). Focus: Store experience, China recovery, efficiency. Risks: Competition, labor, China slowdown.',
    'NKE': 'Nike. Athletic footwear/apparel leader. Key: Nike brand, Jordan, Converse. DTC focus. Focus: DTC growth, innovation, China recovery. Risks: Competition (Adidas, On, Hoka), inventory, China.',
    'CMG': 'Chipotle Mexican Grill. Fast casual leader. Key: 3,400+ locations, digital sales. Former CEO Brian Niccol now at Starbucks. Focus: Store growth, throughput. Risks: Food costs, labor, execution post-Niccol.',
    'PANW': 'Palo Alto Networks. Cybersecurity leader. Key: Firewall, cloud security, SOC platform. Focus: Platformization, AI security. Risks: Competition (CrowdStrike), IT spending.',
    'CRWD': 'CrowdStrike. Endpoint security leader. Key: Falcon platform, cloud-native. Focus: Platform expansion, AI. July 2024 outage impact. Risks: Outage reputation, competition, IT spending.',
    'ZS': 'Zscaler. Cloud security (Zero Trust). Key: Secure web gateway, Zero Trust architecture. Focus: Platform expansion, large enterprises. Risks: Competition, IT spending cycles.',
    'SNOW': 'Snowflake. Cloud data platform. Key: Data warehouse, data lake, sharing. Focus: Product expansion, consumption growth. Risks: Databricks competition, IT spending, profitability.',
    'DDOG': 'Datadog. Cloud monitoring/observability. Key: Infrastructure monitoring, APM, logs. Focus: Platform expansion, AI ops. Risks: Competition, IT spending, expansion.',
    'PLTR': 'Palantir. Data analytics/AI platform. Key: Government (Gotham), Commercial (Foundry), AIP (AI). Focus: Commercial growth, AI platform. Risks: Government concentration, profitability, competition.',
    'COIN': 'Coinbase. Crypto exchange. Key: Trading fees, staking, custody, Base blockchain. Focus: Regulatory clarity, stablecoin revenue, Base. Risks: Crypto prices, regulation, competition.',
    'SQ': 'Block (Square). Fintech. Key: Square (merchant services), Cash App (consumer), Bitcoin. CEO Jack Dorsey. Focus: Cash App growth, Bitcoin strategy. Risks: Competition, credit losses, Bitcoin volatility.',
    'PYPL': 'PayPal. Digital payments. Key: PayPal checkout, Venmo, Braintree. Focus: Checkout improvement, Venmo monetization. Risks: Apple Pay competition, growth slowdown.',
    'SHOP': 'Shopify. E-commerce platform. Key: Merchant tools, payments, fulfillment. Focus: Enterprise growth, Shop app. Risks: Amazon competition, SMB sensitivity.',
    'UBER': 'Uber. Ride-hailing and delivery. Key: Mobility, Delivery (Uber Eats), Freight. Focus: Profitability, autonomous partnerships. Risks: Competition (Lyft), driver classification, autonomous disruption.',
    'ABNB': 'Airbnb. Short-term rentals. Key: 7M+ listings globally, Experiences. Focus: Quality, long-term stays, experiences. Risks: Regulation, economic sensitivity, competition.',
    'DASH': 'DoorDash. Food delivery leader (US). Key: Restaurant delivery, grocery, retail. Focus: New verticals, international, advertising. Risks: Competition (Uber), profitability, gig economy regulation.',
    'RBLX': 'Roblox. Gaming/metaverse platform. Key: User-generated games, 70M+ DAU (mostly kids/teens). Focus: Aging up users, advertising, international. Risks: User growth, monetization, safety concerns.',
    'U': 'Unity. Game engine/tools. Key: Game development tools, advertising, monetization. Focus: AI tools, runtime fees. Risks: Competition (Unreal), developer relations.',
    'AI': 'C3.ai. Enterprise AI software. Key: AI applications for enterprise (energy, manufacturing, government). Focus: Generative AI, consumption pricing. Risks: Competition, sales cycles, profitability.',
    'RIVN': 'Rivian. EV startup. Key: R1T truck, R1S SUV, Amazon vans. Focus: Production ramp, cost reduction, R2 development. Risks: Cash burn, competition, execution.',
    'LCID': 'Lucid Motors. Luxury EV startup. Key: Lucid Air sedan, Saudi backing. Focus: Production ramp, Gravity SUV. Risks: Cash burn, competition, limited scale.',
    'F': 'Ford. Legacy automaker. Key: F-150 (bestselling), Mustang, Transit, EVs (F-150 Lightning, Mach-E). Focus: EV transition, cost cuts. Risks: EV losses, UAW costs, competition.',
    'GM': 'General Motors. Legacy automaker. Key: Trucks (Silverado), SUVs, Ultium EVs, Cruise (autonomous). Focus: EV transition, Cruise restart. Risks: EV losses, Cruise challenges, competition.',
    'SOFI': 'SoFi Technologies. Digital bank/fintech. Key: Student loans, personal loans, investing, bank charter. Focus: Bank growth, member ARPU. Risks: Credit quality, competition, rate sensitivity.'
  }

  return contexts[symbol] || `${symbol} - Analyze based on available market data and news. Consider the company's market position, recent developments, and technical setup.`
}

// Build comprehensive AI prompt
const buildComprehensivePrompt = (symbol, quote, metrics, newsAnalysis, news) => {
  const companyInfo = getCompanyContext(symbol)
  const hasNews = newsAnalysis.totalArticles > 0

  return `You are a senior equity research analyst providing an in-depth analysis of ${symbol} (${quote.shortName || quote.longName || symbol}).

=== COMPANY CONTEXT ===
${companyInfo}

=== CURRENT MARKET DATA ===
Price: $${quote.regularMarketPrice?.toFixed(2) || quote.price?.toFixed(2) || 'N/A'}
Today's Change: ${quote.regularMarketChangePercent?.toFixed(2) || 0}%
Market Cap: ${formatLargeNumber(quote.marketCap) || 'N/A'}
P/E Ratio: ${quote.trailingPE?.toFixed(2) || 'N/A'} | Forward P/E: ${quote.forwardPE?.toFixed(2) || 'N/A'}
EPS: $${quote.trailingEps?.toFixed(2) || 'N/A'}
Dividend Yield: ${quote.dividendYield ? (quote.dividendYield * 100).toFixed(2) + '%' : 'None'}

=== TECHNICAL ANALYSIS ===
${metrics ? `Trend: ${metrics.trend}
RSI (14): ${metrics.rsi} (${metrics.rsiStatus})
1-Week Performance: ${metrics.weekChange}%
1-Month Performance: ${metrics.monthChange}%
3-Month Performance: ${metrics.threeMonthChange}%
52-Week Position: ${metrics.fiftyTwoWeekPosition}% (0%=low, 100%=high)
52-Week Range: $${quote.fiftyTwoWeekLow?.toFixed(2) || '?'} - $${quote.fiftyTwoWeekHigh?.toFixed(2) || '?'}
20-Day MA: $${metrics.ma20} (Price is ${metrics.priceVsMa20}% vs MA)
50-Day MA: $${metrics.ma50} (Price is ${metrics.priceVsMa50}% vs MA)
Recent Support: $${metrics.recentLow}
Recent Resistance: $${metrics.recentHigh}
Volatility: ${metrics.volatilityPercent}%
Volume Trend: ${metrics.volumeTrend > 0 ? '+' : ''}${metrics.volumeTrend}% vs average` : 'Limited technical data available'}

${hasNews ? `=== NEWS & SENTIMENT ANALYSIS ===
Total Articles (30 days): ${newsAnalysis.totalArticles}
Detected Themes: ${newsAnalysis.themes.length > 0 ? newsAnalysis.themes.join(', ') : 'General market news'}
News Sentiment: ${newsAnalysis.sentiment.toUpperCase()} (${newsAnalysis.positiveCount} positive vs ${newsAnalysis.negativeCount} negative signals)

Recent Headlines:
${newsAnalysis.headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : '=== NEWS ===\nNo recent company-specific news found.'}

=== YOUR ANALYSIS TASK ===

Provide a DEEP, SPECIFIC analysis. Be opinionated and take a clear stance.

Format your response as JSON with these exact fields:
{
  "verdict": "BULLISH" or "BEARISH" or "NEUTRAL",
  "verdictStrength": "STRONG" or "MODERATE" or "WEAK",
  "confidence": 1-100,
  "summary": "2-3 sentence executive summary of your thesis",
  "whatsHappening": "What's driving the stock right now? Connect news to price action. 2-3 sentences.",
  "bullCase": "The strongest bull argument with specific price target. 2-3 sentences.",
  "bearCase": "The biggest bear risks with downside target. 2-3 sentences.",
  "technicalSetup": "Key support/resistance levels, trend analysis. 2 sentences.",
  "keyLevels": {"support": "$XX.XX", "resistance": "$XX.XX", "stopLoss": "$XX.XX"},
  "catalyst": "What upcoming event could move this stock?",
  "timeHorizon": "Short-term trade, swing trade, or long-term investment?",
  "actionableInsight": "One clear, specific action recommendation"
}

IMPORTANT RULES:
1. Do NOT use asterisks, bullet points, or any markdown formatting
2. Be SPECIFIC - reference actual numbers, prices, percentages from the data
3. Be OPINIONATED - take a clear stance, no wishy-washy hedging
4. Keep each field concise but packed with insight
5. Return ONLY valid JSON, no other text`
}

// Popular stocks for search supplementation
const POPULAR_STOCKS = {
  'A': ['AAPL', 'AMZN', 'AMD', 'ABBV', 'AVGO', 'ADBE', 'ABT', 'ACN', 'ABNB', 'AXP'],
  'B': ['BRK-B', 'BAC', 'BA', 'BMY', 'BLK', 'BKNG', 'BX', 'BSX', 'BIIB', 'BDX'],
  'C': ['COST', 'CRM', 'CVX', 'CSCO', 'C', 'CAT', 'CMCSA', 'COP', 'CI', 'CRWD'],
  'D': ['DIS', 'DHR', 'DE', 'DXCM', 'DUK', 'D', 'DASH', 'DVN', 'DG', 'DKNG'],
  'E': ['XOM', 'ETN', 'EMR', 'ELV', 'EOG', 'ENPH', 'EL', 'EA', 'EW', 'EBAY'],
  'F': ['F', 'FDX', 'FCX', 'FSLR', 'FISV', 'FIS', 'FTNT', 'FI', 'FAST', 'FTV'],
  'G': ['GOOGL', 'GOOG', 'GS', 'GE', 'GM', 'GILD', 'GD', 'GPN', 'GIS', 'GLW'],
  'H': ['HD', 'HON', 'HUM', 'HCA', 'HPQ', 'HSBC', 'HLT', 'HPE', 'HAL', 'HOOD'],
  'I': ['INTC', 'IBM', 'INTU', 'ISRG', 'ICE', 'ITW', 'IDXX', 'IQV', 'IR', 'ILMN'],
  'J': ['JPM', 'JNJ', 'JBHT', 'JCI', 'JD', 'JWN', 'JNPR', 'J', 'JAZZ', 'JLL'],
  'K': ['KO', 'KHC', 'KLAC', 'KMB', 'KMI', 'KDP', 'K', 'KR', 'KSS', 'KEYS'],
  'L': ['LLY', 'LMT', 'LOW', 'LRCX', 'LIN', 'LVS', 'LULU', 'LUV', 'LYFT', 'LEN'],
  'M': ['MSFT', 'META', 'MA', 'MCD', 'MRK', 'MMM', 'MO', 'MS', 'MDLZ', 'MU'],
  'N': ['NVDA', 'NFLX', 'NKE', 'NOW', 'NEE', 'NEM', 'NSC', 'NDAQ', 'NOC', 'NUE'],
  'O': ['ORCL', 'OXY', 'ON', 'ODFL', 'OMC', 'ORLY', 'OKE', 'OTIS', 'O', 'OKTA'],
  'P': ['PG', 'PFE', 'PEP', 'PYPL', 'PM', 'PANW', 'PNC', 'PSX', 'PLD', 'PLTR'],
  'Q': ['QCOM', 'QQQ', 'QRVO', 'QSR'],
  'R': ['RTX', 'REGN', 'ROP', 'ROST', 'RCL', 'RSG', 'RIVN', 'RBLX', 'RF', 'RMD'],
  'S': ['SPY', 'SBUX', 'SCHW', 'SLB', 'SO', 'SNOW', 'SHOP', 'SQ', 'SNAP', 'SOFI'],
  'T': ['TSLA', 'T', 'TGT', 'TMO', 'TXN', 'TJX', 'TMUS', 'TTWO', 'TFC', 'TWLO'],
  'U': ['UNH', 'UPS', 'USB', 'UBER', 'ULTA', 'UAL', 'U', 'URI', 'UNP', 'UPST'],
  'V': ['V', 'VZ', 'VRTX', 'VLO', 'VMW', 'VFC', 'VRSK', 'VOO', 'VTI', 'VNQ'],
  'W': ['WMT', 'WFC', 'WBA', 'WBD', 'WM', 'WDAY', 'W', 'WDC', 'WST', 'WELL'],
  'X': ['XOM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLNX', 'XYL'],
  'Y': ['YUM', 'YELP', 'YUMC'],
  'Z': ['ZTS', 'ZM', 'ZS', 'Z', 'ZG', 'ZBH', 'ZBRA', 'ZI']
}

export default function AIInsights() {
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('ai_analysis_history_v2')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [error, setError] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loadingStep, setLoadingStep] = useState('')
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const isSelectingRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('ai_analysis_history_v2', JSON.stringify(history.slice(0, 5)))
  }, [history])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchStocks = useCallback(debounce(async (q) => {
    if (isSelectingRef.current) return
    if (!q.trim() || q.length < 1) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    setSearchLoading(true)
    try {
      const data = await yahooFetch(q, 'search')
      const items = data?.results || data?.quotes || []
      let results = items
        .filter(r => {
          const itemType = r.type || r.quoteType
          return itemType === 'EQUITY' || itemType === 'ETF'
        })
        .map(r => ({
          symbol: r.symbol,
          name: r.name || r.shortname || r.longname || r.symbol,
          type: r.type || r.quoteType || 'EQUITY'
        }))

      if (results.length < 5 && q.length <= 2) {
        const firstLetter = q.charAt(0).toUpperCase()
        const popularSymbols = POPULAR_STOCKS[firstLetter] || []
        const queryUpper = q.toUpperCase()
        const matchingPopular = popularSymbols
          .filter(sym => sym.startsWith(queryUpper))
          .filter(sym => !results.some(r => r.symbol === sym))
          .map(sym => ({ symbol: sym, name: sym, type: 'EQUITY' }))
        results = [...results, ...matchingPopular]
      }

      const seen = new Set()
      results = results.filter(r => {
        if (seen.has(r.symbol)) return false
        seen.add(r.symbol)
        return true
      }).slice(0, 10)

      if (!isSelectingRef.current) {
        setSearchResults(results)
        setShowDropdown(true)
        setSelectedIndex(0)
      }
    } catch {
      setSearchResults([])
    }
    setSearchLoading(false)
  }, 200), [])

  useEffect(() => {
    if (symbol.length >= 1) {
      searchStocks(symbol)
    } else {
      setSearchResults([])
      setShowDropdown(false)
    }
  }, [symbol, searchStocks])

  const handleKeyDown = (e) => {
    if (!showDropdown || searchResults.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault()
        analyzeStock()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchResults[selectedIndex]) {
        selectStock(searchResults[selectedIndex].symbol)
      } else {
        analyzeStock()
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const selectStock = (sym) => {
    isSelectingRef.current = true
    setShowDropdown(false)
    setSearchResults([])
    setSymbol(sym)
    setTimeout(() => {
      analyzeStock(sym)
      setTimeout(() => { isSelectingRef.current = false }, 500)
    }, 50)
  }

  const analyzeStock = async (stockSymbol) => {
    const sym = (stockSymbol || symbol).toUpperCase().trim()
    if (!sym) return

    setLoading(true)
    setError(null)
    setAnalysisResult(null)
    setShowDropdown(false)
    setLoadingStep('Fetching market data...')

    try {
      // 1. Fetch basic quote data
      const quoteData = await yahooFetch(sym)
      if (!quoteData || (!quoteData.regularMarketPrice && !quoteData.price)) {
        throw new Error(`Invalid symbol: ${sym}`)
      }

      setLoadingStep('Analyzing price history...')

      // 2. Fetch 3-month chart data
      let prices = []
      let volumes = []
      try {
        const chartData = await yahooFetch(sym, 'chart', { range: '3mo', interval: '1d' })
        if (chartData?.chart?.result?.[0]) {
          const result = chartData.chart.result[0]
          prices = (result.indicators?.quote?.[0]?.close || []).filter(c => c !== null && !isNaN(c))
          volumes = (result.indicators?.quote?.[0]?.volume || []).filter(v => v !== null && !isNaN(v))
        } else if (chartData?.data && Array.isArray(chartData.data)) {
          prices = chartData.data.map(d => d.close).filter(Boolean)
          volumes = chartData.data.map(d => d.volume).filter(Boolean)
        }
      } catch (e) {
        console.error('Chart fetch error:', e)
      }

      setLoadingStep('Scanning 30 days of news...')

      // 3. Fetch 30 days of company news
      let news = []
      try {
        const today = new Date()
        const monthAgo = new Date(today - 30 * 24 * 60 * 60 * 1000)
        const newsData = await finnhubFetch('company-news', {
          symbol: sym,
          from: monthAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0]
        })
        if (Array.isArray(newsData)) {
          news = newsData.slice(0, 30)
        }
      } catch (e) {
        console.error('News fetch error:', e)
      }

      setLoadingStep('Calculating technical indicators...')

      // 4. Calculate detailed metrics
      const metrics = calculateMetrics(prices, volumes, quoteData)

      // 5. Analyze news sentiment & themes
      const newsAnalysis = analyzeNews(news)

      setLoadingStep('Running deep AI analysis...')

      // 6. Build comprehensive prompt
      const prompt = buildComprehensivePrompt(sym, quoteData, metrics, newsAnalysis, news)

      // 7. Call Groq API
      const response = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          stockData: { symbol: sym, ...quoteData },
          maxTokens: 1500
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'AI analysis failed')
      }

      const data = await response.json()
      if (!data || !data.insight) {
        throw new Error('No analysis generated')
      }

      // Parse AI response
      let aiJson = null
      try {
        const jsonMatch = data.insight.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          aiJson = JSON.parse(jsonMatch[0])
        }
      } catch (e) {
        console.error('JSON parse error:', e)
      }

      const result = {
        symbol: sym,
        name: quoteData.shortName || quoteData.longName || sym,
        quote: {
          price: quoteData.regularMarketPrice ?? quoteData.price ?? 0,
          change: quoteData.regularMarketChange ?? quoteData.change ?? 0,
          changePercent: quoteData.regularMarketChangePercent ?? quoteData.changePercent ?? 0,
          marketCap: quoteData.marketCap,
          peRatio: quoteData.trailingPE,
          forwardPE: quoteData.forwardPE,
          eps: quoteData.trailingEps,
          dividendYield: quoteData.dividendYield,
          fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow,
          beta: quoteData.beta,
          volume: quoteData.regularMarketVolume,
          avgVolume: quoteData.averageDailyVolume3Month
        },
        metrics,
        newsAnalysis,
        news: news.slice(0, 10),
        aiJson,
        rawInsight: data.insight,
        timestamp: new Date().toISOString()
      }

      setAnalysisResult(result)
      setHistory(prev => {
        const filtered = prev.filter(h => h.symbol !== sym)
        return [result, ...filtered].slice(0, 10)
      })
      setSymbol('')

    } catch (err) {
      console.error('Analysis error:', err)
      setError(err.message || 'Failed to analyze stock. Please try again.')
    }

    setLoading(false)
    setLoadingStep('')
  }

  const getVerdictDisplay = (verdict, strength) => {
    const v = (verdict || '').toUpperCase()
    const s = (strength || '').toUpperCase()

    if (v === 'BULLISH') {
      if (s === 'STRONG') return { icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500', label: 'STRONG BUY', gradient: 'from-emerald-600 to-green-500' }
      return { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500', label: 'BUY', gradient: 'from-green-600 to-green-500' }
    }
    if (v === 'BEARISH') {
      if (s === 'STRONG') return { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500', label: 'STRONG SELL', gradient: 'from-red-600 to-red-500' }
      return { icon: TrendingDown, color: 'text-orange-400', bg: 'bg-orange-500/20', border: 'border-orange-500', label: 'SELL', gradient: 'from-orange-600 to-red-500' }
    }
    return { icon: Minus, color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500', label: 'HOLD', gradient: 'from-yellow-600 to-amber-500' }
  }

  const v = analysisResult?.aiJson ? getVerdictDisplay(analysisResult.aiJson.verdict, analysisResult.aiJson.verdictStrength) : null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500">
              <Brain className="w-6 h-6 text-white" />
            </div>
            AI Deep Analysis
          </h2>
          <p className="text-gray-400 mt-2">Professional-grade research with technical, fundamental, and sentiment analysis.</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative" ref={dropdownRef} data-tour="ai-search">
        <div className="flex items-center gap-3 p-4 rounded-xl border transition-all bg-gray-800/80 border-gray-700 focus-within:border-purple-500 focus-within:bg-gray-800">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onFocus={() => symbol.length >= 1 && searchResults.length > 0 && setShowDropdown(true)}
            placeholder="Enter any stock symbol (AAPL, MSFT, NVDA...)"
            className="flex-1 bg-transparent outline-none text-lg text-white placeholder-gray-500"
            disabled={loading}
          />
          {searchLoading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
          <button
            type="button"
            onClick={() => analyzeStock()}
            disabled={loading || !symbol.trim()}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all ${
              loading || !symbol.trim()
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg shadow-purple-500/25'
            }`}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {/* Autocomplete */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-xl border border-gray-700 shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
            {searchResults.map((item, i) => (
              <button
                key={item.symbol}
                onClick={() => selectStock(item.symbol)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                  i === selectedIndex ? 'bg-purple-600/30' : 'hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-bold text-white">{item.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                    item.type === 'ETF' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {item.type}
                  </span>
                  <span className="text-gray-400 text-sm truncate">{item.name}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Analysis Failed</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-12 text-center border border-purple-500/30">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/20"></div>
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center text-4xl">🔍</div>
          </div>
          <div className="text-xl font-semibold text-white mb-2">Analyzing {symbol}...</div>
          <div className="text-purple-400 animate-pulse mb-6">{loadingStep}</div>
          <div className="flex flex-col items-center gap-2 text-sm text-gray-500">
            <p>Fetching real-time market data</p>
            <p>Scanning 30 days of news coverage</p>
            <p>Generating deep AI analysis</p>
          </div>
        </div>
      )}

      {/* Analysis Result */}
      {analysisResult && !loading && (
        <div className="space-y-5">
          {/* Hero Verdict Card */}
          <div className={`rounded-2xl border-2 ${v?.border} overflow-hidden`}>
            {/* Verdict Banner */}
            <div className={`bg-gradient-to-r ${v?.gradient} px-5 py-4 flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                {v && <v.icon className="w-7 h-7 text-white" />}
                <span className="text-white font-bold text-xl tracking-wide">{v?.label}</span>
                {analysisResult.aiJson?.confidence && (
                  <span className="bg-white/20 px-3 py-1 rounded-full text-white text-sm font-medium">
                    {analysisResult.aiJson.confidence}% confidence
                  </span>
                )}
              </div>
              <button onClick={() => setAnalysisResult(null)} className="p-2 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={`p-6 ${v?.bg}`}>
              {/* Stock Header */}
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-3xl font-bold text-white mb-1">{analysisResult.symbol}</h3>
                  <p className="text-gray-300 text-lg">{analysisResult.name}</p>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-3xl font-bold text-white">${analysisResult.quote?.price?.toFixed(2)}</div>
                  {(() => {
                    const pct = analysisResult.quote?.changePercent ?? 0
                    const positive = pct >= 0
                    return (
                      <div className={`text-lg font-semibold flex items-center gap-1 md:justify-end ${positive ? 'text-green-400' : 'text-red-400'}`}>
                        {positive ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        {positive ? '+' : ''}{pct.toFixed(2)}% today
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {analysisResult.metrics?.weekChange && (
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <div className={`text-xl font-bold ${parseFloat(analysisResult.metrics.weekChange) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {parseFloat(analysisResult.metrics.weekChange) >= 0 ? '+' : ''}{analysisResult.metrics.weekChange}%
                    </div>
                    <div className="text-xs text-gray-400 mt-1">1 Week</div>
                  </div>
                )}
                {analysisResult.metrics?.monthChange && (
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <div className={`text-xl font-bold ${parseFloat(analysisResult.metrics.monthChange) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {parseFloat(analysisResult.metrics.monthChange) >= 0 ? '+' : ''}{analysisResult.metrics.monthChange}%
                    </div>
                    <div className="text-xs text-gray-400 mt-1">1 Month</div>
                  </div>
                )}
                {analysisResult.metrics?.fiftyTwoWeekPosition && (
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-white">{analysisResult.metrics.fiftyTwoWeekPosition}%</div>
                    <div className="text-xs text-gray-400 mt-1">52W Position</div>
                  </div>
                )}
                {analysisResult.metrics?.trend && (
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <div className={`text-lg font-bold ${
                      analysisResult.metrics.trend === 'UPTREND' ? 'text-green-400' :
                      analysisResult.metrics.trend === 'DOWNTREND' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {analysisResult.metrics.trend}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">Trend</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* News Themes Tags - only show if we have news */}
          {analysisResult.newsAnalysis?.totalArticles > 0 && (
            <div className="flex flex-wrap gap-2">
              {analysisResult.newsAnalysis.themes?.length > 0 && analysisResult.newsAnalysis.themes.map(theme => (
                <span key={theme} className="px-3 py-1.5 bg-purple-900/50 text-purple-300 rounded-full text-sm font-medium">
                  #{theme}
                </span>
              ))}
              <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                analysisResult.newsAnalysis.sentiment === 'positive' ? 'bg-green-900/50 text-green-300' :
                analysisResult.newsAnalysis.sentiment === 'negative' ? 'bg-red-900/50 text-red-300' :
                'bg-gray-700 text-gray-300'
              }`}>
                {analysisResult.newsAnalysis.sentiment} news sentiment
              </span>
              <span className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded-full text-sm">
                {analysisResult.newsAnalysis.totalArticles} articles analyzed
              </span>
            </div>
          )}

          {/* AI Analysis Section */}
          {analysisResult.aiJson && (
            <div className="space-y-4">
              {/* Executive Summary */}
              {analysisResult.aiJson.summary && (
                <div className="rounded-2xl bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-500/30 p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-purple-300 mb-2">Executive Summary</h4>
                      <p className="text-gray-200 text-lg leading-relaxed">{analysisResult.aiJson.summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* What's Happening */}
              {analysisResult.aiJson.whatsHappening && (
                <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-5 h-5 text-blue-400" />
                    <h4 className="font-semibold text-white">What's Happening Now</h4>
                  </div>
                  <p className="text-gray-300 leading-relaxed">{analysisResult.aiJson.whatsHappening}</p>
                </div>
              )}

              {/* Bull vs Bear Case */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysisResult.aiJson.bullCase && (
                  <div className="rounded-xl bg-green-900/20 border border-green-500/30 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                      <h4 className="font-semibold text-green-400">The Bull Case</h4>
                    </div>
                    <p className="text-gray-300 leading-relaxed">{analysisResult.aiJson.bullCase}</p>
                  </div>
                )}
                {analysisResult.aiJson.bearCase && (
                  <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingDown className="w-5 h-5 text-red-400" />
                      <h4 className="font-semibold text-red-400">The Bear Case</h4>
                    </div>
                    <p className="text-gray-300 leading-relaxed">{analysisResult.aiJson.bearCase}</p>
                  </div>
                )}
              </div>

              {/* Technical Setup & Key Levels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysisResult.aiJson.technicalSetup && (
                  <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="w-5 h-5 text-purple-400" />
                      <h4 className="font-semibold text-white">Technical Setup</h4>
                    </div>
                    <p className="text-gray-300 leading-relaxed">{analysisResult.aiJson.technicalSetup}</p>
                  </div>
                )}
                {analysisResult.aiJson.keyLevels && (
                  <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-5 h-5 text-cyan-400" />
                      <h4 className="font-semibold text-white">Key Price Levels</h4>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Support</div>
                        <div className="text-green-400 font-bold text-lg">{analysisResult.aiJson.keyLevels.support || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Resistance</div>
                        <div className="text-red-400 font-bold text-lg">{analysisResult.aiJson.keyLevels.resistance || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Stop Loss</div>
                        <div className="text-orange-400 font-bold text-lg">{analysisResult.aiJson.keyLevels.stopLoss || 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Catalyst & Time Horizon */}
              {(analysisResult.aiJson.catalyst || analysisResult.aiJson.timeHorizon) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysisResult.aiJson.catalyst && (
                    <div className="rounded-xl bg-yellow-900/20 border border-yellow-500/30 p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-5 h-5 text-yellow-400" />
                        <h4 className="font-semibold text-yellow-400">Catalyst to Watch</h4>
                      </div>
                      <p className="text-gray-300">{analysisResult.aiJson.catalyst}</p>
                    </div>
                  )}
                  {analysisResult.aiJson.timeHorizon && (
                    <div className="rounded-xl bg-blue-900/20 border border-blue-500/30 p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-blue-400" />
                        <h4 className="font-semibold text-blue-400">Time Horizon</h4>
                      </div>
                      <p className="text-gray-300">{analysisResult.aiJson.timeHorizon}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Actionable Insight - Hero */}
              {analysisResult.aiJson.actionableInsight && (
                <div className={`rounded-2xl border-2 ${v?.border} bg-gradient-to-r ${v?.bg} p-6`}>
                  <div className="flex items-start gap-4">
                    <Award className={`w-8 h-8 ${v?.color} flex-shrink-0`} />
                    <div>
                      <h4 className="font-bold text-white text-xl mb-2">Bottom Line</h4>
                      <p className="text-white text-lg font-medium leading-relaxed">{analysisResult.aiJson.actionableInsight}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fallback for non-JSON response */}
          {!analysisResult.aiJson && analysisResult.rawInsight && (
            <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-purple-400" />
                <h4 className="font-semibold text-white">AI Analysis</h4>
              </div>
              <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{analysisResult.rawInsight}</p>
            </div>
          )}

          {/* Recent Headlines */}
          {analysisResult.news?.length > 0 && (
            <div className="rounded-xl bg-gray-800/30 border border-gray-700 p-5">
              <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                <span>📰</span> News Driving This Analysis
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysisResult.news.slice(0, 6).map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg transition-colors group"
                  >
                    <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-white group-hover:text-blue-400 transition-colors line-clamp-2 text-sm">
                        {article.headline}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {article.source} • {new Date(article.datetime * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Minimal Footer */}
          <div className="text-center text-xs text-gray-600 pt-2">
            Analysis generated {new Date(analysisResult.timestamp).toLocaleString()} • For informational purposes only
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && !loading && !analysisResult && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Recent Analyses
            </h3>
            <button
              onClick={() => { setHistory([]); localStorage.removeItem('ai_analysis_history_v2') }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.map((item) => {
              const hv = item.aiJson ? getVerdictDisplay(item.aiJson.verdict, item.aiJson.verdictStrength) : { color: 'text-gray-400', bg: 'bg-gray-700/50', border: 'border-gray-600', label: 'VIEW', gradient: 'from-gray-600 to-gray-500' }
              return (
                <button
                  key={`${item.symbol}-${item.timestamp}`}
                  onClick={() => setAnalysisResult(item)}
                  className={`p-4 rounded-xl border-2 ${hv.border} ${hv.bg} hover:scale-[1.02] text-left transition-all`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-white text-xl">{item.symbol}</span>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-gradient-to-r ${hv.gradient}`}>
                      {hv.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-white font-semibold">${item.quote?.price?.toFixed(2)}</div>
                      <div className={`text-sm font-medium ${item.quote?.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {item.quote?.changePercent >= 0 ? '+' : ''}{item.quote?.changePercent?.toFixed(2)}%
                      </div>
                    </div>
                    {item.aiJson?.confidence && (
                      <div className="text-right">
                        <div className="text-lg font-bold text-purple-400">{item.aiJson.confidence}%</div>
                        <div className="text-xs text-gray-500">confidence</div>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!analysisResult && !loading && history.length === 0 && (
        <div className="rounded-2xl p-10 border-2 border-dashed border-purple-500/30 bg-gradient-to-br from-purple-900/10 to-blue-900/10 text-center">
          <div className="text-5xl mb-6">🧠</div>
          <h3 className="text-2xl font-bold mb-3 text-white">AI-Powered Deep Analysis</h3>
          <p className="text-gray-400 max-w-xl mx-auto mb-8 leading-relaxed">
            Get institutional-quality research on any stock. Our AI analyzes technicals, fundamentals, news sentiment, and market positioning to deliver actionable insights with clear buy/sell recommendations.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <span className="px-4 py-2 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Bull & Bear Cases</span>
            <span className="px-4 py-2 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Technical Levels</span>
            <span className="px-4 py-2 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">News Sentiment</span>
            <span className="px-4 py-2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Catalyst Alerts</span>
          </div>
        </div>
      )}
    </div>
  )
}
