import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import type { ModuleConfig } from '../types'
import { ExternalLink, Lock } from 'lucide-react'

interface Props {
  module: ModuleConfig
  isAccessible: boolean
  index: number
}

const BORDER_GLOW: Record<string, string> = {
  'border-orange-400':  '0 0 24px 4px rgba(251,146,60,0.35)',
  'border-teal-400':    '0 0 24px 4px rgba(45,212,191,0.30)',
  'border-emerald-500': '0 0 24px 4px rgba(16,185,129,0.30)',
  'border-purple-400':  '0 0 24px 4px rgba(167,139,250,0.30)',
  'border-blue-400':    '0 0 24px 4px rgba(96,165,250,0.30)',
  'border-indigo-400':  '0 0 24px 4px rgba(129,140,248,0.30)',
}

const CARD_SHADOW_BASE = '0 4px 16px rgba(146,64,14,0.10), 0 1px 4px rgba(0,0,0,0.06)'
const CARD_SHADOW_HOVER = '0 20px 48px rgba(146,64,14,0.18), 0 6px 16px rgba(0,0,0,0.10)'

export function ModuleCard({ module, isAccessible, index }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [10, -10]), {
    stiffness: 320, damping: 28,
  })
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-10, 10]), {
    stiffness: 320, damping: 28,
  })
  const glareX = useTransform(mouseX, [-0.5, 0.5], ['0%', '100%'])
  const glareY = useTransform(mouseY, [-0.5, 0.5], ['0%', '100%'])

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5)
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5)
  }

  function onMouseLeave() {
    mouseX.set(0)
    mouseY.set(0)
  }

  const handleClick = () => {
    if (isAccessible) window.open(module.url, '_blank', 'noopener,noreferrer')
  }

  const glowColor = BORDER_GLOW[module.borderColor] ?? CARD_SHADOW_HOVER

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      style={{ perspective: 800 }}
      className="h-full"
    >
      <motion.div
        ref={cardRef}
        onMouseMove={isAccessible ? onMouseMove : undefined}
        onMouseLeave={isAccessible ? onMouseLeave : undefined}
        onClick={handleClick}
        style={{
          rotateX: isAccessible ? rotateX : 0,
          rotateY: isAccessible ? rotateY : 0,
          transformStyle: 'preserve-3d',
        }}
        whileHover={isAccessible ? {
          scale: 1.04,
          boxShadow: `${CARD_SHADOW_HOVER}, ${glowColor}`,
          transition: { duration: 0.2 },
        } : {}}
        whileTap={isAccessible ? { scale: 0.97 } : {}}
        className={`
          relative h-full bg-white rounded-2xl border-t-4 p-5 overflow-hidden select-none
          ${module.borderColor}
          ${isAccessible
            ? 'cursor-pointer border border-stone-100'
            : 'opacity-40 grayscale cursor-not-allowed border border-stone-100'}
        `}
      >
        {/* Warm base shadow always-on */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ boxShadow: CARD_SHADOW_BASE }}
        />

        {/* Glare overlay */}
        {isAccessible && (
          <motion.div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              background: `radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.18) 0%, transparent 70%)`,
            }}
          />
        )}

        {/* Icon with 3D lift */}
        <motion.div
          style={{ translateZ: isAccessible ? 16 : 0 }}
          className="text-3xl mb-3 inline-block"
        >
          {module.icon}
        </motion.div>

        {/* Text — one short line, no paragraphs */}
        <div className="font-semibold text-stone-800 text-sm mb-1 leading-snug line-clamp-1">{module.name}</div>
        <div className="text-xs text-stone-400 leading-relaxed line-clamp-1">{module.description}</div>
        {!isAccessible && (
          <div className="text-[10px] text-stone-400 mt-1">Aapke role ke liye nahi 🔒</div>
        )}

        {/* Access indicator */}
        <div className="absolute top-3 right-3">
          {isAccessible ? (
            <motion.div
              initial={{ opacity: 0.4 }}
              whileHover={{ opacity: 1 }}
              className="text-stone-300"
            >
              <ExternalLink size={14} />
            </motion.div>
          ) : (
            <div className="text-stone-400">
              <Lock size={14} />
            </div>
          )}
        </div>

        {/* Bottom accent line */}
        {isAccessible && (
          <motion.div
            className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl opacity-0`}
            style={{ background: 'linear-gradient(90deg, transparent, rgba(146,64,14,0.3), transparent)' }}
            whileHover={{ opacity: 1, transition: { duration: 0.2 } }}
          />
        )}
      </motion.div>
    </motion.div>
  )
}
