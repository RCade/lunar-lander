import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

// Seedable 2D Perlin Noise implementation to ensure identical terrain across reloads
class SimpleNoise {
  constructor(seed = 0.5) {
    this.p = new Uint8Array(256);
    // Fill permutation table pseudo-randomly based on seed
    let s = seed;
    for (let i = 0; i < 256; i++) {
      s = (s * 9301 + 49297) % 233280;
      this.p[i] = Math.floor((s / 233280.0) * 256);
    }
    this.permutation = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.permutation[i] = this.p[i & 255];
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  }

  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const A = this.permutation[X] + Y;
    const B = this.permutation[X + 1] + Y;
    return this.lerp(
      v,
      this.lerp(u, this.grad(this.permutation[A], x, y), this.grad(this.permutation[B], x - 1, y)),
      this.lerp(u, this.grad(this.permutation[A + 1], x, y - 1), this.grad(this.permutation[B + 1], x - 1, y - 1))
    );
  }
}

// Global terrain configuration
export const TERRAIN_SIZE = 500;
export const TERRAIN_SEGMENTS = 100;
export const LANDING_PADS = [
  { x: 0, z: 0, y: 0, radius: 14, multiplier: 1, color: '#00f0ff', label: 'EASY' },
  { x: 90, z: -80, y: 6, radius: 10, multiplier: 2, color: '#ffb700', label: 'MEDIUM' },
  { x: -120, z: 100, y: 12, radius: 8, multiplier: 4, color: '#ff007f', label: 'HARD' },
];

export function Terrain() {
  const noiseGen = useMemo(() => new SimpleNoise(0.85), []);

  const [terrainGeometry, padsGrid] = useMemo(() => {
    const geom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    // Rotate plane so XZ represents the horizontal ground and Y represents height
    geom.rotateX(-Math.PI / 2);

    const positions = geom.attributes.position.array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];

      // Calculate base noise (Fractional Brownian Motion)
      let height = 0;
      let amplitude = 40;
      let frequency = 0.003;
      for (let octave = 0; octave < 4; octave++) {
        height += noiseGen.noise(x * frequency, z * frequency) * amplitude;
        amplitude *= 0.45;
        frequency *= 2.2;
      }

      // Flatten terrain around landing pads
      let padInfluence = 0;
      let targetHeight = 0;

      for (const pad of LANDING_PADS) {
        const dx = x - pad.x;
        const dz = z - pad.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < pad.radius + 6) {
          // Soft-step transition zone
          const smooth = 1 - THREE.MathUtils.smoothstep(dist, pad.radius, pad.radius + 6);
          padInfluence = Math.max(padInfluence, smooth);
          // Combine pad target heights
          if (smooth > 0) {
            targetHeight = pad.y;
          }
        }
      }

      // Blend height with landing pad plane
      positions[i + 1] = THREE.MathUtils.lerp(height, targetHeight, padInfluence);
    }

    // Generate a clean square-grid (no diagonals) wireframe from positions
    const linePositions = [];
    const S = TERRAIN_SEGMENTS + 1;
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const idx = (r * S + c) * 3;
        const px = positions[idx];
        const py = positions[idx + 1];
        const pz = positions[idx + 2];

        // Connect to right neighbor
        if (c < TERRAIN_SEGMENTS) {
          const nextIdx = (r * S + (c + 1)) * 3;
          linePositions.push(px, py, pz);
          linePositions.push(positions[nextIdx], positions[nextIdx + 1], positions[nextIdx + 2]);
        }
        // Connect to bottom neighbor
        if (r < TERRAIN_SEGMENTS) {
          const nextIdx = ((r + 1) * S + c) * 3;
          linePositions.push(px, py, pz);
          linePositions.push(positions[nextIdx], positions[nextIdx + 1], positions[nextIdx + 2]);
        }
      }
    }

    const gridGeom = new THREE.BufferGeometry();
    gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

    return [gridGeom, LANDING_PADS];
  }, [noiseGen]);

  return (
    <group>
      {/* Wireframe Terrain Lines */}
      <lineSegments geometry={terrainGeometry}>
        <lineBasicMaterial color="#00a8cc" opacity={0.6} transparent={true} />
      </lineSegments>

      {/* Render Landing Pads */}
      {padsGrid.map((pad, idx) => (
        <group key={idx} position={[pad.x, pad.y + 0.1, pad.z]}>
          {/* Inner landing circle */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[pad.radius - 1, pad.radius, 32]} />
            <meshBasicMaterial color={pad.color} side={THREE.DoubleSide} />
          </mesh>

          {/* Dynamic grid marker in circle center */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0, 0.5, 4]} />
            <meshBasicMaterial color={pad.color} side={THREE.DoubleSide} />
          </mesh>

          {/* Pad border lines for CRT grid feel */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[pad.radius, 8]} />
            <meshBasicMaterial color={pad.color} wireframe={true} opacity={0.3} transparent={true} />
          </mesh>

          {/* Holographic Text Multiplier */}
          <Text
            position={[0, 4, 0]}
            fontSize={2.5}
            color={pad.color}
            font="/orbitron.ttf"
            anchorX="center"
            anchorY="middle"
          >
            {`${pad.multiplier}X`}
          </Text>
          <Text
            position={[0, 1.5, 0]}
            fontSize={1.2}
            color={pad.color}
            font="/sharetechmono.ttf"
            anchorX="center"
            anchorY="middle"
            opacity={0.7}
          >
            {pad.label}
          </Text>
        </group>
      ))}
    </group>
  );
}

// Function to sample height at arbitrary X/Z coordinate
export function getTerrainHeight(x, z, noiseGen) {
  // Direct analytical recreation of height logic for collision detection
  let height = 0;
  let amplitude = 40;
  let frequency = 0.003;
  for (let octave = 0; octave < 4; octave++) {
    height += noiseGen.noise(x * frequency, z * frequency) * amplitude;
    amplitude *= 0.45;
    frequency *= 2.2;
  }

  let padInfluence = 0;
  let targetHeight = 0;

  for (const pad of LANDING_PADS) {
    const dx = x - pad.x;
    const dz = z - pad.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < pad.radius + 6) {
      const smooth = 1 - THREE.MathUtils.smoothstep(dist, pad.radius, pad.radius + 6);
      padInfluence = Math.max(padInfluence, smooth);
      if (smooth > 0) {
        targetHeight = pad.y;
      }
    }
  }

  return THREE.MathUtils.lerp(height, targetHeight, padInfluence);
}
export const terrainNoiseInstance = new SimpleNoise(0.85);
