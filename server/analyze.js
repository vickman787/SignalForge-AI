async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLivePrices() {
  // Primary: CoinGecko (keyless, but aggressively rate-limited)
  try {
    const data = await fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd"
    )
    const prices = {
      BTC: data.bitcoin?.usd,
      ETH: data.ethereum?.usd,
      SOL: data.solana?.usd,
      DOGE: data.dogecoin?.usd,
    }
    if (Object.values(prices).every((p) => typeof p === "number")) {
      return { source: "CoinGecko", prices }
    }
    throw new Error("CoinGecko returned incomplete data")
  } catch (err) {
    console.warn("CoinGecko price fetch failed, falling back to Binance:", err.message)
  }
  // Fallback: Binance public ticker (keyless, high rate limits)
  const symbols = { BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT" }
  const data = await fetchJson(
    `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(Object.values(symbols)))}`
  )
  const bySymbol = Object.fromEntries(data.map((t) => [t.symbol, Number(t.price)]))
  const prices = Object.fromEntries(
    Object.entries(symbols).map(([name, sym]) => [name, bySymbol[sym]])
  )
  if (!Object.values(prices).every((p) => Number.isFinite(p))) {
    throw new Error("Binance returned incomplete data")
  }
  return { source: "Binance", prices }
}

export async function fetchLiveNews() {
  // Keyless RSS feeds — Cointelegraph primary, CoinDesk fallback
  const feeds = [
    { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
    { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  ]
  let lastError
  for (const feed of feeds) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "SignalForge/1.0" },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${feed.name}`)
      const xml = await res.text()
      const items = [...xml.matchAll(
        /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g
      )].slice(0, 5)
      if (items.length === 0) throw new Error(`${feed.name} feed returned no items`)
      return items
        .map(([, title, date], i) => `${i + 1}. [${date.trim()}] ${title.trim()} (${feed.name})`)
        .join("\n")
    } catch (err) {
      lastError = err
      console.warn(`News fetch from ${feed.name} failed:`, err.message)
    }
  }
  throw lastError
}

const TOOLS = [
  {
    name: "search_web",
    description: "Search the web for live crypto data and news. Use this if you need current information.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." }
      },
      required: ["query"]
    }
  },
  {
    name: "report_analysis",
    description: "Report the narrative analysis results. Call this tool ONLY when you have gathered all necessary information.",
    input_schema: {
      type: "object",
      properties: {
        scores: {
          type: "object",
          properties: {
            virality: { type: "number" },
            attention: { type: "number" },
            sustainability: { type: "number" },
            monetization: { type: "number" }
          },
          required: ["virality", "attention", "sustainability", "monetization"]
        },
        narrativeSummary: { type: "string" },
        marketPsychology: { type: "string" },
        viralContentAngles: { type: "string" },
        alphaOpportunities: { type: "string" }
      },
      required: ["scores", "narrativeSummary", "marketPsychology", "viralContentAngles", "alphaOpportunities"]
    }
  }
]

const SCORE_KEYS = ["virality", "attention", "sustainability", "monetization"]
const TEXT_KEYS = ["narrativeSummary", "marketPsychology", "viralContentAngles", "alphaOpportunities"]

// Returns null if valid, else a human-readable list of problems the model
// can act on when the report is bounced back as a tool error.
function validateReport(report) {
  const problems = []
  if (typeof report !== "object" || report === null) return "report_analysis input is not an object"
  if (typeof report.scores !== "object" || report.scores === null) {
    problems.push("scores must be an object with numeric virality, attention, sustainability, monetization")
  } else {
    for (const key of SCORE_KEYS) {
      if (!Number.isFinite(report.scores[key])) problems.push(`scores.${key} must be a number`)
    }
  }
  for (const key of TEXT_KEYS) {
    if (typeof report[key] !== "string" || report[key].trim().length === 0) {
      problems.push(`${key} must be a non-empty string`)
    }
  }
  return problems.length > 0 ? problems.join("; ") : null
}

// Runs the analysis loop with two code-level guarantees the prompt alone
// can't provide: report_analysis is not accepted until live prices AND news
// have been fetched, and a malformed report is bounced back for retry
// instead of being returned to a paying buyer. Throws if no valid report
// is produced within the iteration budget (caller maps that to a 5xx,
// which the payment middleware treats as do-not-charge).
export async function runAnalysis(client, input, mode) {
  let currentMessages = [
    {
      role: "user",
      content: `Mode: ${mode || "general narrative analysis"}\n\nAnalyze:\n${input}`,
    }
  ]

  let fetchedPrices = false
  let fetchedNews = false

  for (let iterations = 0; iterations < 8; iterations++) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: "You are SignalForge AI, a highly capable crypto narrative intelligence engine. Analyze the given narrative in the context of the given mode. Before calling report_analysis, ALWAYS call search_web at least twice: once with a query containing 'price' to fetch live prices, and once with a query containing 'news' to fetch current headlines. Ground your analysis in that live data — cite the fetched prices and headlines rather than relying on memory. If a fetch fails, note the gap in your analysis instead of inventing data.",
      messages: currentMessages,
      tools: TOOLS,
      // Force the first call to be search_web — the report can't come first.
      tool_choice: (fetchedPrices && fetchedNews)
        ? { type: "any" }
        : { type: "tool", name: "search_web" },
    })

    currentMessages.push({ role: "assistant", content: response.content })

    if (response.stop_reason !== "tool_use") {
      console.error("Claude failed to return tool call. Stop reason:", response.stop_reason)
      throw new Error("Anthropic did not return a tool call.")
    }

    const toolUses = response.content.filter(block => block.type === "tool_use")
    const toolResults = []

    for (const toolUse of toolUses) {
      if (toolUse.name === "report_analysis") {
        if (!fetchedPrices || !fetchedNews) {
          // Defense in depth — tool_choice above should prevent this branch.
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Report rejected: you must first fetch ${fetchedPrices ? "" : "live prices (search_web with a 'price' query)"}${!fetchedPrices && !fetchedNews ? " and " : ""}${fetchedNews ? "" : "current headlines (search_web with a 'news' query)"} before reporting.`,
            is_error: true
          })
          continue
        }
        const invalid = validateReport(toolUse.input)
        if (invalid) {
          console.warn("Malformed report_analysis, bouncing for retry:", invalid)
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Report rejected, fix these problems and call report_analysis again with the complete corrected input: ${invalid}`,
            is_error: true
          })
          continue
        }
        return toolUse.input
      }

      if (toolUse.name === "search_web") {
        console.log(`Searching web for: ${toolUse.input.query}`)
        try {
          const query = String(toolUse.input.query || "").toLowerCase()
          let topResults = ""

          if (query.includes("price") || query.includes("usd")) {
            const { source, prices } = await fetchLivePrices()
            topResults = `Live Prices in USD (source: ${source}): Bitcoin: $${prices.BTC}, Ethereum: $${prices.ETH}, Solana: $${prices.SOL}, Dogecoin: $${prices.DOGE}`
            fetchedPrices = true
          } else if (query.includes("news") || query.includes("headline")) {
            topResults = `Live News Headlines:\n${await fetchLiveNews()}`
            fetchedNews = true
          } else {
            topResults = "No real-time web results found for this specific query. Query with 'price' for live prices or 'news' for current headlines."
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: topResults
          })
        } catch (searchError) {
          console.error("Search error:", searchError.message)
          // Count a genuinely-attempted fetch as done so an outage can't
          // trap the loop; the prompt tells the model to disclose the gap.
          const query = String(toolUse.input.query || "").toLowerCase()
          if (query.includes("price") || query.includes("usd")) fetchedPrices = true
          if (query.includes("news") || query.includes("headline")) fetchedNews = true
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Search failed due to an error. Note this data gap explicitly in your analysis instead of inventing figures.",
            is_error: true
          })
        }
      }
    }

    currentMessages.push({ role: "user", content: toolResults })
  }

  throw new Error("Analysis failed: exceeded maximum iterations without a valid report.")
}
