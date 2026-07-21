import React, { useState, useRef, useEffect } from 'react'
import logo from './assets/logo.png'

export default function App() {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('Research Mode')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)


  const [result, setResult] = useState({
    scores: {
      virality: 0,
      attention: 0,
      sustainability: 0,
      monetization: 0,
    },
    narrativeSummary: 'Awaiting analysis...',
    marketPsychology: 'Awaiting analysis...',
    viralContentAngles: 'Awaiting analysis...',
    alphaOpportunities: 'Awaiting analysis...',
  })

  const handleAnalyze = async () => {
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://signalforge-ai.onrender.com'
      const response = await fetch(`${apiBase}/demo-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input, mode }),
      })

      if (!response.ok) {
        throw new Error(`Backend error ${response.status}`)
      }

      const data = await response.json()
      const analysis = data?.result

      if (!analysis) {
        throw new Error('Invalid response format')
      }

      setResult({
        scores: {
          virality: analysis.scores?.virality ?? result.scores.virality,
          attention: analysis.scores?.attention ?? result.scores.attention,
          sustainability:
            analysis.scores?.sustainability ?? result.scores.sustainability,
          monetization:
            analysis.scores?.monetization ?? result.scores.monetization,
        },
        narrativeSummary:
          analysis.narrativeSummary || result.narrativeSummary,
        marketPsychology:
          analysis.marketPsychology || result.marketPsychology,
        viralContentAngles:
          analysis.viralContentAngles || result.viralContentAngles,
        alphaOpportunities:
          analysis.alphaOpportunities || result.alphaOpportunities,
      })
    } catch (err) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }


  const scoreCards = [
    ['Virality Score', result.scores.virality],
    ['Attention Score', result.scores.attention],
    ['Sustainability', result.scores.sustainability],
    ['Monetization', result.scores.monetization],
  ]

  const panels = [
    ['Narrative Summary', result.narrativeSummary],
    ['Market Psychology', result.marketPsychology],
    ['Viral Content Angles', result.viralContentAngles],
    ['Alpha Opportunities', result.alphaOpportunities],
  ]

  return (
    <div className="min-h-screen bg-[#040608] text-white flex">
      <aside className="w-72 border-r border-white/10 bg-black/30 p-6 hidden md:flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-black/60 border border-white/6 flex items-center justify-center">
              <img src={logo} alt="SignalForge" className="w-8 h-8" />
            </div>

            <div>
              <h1 className="text-xl font-bold">SignalForge AI</h1>
              <p className="text-xs text-slate-400">Narrative Intelligence</p>
            </div>
          </div>

          <nav className="space-y-3">
            {['Creator Mode', 'Trader Mode', 'Research Mode', 'VC Mode', 'Meme Mode'].map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setMode(item)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition ${
                    mode === item
                      ? 'bg-cyan-400/10 border border-cyan-400/20'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {item}
                </button>
              )
            )}
          </nav>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-400/10 to-purple-500/10 border border-white/10">
          <p className="text-sm text-slate-300">
            AI-powered narrative analysis for crypto creators, traders, and researchers.
          </p>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold">SignalForge Dashboard</h2>
            <p className="text-slate-400 mt-1">
              Analyze narratives, trends, and attention flows.
            </p>
          </div>

        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-8">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a token, project, ecosystem, article, or narrative..."
            className="w-full h-40 bg-black/30 border border-white/10 rounded-2xl p-5 text-white outline-none resize-none"
          />

          <div className="flex justify-between items-center mt-5">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-xl px-4 py-3"
            >
              <option>Creator Mode</option>
              <option>Trader Mode</option>
              <option>Research Mode</option>
              <option>VC Mode</option>
              <option>Meme Mode</option>
            </select>

            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-cyan-400 text-black font-bold disabled:opacity-60"
            >
              {loading ? 'Analyzing...' : 'Analyze Narrative'}
            </button>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
          {scoreCards.map(([title, score]) => (
            <div
              key={title}
              className="rounded-3xl bg-white/5 border border-white/10 p-6"
            >
              <p className="text-slate-400 text-sm mb-2">{title}</p>
              <h3 className="text-4xl font-bold">{score}</h3>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {panels.map(([title, text]) => (
            <div
              key={title}
              className="bg-white/5 border border-white/10 rounded-3xl p-6"
            >
              <h3 className="text-xl font-bold mb-4">{title}</h3>
              <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                {text}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}