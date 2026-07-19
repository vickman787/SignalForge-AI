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

    const analysisResult = await runAnalysis(client, input, mode)
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
