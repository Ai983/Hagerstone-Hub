import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

/** Respects the user's reduced-motion preference (also a perf escape hatch). */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

/** Gently eases the camera toward the pointer for a parallax / mouse-reactive feel. */
function ParallaxRig() {
  useFrame((state) => {
    const px = state.pointer.x
    const py = state.pointer.y
    state.camera.position.x += (px * 1.4 - state.camera.position.x) * 0.05
    state.camera.position.y += (py * 0.8 + 0.6 - state.camera.position.y) * 0.05
    state.camera.lookAt(0, 0.2, 0)
  })
  return null
}

interface Scene3DProps {
  children: ReactNode
  height?: number
  className?: string
  /** Shown instead of the canvas when reduced-motion is on. */
  reducedFallback?: ReactNode
  cameraPosition?: [number, number, number]
}

/**
 * Shared WebGL canvas: warm amber lighting, pointer parallax, capped DPR for perf.
 * Decorative only — text/data is rendered as HTML overlays or in the accessible tables,
 * so disabling 3D never hides information.
 */
export default function Scene3D({
  children,
  height = 220,
  className,
  reducedFallback,
  cameraPosition = [0, 0.6, 6],
}: Scene3DProps) {
  const reduced = usePrefersReducedMotion()

  if (reduced) {
    return (
      <div
        className={className}
        style={{
          height,
          borderRadius: 16,
          background:
            'radial-gradient(ellipse at 50% 30%, #fde68a 0%, #fcd9a0 45%, #fbbf77 100%)',
        }}
      >
        {reducedFallback}
      </div>
    )
  }

  return (
    <div className={className} style={{ height, borderRadius: 16, overflow: 'hidden' }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: cameraPosition, fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.5} color="#fff3d6" />
        <pointLight position={[-5, -2, 3]} intensity={30} color="#f59e0b" />
        <ParallaxRig />
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  )
}
