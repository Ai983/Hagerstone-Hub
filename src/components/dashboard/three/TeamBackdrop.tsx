import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei'
import type { Group } from 'three'
import Scene3D from './Scene3D'

function FloatingOrb({ x, color, scale }: { x: number; color: string; scale: number }) {
  return (
    <Float speed={2.2} rotationIntensity={0.7} floatIntensity={1.4}>
      <mesh position={[x, 0, 0]} scale={scale}>
        <icosahedronGeometry args={[1, 6]} />
        <MeshDistortMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.25} metalness={0.6} distort={0.4} speed={1.8} />
      </mesh>
    </Float>
  )
}

function Backdrop() {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.25
  })
  return (
    <group ref={ref}>
      <FloatingOrb x={-1.8} color="#d97706" scale={0.85} />
      <FloatingOrb x={1.8} color="#f59e0b" scale={0.7} />
      <Sparkles count={70} scale={[10, 5, 6]} size={2.5} color="#fbbf24" speed={0.3} />
    </group>
  )
}

export default function TeamBackdrop({ height = 150 }: { height?: number }) {
  return (
    <Scene3D height={height} cameraPosition={[0, 0.3, 6]}>
      <Backdrop />
    </Scene3D>
  )
}
