import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Sparkles, RoundedBox, Html } from '@react-three/drei'
import type { Group } from 'three'
import Scene3D from './Scene3D'

export interface PodiumEntry {
  userId: string
  userName: string
  total: number
  rank: number
}

const SLOTS = [
  // [x, podiumHeight, medalColor, medalEmoji]
  { x: 0, h: 1.7, color: '#f59e0b', emoji: '🥇' }, // center — winner
  { x: -2.2, h: 1.15, color: '#cbd5e1', emoji: '🥈' }, // left — 2nd
  { x: 2.2, h: 0.7, color: '#d8a06a', emoji: '🥉' }, // right — 3rd
] as const

const BASE_Y = -1.1

function Medal({ color }: { color: string }) {
  return (
    <Float speed={3} rotationIntensity={1.2} floatIntensity={0.8}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.1, 40]} />
        <meshStandardMaterial color={color} metalness={0.9} roughness={0.25} emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </Float>
  )
}

function Slot({ entry, slot, you }: { entry: PodiumEntry; slot: (typeof SLOTS)[number]; you: boolean }) {
  const podiumTop = BASE_Y + slot.h
  return (
    <group position={[slot.x, 0, 0]}>
      {/* podium block */}
      <RoundedBox args={[1.5, slot.h, 1.4]} radius={0.08} smoothness={4} position={[0, BASE_Y + slot.h / 2, 0]}>
        <meshStandardMaterial
          color={you ? '#fde68a' : '#fffaf0'}
          metalness={0.3}
          roughness={0.4}
          emissive={you ? '#f59e0b' : '#000000'}
          emissiveIntensity={you ? 0.35 : 0}
        />
      </RoundedBox>

      {/* floating medal above the podium */}
      <group position={[0, podiumTop + 0.95, 0.2]}>
        <Medal color={slot.color} />
      </group>

      {/* name + points label, anchored in 3D space */}
      <Html position={[0, podiumTop + 0.28, 0.75]} center distanceFactor={9}>
        <div style={{ textAlign: 'center', whiteSpace: 'nowrap', fontFamily: 'inherit', pointerEvents: 'none', userSelect: 'none' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: you ? 700 : 600,
              color: you ? '#92400e' : '#44403c',
            }}
          >
            {slot.emoji} {entry.userName}
            {you && <span style={{ color: '#b45309', fontSize: 10, marginLeft: 4 }}>◀ YOU</span>}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#b45309' }}>{entry.total}</div>
        </div>
      </Html>
    </group>
  )
}

function PodiumGroup({ rows, currentUserId }: { rows: PodiumEntry[]; currentUserId: string | null }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.16
  })
  // rows arrive rank-sorted; SLOTS order is [winner, 2nd, 3rd]
  return (
    <group ref={ref}>
      {rows.slice(0, 3).map((entry, i) => (
        <Slot key={entry.userId} entry={entry} slot={SLOTS[i]} you={entry.userId === currentUserId} />
      ))}
      <Sparkles count={60} scale={[10, 5, 6]} size={2.5} color="#fbbf24" speed={0.3} />
    </group>
  )
}

export default function PodiumScene({
  rows,
  currentUserId,
  height = 260,
}: {
  rows: PodiumEntry[]
  currentUserId: string | null
  height?: number
}) {
  if (rows.length === 0) return null
  return (
    <Scene3D height={height} cameraPosition={[0, 0.8, 6.5]}>
      <PodiumGroup rows={rows} currentUserId={currentUserId} />
    </Scene3D>
  )
}
