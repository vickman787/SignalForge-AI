import React, { useState, useRef, useEffect } from 'react'
import logo from './assets/logo.png'

export default function App() {
  const [input, setInput] = useState(
    'Analyze the AI + ZK narrative around Cysic and evaluate expansion potential.'
  )
  const [mode, setMode] = useState('Research Mode')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [walletAddress, setWalletAddress] = useState(null)
  const [walletType, setWalletType] = useState('solana') // force Solana-only
  const [showWalletMenu, setShowWalletMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)

  const [result, setResult] = useState({
    scores: {
      virality: 92,
      attention: 88,
      sustainability: 74,
      monetization: 81,
    },
    narrativeSummary:
      'The AI + ZK narrative remains early-stage but is transitioning from speculative hype toward real-world compute utility.',
    marketPsychology:
      'Retail attention is moving toward projects combining AI, ComputeFi, and scalable infrastructure because they feel early and asymmetric.',
    viralContentAngles:
      'Why ComputeFi may become the next major crypto sector. How AI + ZK could reshape decentralized infrastructure.',
    alphaOpportunities:
      'Projects linking verifiable compute with creator attention systems remain underexplored compared to broader AI narratives.',
  })

  const handleAnalyze = async () => {
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('https://signalforge-ai.onrender.com/analyze', {
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

  const connectWallet = async () => {
    setError(null)
    try {
      if (typeof window === 'undefined' || !window.solana) {
        setError('No Solana wallet found. Install Phantom or another Solana provider.')
        return
      }
      // Phantom connect
      const resp = await window.solana.connect()
      const addr = resp?.publicKey?.toString() || (window.solana.publicKey && window.solana.publicKey.toString())
      if (addr) {
        setWalletAddress(addr)
        setWalletType('solana')
      } else {
        setError('No accounts available')
      }
    } catch (err) {
      setError(err.message || 'Wallet connection failed')
    }
  }

  const disconnectWallet = async () => {
    try {
      if (typeof window !== 'undefined' && window.solana && window.solana.disconnect) {
        await window.solana.disconnect()
      }
    } catch (e) {
      // ignore provider disconnect errors; still clear local state
      console.warn('Disconnect error', e?.message || e)
    }
    setWalletAddress(null)
    setWalletType(null)
    setShowWalletMenu(false)
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setError('Copy failed')
    }
  }

  useEffect(() => {
    function handleOutside(e) {
      if (!showWalletMenu) return
      if (menuRef.current && !menuRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowWalletMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showWalletMenu])

  const shortAddress = (addr) => {
    if (!addr) return ''
    // Solana addresses are longer; show 4..4
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`
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

          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => {
                if (walletAddress) setShowWalletMenu((s) => !s)
                else connectWallet()
              }}
              className="px-5 py-3 rounded-xl bg-cyan-400 text-black font-semibold flex items-center gap-3"
              aria-haspopup="true"
              aria-expanded={showWalletMenu}
            >
              {walletAddress ? `SOL ${shortAddress(walletAddress)}` : 'Connect Wallet'}
              {walletAddress && (
                <svg className="w-4 h-4 text-black opacity-80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {showWalletMenu && (
              <div ref={menuRef} className="absolute right-0 mt-2 w-56 bg-white/6 backdrop-blur-md rounded-xl shadow-xl border border-white/10 p-3 z-50">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-slate-300">Connected</p>
                    <p className="text-sm font-medium">{shortAddress(walletAddress)}</p>
                    <p className="text-xs text-slate-400 mt-1 break-all">{walletAddress}</p>
                  </div>
                  <div className="ml-3 flex flex-col items-end gap-2">
                    <button onClick={copyAddress} className="px-3 py-1 rounded-md bg-white/8 text-sm text-slate-100 hover:bg-white/12">{copied ? 'Copied' : 'Copy'}</button>
                    <button onClick={disconnectWallet} className="px-3 py-1 rounded-md bg-red-600 text-sm text-white hover:opacity-90">Disconnect</button>
                  </div>
                </div>
              </div>
            )}
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