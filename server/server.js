import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import OpenAI from "openai"

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
})

app.post("/analyze", async (req, res) => {
  try {
    const { input, mode } = req.body

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" })
    }

    const completion = await client.chat.completions.create({
      model: "openrouter/free",
      messages: [
        {
          role: "system",
          content:
            "You are SignalForge AI, a crypto narrative intelligence engine. Return only valid JSON.",
        },
        {
          role: "user",
          content: `
Mode: ${mode}

Analyze:
${input}

Return only JSON:
{
  "scores": {
    "virality": 0,
    "attention": 0,
    "sustainability": 0,
    "monetization": 0
  },
  "narrativeSummary": "",
  "marketPsychology": "",
  "viralContentAngles": "",
  "alphaOpportunities": ""
}
          `,
        },
      ],
    })

    const text = completion.choices[0].message.content
    const cleaned = text.replace(/```json|```/g, "").trim()
    const result = JSON.parse(cleaned)

    res.json({ result })
  } catch (error) {
    console.error("OpenRouter error:", error.message)
    res.status(500).json({
      error: error.message || "OpenRouter analysis failed",
    })
  }
})

app.listen(5000, () => {
  console.log("SignalForge OpenRouter server running on http://localhost:5000")
})