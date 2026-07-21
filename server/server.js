import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import Anthropic from "@anthropic-ai/sdk"
import { x402ResourceServer } from "@okxweb3/x402-core/server"
import { OKXFacilitatorClient } from "@okxweb3/x402-core"
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server"
import { paymentMiddleware } from "@okxweb3/x402-express"
import { runAnalysis } from "./analyze.js"
dotenv.config()

const app = express()
app.set("trust proxy", 1) // Render sits behind a proxy; needed for req.ip to reflect the real client
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

// Scoped to /analyze only — the free /demo-analyze route has nothing to do
// with x402 and must not be blocked by facilitator startup status.
app.use("/analyze", (req, res, next) => {
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
        price: "0.5",
      },
    ],
    description: "Narrative Intelligence API",
  },
}

// Marketplace compatibility: OKX task tooling (task-402-pay) reads the x402
// challenge from the 402 response BODY, but @okxweb3/x402-express only sets
// the PAYMENT-REQUIRED header and sends an empty {} body. Mirror the decoded
// challenge into the body — plus an input schema so buyers know the request
// shape — matching the pattern of endpoints that work through the marketplace.
const INPUT_SCHEMA = {
  description:
    "POST body for /analyze. All fields are optional — an empty body analyzes the overall current crypto market narrative.",
  fields: {
    input: 'string — the narrative, topic, or question to analyze. Default: overall crypto market narrative',
    mode: 'string — optional analysis mode/context. Default: "general narrative analysis"',
  },
  example: { input: "analyze the current bitcoin narrative", mode: "general narrative analysis" },
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode === 402) {
      const header = res.get("PAYMENT-REQUIRED")
      if (header && (!body || Object.keys(body).length === 0)) {
        try {
          const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8"))
          challenge.input = INPUT_SCHEMA
          body = challenge
        } catch (err) {
          console.warn("Could not mirror PAYMENT-REQUIRED header into 402 body:", err.message)
        }
      }
    }
    return originalJson(body)
  }
  next()
})

app.use(paymentMiddleware(routesConfig, resourceServer, undefined, undefined, false))

// Both verbs: marketplace task tooling replays paid requests with GET
// (params in query string), while direct x402 buyers POST a JSON body.
app.all("/analyze", async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "use GET or POST" })
  }
  try {
    // The payment middleware only settles (charges the buyer) when the
    // response status is < 400 — any 4xx/5xx from here means the buyer
    // signed but is NOT charged. Validate before doing paid work.
    let { input, mode } = req.method === "GET" ? (req.query ?? {}) : (req.body ?? {})

    // Marketplace task replays arrive with an empty body (the task flow does
    // not populate business params), so a missing input falls back to a
    // useful default instead of failing the paid request.
    if (input == null || (typeof input === "string" && input.trim().length === 0)) {
      input = "Analyze the current overall crypto market narrative"
    }
    if (typeof input !== "string") {
      return res.status(400).json({
        error: 'body param "input" must be a string — the text or topic to analyze',
      })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" })
    }

    const analysisResult = await runAnalysis(client, input, mode)
    res.json({ result: analysisResult })
  } catch (error) {
    console.error("Anthropic error:", error.message)
    res.status(500).json({
      error: error.message || "Anthropic analysis failed",
    })
  }
})

// Free, rate-limited demo path for the web app / marketing site — human
// visitors have no crypto wallet to pay the x402 endpoint. Same analysis
// logic as /analyze, just without the payment gate, capped per IP so it
// can't be scripted into a free substitute for the paid API.
const DEMO_LIMIT = 5
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000
const demoUsage = new Map() // ip -> array of request timestamps (ms)

setInterval(() => {
  const cutoff = Date.now() - DEMO_WINDOW_MS
  for (const [ip, timestamps] of demoUsage) {
    const kept = timestamps.filter((t) => t > cutoff)
    if (kept.length === 0) demoUsage.delete(ip)
    else demoUsage.set(ip, kept)
  }
}, 60 * 60 * 1000).unref()

app.post("/demo-analyze", async (req, res) => {
  try {
    const ip = req.ip || "unknown"
    const cutoff = Date.now() - DEMO_WINDOW_MS
    const recent = (demoUsage.get(ip) || []).filter((t) => t > cutoff)

    if (recent.length >= DEMO_LIMIT) {
      return res.status(429).json({
        error: `Demo limit reached (${DEMO_LIMIT} per day). Use the paid /analyze endpoint via the OKX Agent Payments Protocol for unlimited access.`,
      })
    }

    let { input, mode } = req.body ?? {}
    if (input == null || (typeof input === "string" && input.trim().length === 0)) {
      input = "Analyze the current overall crypto market narrative"
    }
    if (typeof input !== "string") {
      return res.status(400).json({ error: 'body param "input" must be a string' })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" })
    }

    recent.push(Date.now())
    demoUsage.set(ip, recent)

    const analysisResult = await runAnalysis(client, input, mode)
    res.json({ result: analysisResult, demo: true, remaining: DEMO_LIMIT - recent.length })
  } catch (error) {
    console.error("Demo analyze error:", error.message)
    res.status(500).json({ error: error.message || "Analysis failed" })
  }
})

app.listen(5000, () => {
  console.log("SignalForge Anthropic server running on http://localhost:5000")
})
