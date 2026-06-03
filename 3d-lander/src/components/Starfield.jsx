import React, { useMemo } from 'react';
import * as THREE from 'three';

export function Starfield({ count = 800 }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      // Generate stars on a random sphere shell of radius 300 to 500
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 250 + Math.random() * 250;

      arr[i] = r * Math.sin(phi) * Math.cos(theta);
      arr[i + 1] = Math.max(10, r * Math.sin(phi) * Math.sin(theta)); // Keep them above ground plane mostly
      arr[i + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#ffffff"
        size={1.5}
        sizeAttenuation={false}
        transparent={true}
        opacity={0.8}
      />
    </points>
  );
}
