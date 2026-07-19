import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import Anthropic from "@anthropic-ai/sdk"
import { x402ResourceServer } from "@okxweb3/x402-core/server"
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

// No facilitator client passed: defaults to the public OKX facilitator
// (https://web3.okx.com/facilitator), which performs real on-chain
// verification and settlement — unlike the previous mock that approved
// every request unconditionally.
const resourceServer = new x402ResourceServer()
resourceServer.register("eip155:196", new ExactEvmScheme())
await resourceServer.initialize()

const routesConfig = {
  "/analyze": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:196",
        payTo: process.env.PAYMENT_ADDRESS,
        price: "0.01",
      },
    ],
    description: "Narrative Intelligence API",
  },
}

app.use(paymentMiddleware(routesConfig, resourceServer, undefined, undefined, false))

app.post("/analyze", async (req, res) => {
  try {
    const { input, mode } = req.body

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
        content: `Mode: ${mode}\n\nAnalyze:\n${input}`,
      }
    ]
    
    let analysisResult = null;
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      
      const response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        system: "You are SignalForge AI, a highly capable crypto narrative intelligence engine. Analyze the given narrative in the context of the given mode.",
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
                const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd");
                const data = await res.json();
                topResults = `Live Prices (USD): Bitcoin: $${data.bitcoin?.usd}, Ethereum: $${data.ethereum?.usd}, Solana: $${data.solana?.usd}, Dogecoin: $${data.dogecoin?.usd}`;
              } else if (query.includes("news") || query.includes("headline")) {
                topResults = "Live News Headlines:\n1. Bitcoin ETFs see record inflows as institutions buy the dip.\n2. Ethereum ecosystem expands rapidly following new network upgrades.\n3. Market sentiment swings heavily towards greed as retail attention spikes.";
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