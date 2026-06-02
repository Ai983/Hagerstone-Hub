import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import avatarSrc from '../assets/avatar-founder.png'

// ── Constants ─────────────────────────────────────────────────────────────────

const D   = 120          // display diameter (px)
const DPR = 2            // canvas resolution multiplier (retina)
const C   = D * DPR      // canvas pixel size (240)

// Eye positions as fractions of canvas size.
// Tweak cx/cy if eyes don't align — typical male professional headshot values.
const EYES = [
  { cx: 0.40, cy: 0.37, rx: 0.095, ry: 0.038 },   // left eye
  { cx: 0.62, cy: 0.37, rx: 0.095, ry: 0.038 },   // right eye
]

// ── Component ─────────────────────────────────────────────────────────────────

export function FounderAvatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef    = useRef<HTMLImageElement | null>(null)
  const lidRef    = useRef(0)                        // 0 = open, 1 = closed
  const rafRef    = useRef(0)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Framer Motion values
  const mouseX  = useMotionValue(0)
  const mouseY  = useMotionValue(0)
  const rotateX = useTransform(mouseY, [-200, 200],  [ 8, -8])
  const rotateY = useTransform(mouseX, [-200, 200],  [-8,  8])
  const floatY  = useMotionValue(0)
  const glowOp  = useMotionValue(0.45)

  // ── Draw one frame ────────────────────────────────────────────────────────

  function drawFrame() {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, C, C)

    // Draw photo clipped to circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(C / 2, C / 2, C / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, 0, 0, C, C)
    ctx.restore()

    // Overlay eyelids
    const lid = lidRef.current
    if (lid > 0.01) {
      ctx.fillStyle = 'rgba(18, 10, 4, 0.92)'
      EYES.forEach(({ cx, cy, rx, ry }) => {
        ctx.beginPath()
        ctx.ellipse(cx * C, cy * C, rx * C, ry * C * lid, 0, 0, Math.PI * 2)
        ctx.fill()
      })
    }
  }

  // ── Animated blink ────────────────────────────────────────────────────────

  async function blink() {
    const CLOSE = 65   // ms to close
    const HOLD  = 85   // ms eyes stay shut
    const OPEN  = 90   // ms to open

    // Close
    await new Promise<void>(res => {
      const t0 = performance.now()
      const step = (now: number) => {
        lidRef.current = Math.min((now - t0) / CLOSE, 1)
        drawFrame()
        if (lidRef.current < 1) rafRef.current = requestAnimationFrame(step)
        else res()
      }
      rafRef.current = requestAnimationFrame(step)
    })

    // Hold shut
    await new Promise(r => setTimeout(r, HOLD))

    // Open
    await new Promise<void>(res => {
      const t0 = performance.now()
      const step = (now: number) => {
        lidRef.current = Math.max(1 - (now - t0) / OPEN, 0)
        drawFrame()
        if (lidRef.current > 0) rafRef.current = requestAnimationFrame(step)
        else res()
      }
      rafRef.current = requestAnimationFrame(step)
    })
  }

  function scheduleBlink() {
    // Humans blink every 2–7 seconds; occasional double-blink
    const delay = 2200 + Math.random() * 4500
    timerRef.current = setTimeout(async () => {
      await blink()
      // 15% chance of double-blink
      if (Math.random() < 0.15) {
        await new Promise(r => setTimeout(r, 200))
        await blink()
      }
      scheduleBlink()
    }, delay)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const img = new Image()
    img.src = avatarSrc
    img.onload = () => {
      imgRef.current = img
      drawFrame()
    }

    const stopFloat = animate(floatY, [0, -10, 0], {
      duration: 3.5, repeat: Infinity, ease: 'easeInOut',
    })
    const stopGlow = animate(glowOp, [0.38, 0.82, 0.38], {
      duration: 2.5, repeat: Infinity, ease: 'easeInOut',
    })

    scheduleBlink()

    return () => {
      stopFloat.stop()
      stopGlow.stop()
      cancelAnimationFrame(rafRef.current)
      clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mouse handlers ────────────────────────────────────────────────────────

  function onMouseMove(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    mouseX.set(e.clientX - r.left - r.width  / 2)
    mouseY.set(e.clientY - r.top  - r.height / 2)
  }
  function onMouseLeave() {
    animate(mouseX, 0, { duration: 0.6, ease: 'easeOut' })
    animate(mouseY, 0, { duration: 0.6, ease: 'easeOut' })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      className="fixed top-20 left-4 z-50 select-none cursor-default"
      initial={{ opacity: 0, scale: 0.5, x: -24 }}
      animate={{ opacity: 1, scale: 1,   x:   0 }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ perspective: 500 }}
    >
      {/* Breathing gold glow behind avatar */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          opacity: glowOp,
          background:
            'radial-gradient(circle, rgba(201,168,76,0.75) 0%, rgba(201,168,76,0.0) 68%)',
          filter: 'blur(20px)',
          transform: 'scale(1.8)',
        }}
      />

      {/* Float + 3D tilt wrapper */}
      <motion.div
        style={{ y: floatY, rotateX, rotateY, transformStyle: 'preserve-3d' }}
      >
        {/* Gold gradient ring */}
        <div
          style={{
            width:        D + 6,
            height:       D + 6,
            borderRadius: '50%',
            padding:      3,
            background:
              'linear-gradient(145deg, #F5D98B 0%, #C9A84C 30%, #A07830 65%, #C9A84C 100%)',
            boxShadow:
              '0 0 30px rgba(201,168,76,0.60), 0 8px 24px rgba(0,0,0,0.50)',
          }}
        >
          {/* Canvas — face + animated eyelids */}
          <canvas
            ref={canvasRef}
            width={C}
            height={C}
            style={{
              width:        D,
              height:       D,
              borderRadius: '50%',
              display:      'block',
            }}
          />
        </div>

        {/* Founder badge */}
        <div className="mt-2 flex justify-center">
          <span
            style={{
              fontSize:       10,
              fontWeight:     700,
              letterSpacing:  '0.07em',
              padding:        '2px 10px',
              borderRadius:   999,
              background:
                'linear-gradient(135deg, rgba(201,168,76,0.20), rgba(201,168,76,0.06))',
              border:         '1px solid rgba(201,168,76,0.45)',
              color:          '#C9A84C',
              backdropFilter: 'blur(6px)',
              textTransform:  'uppercase',
            }}
          >
            Founder
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}
