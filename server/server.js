import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import Anthropic from "@anthropic-ai/sdk"
import { x402ResourceServer } from "@okxweb3/x402-core/server"
import { OKXFacilitatorClient } from "@okxweb3/x402-core"
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server"
import { paymentMiddleware } from "@okxweb3/x402-express"
dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

if (!process.env.PAYMENT_ADDRESS) {
  throw new Error("Missing PAYMENT_ADDRESS — refusing to start, payments would go to the zero address")
}
for (const key of ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"]) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} — the OKX facilitator requires developer-portal credentials (https://web3.okx.com/onchainos/dev-portal)`)
  }
}

// Real OKX facilitator (per @okxweb3/x402-express README): performs genuine
// on-chain verification and settlement — unlike the previous mock that
// approved every request unconditionally. Auth uses OKX developer-portal
// credentials; anonymous access to the facilitator endpoints is not served.
const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY,
  secretKey: process.env.OKX_SECRET_KEY,
  passphrase: process.env.OKX_PASSPHRASE,
  syncSettle: true,
})
const resourceServer = new x402ResourceServer(facilitatorClient)
resourceServer.register("eip155:196", new ExactEvmScheme())

// initialize() needs a round-trip to the facilitator; don't let a transient
// failure crash the deploy. Retry in the background and fail requests closed
// (503) until verification is actually available.
let paymentsReady = false
async function initPayments() {
  for (let attempt = 1; ; attempt++) {
    try {
      await resourceServer.initialize()
      paymentsReady = true
      console.log("x402 facilitator initialized, payments enabled")
      return
    } catch (err) {
      console.error(
        `x402 facilitator init failed (attempt ${attempt}): ${err.message}`,
        err.cause ? `| cause: ${err.cause.message || err.cause}` : ""
      )
      await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * attempt)))
    }
  }
}
initPayments()

app.use((req, res, next) => {
  if (!paymentsReady) {
    return res.status(503).json({ error: "Payment verification is starting up, please retry shortly" })
  }
  next()
})

const routesConfig = {
  "/analyze": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:196",
        payTo: process.env.PAYMENT_ADDRESS,
        price: "0.05",
      },
    ],
    description: "Narrative Intelligence API",
  },
}

app.use(paymentMiddleware(routesConfig, resourceServer, undefined, undefined, false))

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

async function fetchLivePrices() {
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

async function fetchLiveNews() {
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

app.post("/analyze", async (req, res) => {
  try {
    // The payment middleware only settles (charges the buyer) when the
    // response status is < 400 — any 4xx/5xx from here means the buyer
    // signed but is NOT charged. Validate before doing paid work.
    const { input, mode } = req.body ?? {}

    if (typeof input !== "string" || input.trim().length === 0) {
      return res.status(400).json({
        error: 'missing required body param "input" — the text or topic to analyze',
      })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" })
    }

    const tools = [
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

    let currentMessages = [
      {
        role: "user",
        content: `Mode: ${mode || "general narrative analysis"}\n\nAnalyze:\n${input}`,
      }
    ]
    
    let analysisResult = null;
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: "You are SignalForge AI, a highly capable crypto narrative intelligence engine. Analyze the given narrative in the context of the given mode. Before calling report_analysis, ALWAYS call search_web at least twice: once with a query containing 'price' to fetch live prices, and once with a query containing 'news' to fetch current headlines. Ground your analysis in that live data — cite the fetched prices and headlines rather than relying on memory. If a fetch fails, note the gap in your analysis instead of inventing data.",
        messages: currentMessages,
        tools: tools,
        tool_choice: { type: "any" }
      })

      currentMessages.push({
        role: "assistant",
        content: response.content
      })

      if (response.stop_reason === "tool_use") {
        const toolUses = response.content.filter(block => block.type === "tool_use");
        const toolResults = [];

        for (const toolUse of toolUses) {
          if (toolUse.name === "report_analysis") {
            analysisResult = toolUse.input;
            break;
          } else if (toolUse.name === "search_web") {
            console.log(`Searching web for: ${toolUse.input.query}`);
            try {
              const query = toolUse.input.query.toLowerCase();
              let topResults = "";

              if (query.includes("price") || query.includes("usd")) {
                const { source, prices } = await fetchLivePrices();
                topResults = `Live Prices in USD (source: ${source}): Bitcoin: $${prices.BTC}, Ethereum: $${prices.ETH}, Solana: $${prices.SOL}, Dogecoin: $${prices.DOGE}`;
              } else if (query.includes("news") || query.includes("headline")) {
                topResults = `Live News Headlines:\n${await fetchLiveNews()}`;
              } else {
                topResults = "No real-time web results found for this specific query. Please proceed with the latest crypto prices or news context if already gathered, or use your general knowledge.";
              }
              
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: topResults
              });
            } catch (searchError) {
              console.error("Search error:", searchError.message);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Search failed due to an error. Proceed with existing knowledge.",
                is_error: true
              });
            }
          }
        }

        if (analysisResult) {
          break;
        }

        currentMessages.push({
          role: "user",
          content: toolResults
        });
      } else {
        console.error("Claude failed to return tool call. Stop reason:", response.stop_reason);
        console.error("Claude content:", JSON.stringify(response.content, null, 2));
        throw new Error("Anthropic did not return a tool call.")
      }
    }

    if (!analysisResult) {
      throw new Error("Analysis failed: exceeded maximum iterations without reporting.")
    }

    res.json({ result: analysisResult })
  } catch (error) {
    console.error("Anthropic error:", error.message)
    res.status(500).json({
      error: error.message || "Anthropic analysis failed",
    })
  }
})

app.listen(5000, () => {
  console.log("SignalForge Anthropic server running on http://localhost:5000")
})