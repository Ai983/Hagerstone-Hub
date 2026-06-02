import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei'
import type { Mesh } from 'three'
import Scene3D from './Scene3D'

/** Orb scale grows with the score (soft-capped so a runaway total stays on screen). */
function scaleForPoints(points: number) {
  return 0.85 + Math.min(points / 400, 1) * 0.85
}

function Orb({ points }: { points: number }) {
  const ref = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.35
  })
  return (
    <group>
      <Float speed={2} rotationIntensity={0.5} floatIntensity={1.1}>
        <mesh ref={ref} scale={scaleForPoints(points)}>
          <icosahedronGeometry args={[1, 8]} />
          <MeshDistortMaterial
            color="#d97706"
            emissive="#b45309"
            emissiveIntensity={0.45}
            roughness={0.2}
            metalness={0.65}
            distort={0.35}
            speed={2}
          />
        </mesh>
      </Float>
      <Sparkles count={45} scale={6} size={3} color="#fbbf24" speed={0.4} />
    </group>
  )
}

export default function PointsOrb({ points, height = 200 }: { points: number; height?: number }) {
  return (
    <Scene3D height={height} cameraPosition={[0, 0.4, 5.5]}>
      <Orb points={points} />
    </Scene3D>
  )
}
