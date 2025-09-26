import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

/** Minimal UI bits (MUI/shadcn-like look without deps) */
const Label: React.FC<React.HTMLAttributes<HTMLLabelElement>> = ({ className = '', ...props }) => (
  <label className={`text-sm text-gray-500 ${className}`} {...props} />
)
const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button className={`px-3 py-2 rounded-2xl shadow-sm border border-gray-200 hover:shadow transition ${className}`} {...props} />
)
const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`rounded-2xl border border-gray-200 shadow-sm p-4 bg-white ${className}`} {...props} />
)
const Slider: React.FC<{ value: number; min?: number; max?: number; step?: number; onChange: (v:number)=>void}>
  = ({ value, min=0, max=1, step=0.01, onChange }) => (
  <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>onChange(parseFloat(e.target.value))} className="w-full" />
)

/** Data signal normalized 0..1 */
export type SolarSignal = {
  timestamp: number
  flareProb: number
  solarWindSpeed: number
  kpIndex: number
  sunspotArea: number
}

/** Mock adapter; replace with SuryaBench fetch/parse */
function useDatasetAdapter(live: boolean) {
  const [sig, setSig] = useState<SolarSignal>({
    timestamp: Date.now(),
    flareProb: 0.2,
    solarWindSpeed: 0.35,
    kpIndex: 0.15,
    sunspotArea: 0.25,
  })
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      setSig(prev => ({
        timestamp: Date.now(),
        flareProb: clamp01(prev.flareProb + (Math.random()-0.5)*0.05),
        solarWindSpeed: clamp01(prev.solarWindSpeed + (Math.random()-0.5)*0.04),
        kpIndex: clamp01(prev.kpIndex + (Math.random()-0.5)*0.08),
        sunspotArea: clamp01(prev.sunspotArea + (Math.random()-0.5)*0.03),
      }))
    }, 1200)
    return () => clearInterval(id)
  }, [live])
  return sig
}
const clamp01 = (n:number)=> Math.max(0, Math.min(1, n))

/** Aesthetic + behavior knobs */
type Knobs = {
  bgLightness: number
  baseParticles: number
  particleAmp: number
  windMultiplier: number
  flareAmp: number
  style: 'Deck223' | 'Solarpunk' | 'Aurora'
  particleShape: 'square' | 'circle'
  posterize: number
  grain: boolean
}
const defaultKnobs: Knobs = {
  bgLightness: 10,
  baseParticles: 350,
  particleAmp: 1200,
  windMultiplier: 1.0,
  flareAmp: 1.0,
  style: 'Deck223',           // sand/charcoal posterized (PXL Deck 223 vibe)
  particleShape: 'square',    // pixelated particles
  posterize: 6,               // fewer levels = chunkier gradients
  grain: true,                // subtle film grain overlay
}

/** Map data → visuals */
function useVisualParams(sig: SolarSignal, knobs: Knobs) {
  const palettes: Record<string, { baseHue:number; sat:number; bg:number }> = {
    Deck223:  { baseHue: 38,  sat: 45, bg: knobs.bgLightness }, // amber/sand
    Solarpunk:{ baseHue: 130, sat: 60, bg: knobs.bgLightness }, // greens
    Aurora:   { baseHue: 200, sat: 55, bg: knobs.bgLightness }, // indigo/cyan
  }
  const p = palettes[knobs.style] ?? palettes.Deck223

  const hueShift = sig.kpIndex * (knobs.style === 'Deck223' ? 25 : 140)
  const hue = (p.baseHue + hueShift) % 360
  const saturation = p.sat + sig.flareProb * (knobs.style === 'Deck223' ? 10 : 25)
  const lightness = 42 + sig.sunspotArea * 14

  // Posterize HSL channels for 8-bit vibe
  const q = (v:number, levels:number)=> Math.round(v / (100/levels)) * (100/levels)
  const bg = `hsl(${Math.round(hue)}, ${q(saturation*0.8, knobs.posterize)}%, ${q(p.bg, knobs.posterize)}%)`
  const core = `hsl(${Math.round(hue)}, ${q(saturation, knobs.posterize)}%, ${q(lightness, knobs.posterize)}%)`

  const particleCount = Math.round(knobs.baseParticles + sig.sunspotArea * knobs.particleAmp)
  const rotationSpeed = 0.002 + sig.solarWindSpeed * 0.01 * knobs.windMultiplier
  const flareBurst = sig.flareProb * knobs.flareAmp
  return { bg, core, particleCount, rotationSpeed, flareBurst, hue }
}

/** Canvas renderer */
function SolarCanvas({ sig, knobs }: { sig: SolarSignal; knobs: Knobs }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const tRef = useRef(0)
  const particlesRef = useRef<Array<{ a:number; r:number; s:number }>>([])

  const { bg, core, particleCount, rotationSpeed, flareBurst, hue } = useVisualParams(sig, knobs)

  // Init & resize
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    function resize() {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
      ctx.setTransform(dpr,0,0,dpr,0,0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Maintain particle population
  useEffect(() => {
    const ps = particlesRef.current
    while (ps.length < particleCount) {
      ps.push({ a: Math.random()*Math.PI*2, r: 40+Math.random()*260, s: 0.2+Math.random()*1.2 })
    }
    if (ps.length > particleCount) ps.splice(particleCount)
  }, [particleCount])

  useEffect(() => {
    let raf = 0
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    function noise(ctx: CanvasRenderingContext2D, w:number, h:number) {
      const img = ctx.createImageData(w, h)
      for (let i=0;i<img.data.length;i+=4){
        const n = Math.random()*30  // subtle
        img.data[i]=img.data[i+1]=img.data[i+2]=n; img.data[i+3]=20
      }
      ctx.putImageData(img, 0, 0)
    }

    function draw() {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0,0,w,h)

      // Background
      const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)/1.2)
      g.addColorStop(0, bg)
      g.addColorStop(1, `hsl(${hue}, 40%, ${Math.max(6, knobs.bgLightness-20)}%)`)
      ctx.fillStyle = g
      ctx.fillRect(0,0,w,h)

      // Core
      ctx.beginPath()
      const coreR = Math.min(w,h) * 0.16 + sig.sunspotArea * 40
      const coreGradient = ctx.createRadialGradient(w/2, h/2, coreR*0.08, w/2, h/2, coreR)
      coreGradient.addColorStop(0, core)
      coreGradient.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`)
      ctx.fillStyle = coreGradient
      ctx.arc(w/2, h/2, coreR, 0, Math.PI*2)
      ctx.fill()

      // Particle corona
      const ps = particlesRef.current
      ctx.save()
      ctx.translate(w/2, h/2)
      tRef.current += rotationSpeed

      for (let i=0; i<ps.length; i++) {
        const p = ps[i]
        p.a += rotationSpeed * p.s
        const x = Math.cos(p.a) * p.r
        const y = Math.sin(p.a) * p.r
        const alpha = 0.25 + 0.35 * Math.random()
        ctx.fillStyle = `hsla(${hue}, 90%, ${55 + sig.flareProb*20}%, ${alpha})`
        if (knobs.particleShape === 'square') {
          const sz = 1.2 + sig.sunspotArea*1.2
          ctx.fillRect(x - sz/2, y - sz/2, sz, sz)
        } else {
          ctx.beginPath()
          ctx.arc(x, y, 1 + sig.sunspotArea*1.2, 0, Math.PI*2)
          ctx.fill()
        }

        // Occasional flare streaks (reduced chance for Deck223 minimalism)
        const streakChance = knobs.style === 'Deck223' ? 0.004 : 0.01
        if (Math.random() < flareBurst * streakChance) {
          ctx.strokeStyle = `hsla(${hue}, 95%, 70%, 0.35)`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x*1.25, y*1.25)
          ctx.stroke()
        }
      }
      ctx.restore()

      if (knobs.grain) noise(ctx, w, h)

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [bg, core, particleCount, rotationSpeed, flareBurst, hue, knobs.bgLightness, sig.flareProb, sig.sunspotArea, knobs.particleShape, knobs.style, knobs.grain])

  return <canvas ref={canvasRef} className="w-full h-full rounded-2xl" />
}

/** Main component */
export default function SolarArtGenerator() {
  const [live, setLive] = useState(true)
  const [knobs, setKnobs] = useState<Knobs>(defaultKnobs)
  const sig = useDatasetAdapter(live)

  return (
    <div className="min-h-screen w-full p-6 font-[Inter]">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="p-0 overflow-hidden h-[70vh]">
            <div className="p-4 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                <h2 className="text-lg font-semibold">Data-Driven Solar Art</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={()=>setLive(v=>!v)} className="text-sm">
                  {live ? 'Pause Live' : 'Resume Live'}
                </Button>
              </div>
            </div>
            <div className="h-full">
              <SolarCanvas sig={sig} knobs={knobs} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold mb-3">Controls</h3>

            <div className="space-y-4">
              <div>
                <Label>Style preset ({knobs.style})</Label>
                <div className="flex gap-2 mt-1">
                  {(['Deck223','Solarpunk','Aurora'] as const).map(s => (
                    <Button key={s} className={`text-sm ${knobs.style===s? 'bg-gray-900 text-white' : ''}`} onClick={()=>setKnobs(k=>({...k, style:s}))}>{s}</Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Particle shape</Label>
                  <div className="flex gap-2 mt-1">
                    {(['square','circle'] as const).map(s => (
                      <Button key={s} className={`text-sm ${knobs.particleShape===s? 'bg-gray-900 text-white' : ''}`} onClick={()=>setKnobs(k=>({...k, particleShape:s}))}>{s}</Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Posterize levels ({knobs.posterize})</Label>
                  <Slider min={3} max={12} step={1} value={knobs.posterize} onChange={(v)=>setKnobs(k=>({...k, posterize:v}))} />
                </div>
              </div>

              <div>
                <Label>Background lightness ({knobs.bgLightness}%)</Label>
                <Slider min={4} max={30} step={1} value={knobs.bgLightness} onChange={(v)=>setKnobs(k=>({...k, bgLightness: v}))} />
              </div>

              <div>
                <Label>Base particles ({knobs.baseParticles})</Label>
                <Slider min={50} max={1000} step={10} value={knobs.baseParticles} onChange={(v)=>setKnobs(k=>({...k, baseParticles: v}))} />
              </div>

              <div>
                <Label>Particle amplitude ({knobs.particleAmp})</Label>
                <Slider min={0} max={2000} step={50} value={knobs.particleAmp} onChange={(v)=>setKnobs(k=>({...k, particleAmp: v}))} />
              </div>

              <div>
                <Label>Wind multiplier ({knobs.windMultiplier.toFixed(2)}×)</Label>
                <Slider min={0.2} max={3} step={0.05} value={knobs.windMultiplier} onChange={(v)=>setKnobs(k=>({...k, windMultiplier: v}))} />
              </div>

              <div>
                <Label>Flare amplitude ({knobs.flareAmp.toFixed(2)}×)</Label>
                <Slider min={0} max={3} step={0.05} value={knobs.flareAmp} onChange={(v)=>setKnobs(k=>({...k, flareAmp: v}))} />
              </div>

              <div className="flex items-center gap-3">
                <input id="grain" type="checkbox" checked={knobs.grain} onChange={(e)=>setKnobs(k=>({...k, grain:e.target.checked}))} />
                <Label htmlFor="grain">Film grain</Label>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-semibold mb-3">Incoming Signal (normalized)</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <KV label="Flare Prob" value={sig.flareProb.toFixed(2)} />
              <KV label="Solar Wind" value={sig.solarWindSpeed.toFixed(2)} />
              <KV label="Kp Index" value={sig.kpIndex.toFixed(2)} />
              <KV label="Sunspot Area" value={sig.sunspotArea.toFixed(2)} />
              <KV label="Timestamp" value={new Date(sig.timestamp).toLocaleTimeString()} />
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-semibold mb-2">Wire-up Notes</h3>
            <ul className="list-disc pl-5 text-sm space-y-2 text-gray-600">
              <li>Preset <code>Deck223</code> mimics sand/charcoal posterized aesthetics.</li>
              <li>Set <code>particleShape</code> to <code>square</code> for a pixel/voxel vibe.</li>
              <li>Normalize SuryaBench values to 0..1 in the adapter; visuals react automatically.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-900">{value}</span>
    </div>
  )
}