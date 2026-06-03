import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function Cockpit({ telemetryRef, glowActive }) {
  const cockpitRef = useRef();
  const artificialHorizonRef = useRef();
  const driftIndicatorRef = useRef();

  useFrame((state) => {
    const cam = state.camera;
    const tel = telemetryRef.current;

    if (!cockpitRef.current || !tel || !tel.position || !tel.upVector || !tel.velocity) return;

    // Cockpit must follow the camera position and rotation exactly (1st-person locking)
    cockpitRef.current.position.copy(cam.position);
    cockpitRef.current.quaternion.copy(cam.quaternion);

    // Update dynamic HUD overlays inside the cockpit frame:
    
    // 1. Artificial Horizon Rotation (opposite of lander rotation)
    if (artificialHorizonRef.current) {
      // Rotate the horizon ring to counteract lander pitch and roll
      // We read the lander's attitude via telemetry and map it
      const pitchRad = THREE.MathUtils.degToRad(tel.pitch);
      
      // Counter-rotate the artificial horizon to keep it horizontal
      artificialHorizonRef.current.rotation.set(0, 0, 0); // start clean
      
      // Map lander tilt vector projection to horizon rotation
      if (tel.velocity) {
        // Simple artificial horizon roll based on upVector deviation
        const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const upProj = tel.upVector.dot(localRight);
        artificialHorizonRef.current.rotation.z = upProj * 2.0;
      }
    }

    // 2. Horizontal Drift Diamond (moves relative to landing path)
    if (driftIndicatorRef.current && tel.velocity) {
      // Map local drift to HUD coordinates
      const camRot = cam.quaternion.clone();
      const localVel = tel.velocity.clone().applyQuaternion(camRot.invert());

      // Scale velocity to slide the drift diamond around the screen
      const maxDrift = 15;
      const xHUD = THREE.MathUtils.clamp(-localVel.x * 0.4, -2.5, 2.5);
      const yHUD = THREE.MathUtils.clamp(-localVel.z * 0.4, -2.5, 2.5);

      driftIndicatorRef.current.position.set(xHUD, yHUD - 1.5, -5.0);
    }
  });

  return (
    <group ref={cockpitRef}>
      {/* 3D Wireframe Cockpit HUD Frame */}
      
      {/* Canopy Structural Ribs */}
      {/* Curved canopy rings */}
      <mesh position={[0, 0.5, -2]}>
        <torusGeometry args={[2.0, 0.03, 8, 24, Math.PI]} />
        <meshBasicMaterial 
          color={glowActive ? new THREE.Color("#ff5d00").multiplyScalar(1.5) : "#ff5d00"} 
          toneMapped={false}
          opacity={glowActive ? 0.65 : 0.4} 
          transparent={true} 
        />
      </mesh>

      {/* Vertical columns and horizontal cockpit struts */}
      <line>
        <bufferGeometry>
          <float32BufferAttribute
            attach="attributes-position"
            args={[new Float32Array([
              // left bar
              -1.5, -1.0, -2.5,  -1.0, 1.2, -2.0,
              // right bar
              1.5, -1.0, -2.5,  1.0, 1.2, -2.0,
              // cross dashboard bar
              -2.0, -1.0, -2.5,  2.0, -1.0, -2.5,
              // canopy top connector
              -1.0, 1.2, -2.0,   1.0, 1.2, -2.0
            ]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial 
          color={glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.8) : "#00f0ff"} 
          toneMapped={false}
          opacity={glowActive ? 0.65 : 0.35} 
          transparent={true} 
        />
      </line>

      {/* Floor window outline (looking down at terrain) */}
      <mesh position={[0, -2.0, -2.5]} rotation={[-Math.PI / 2.2, 0, 0]}>
        <ringGeometry args={[1.2, 1.3, 8]} />
        <meshBasicMaterial 
          color={glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.8) : "#00f0ff"} 
          toneMapped={false}
          opacity={glowActive ? 0.9 : 0.6} 
          transparent={true} 
        />
      </mesh>

      {/* --- Dynamic Holographic HUD Elements (Projected in front of camera) --- */}

      {/* Pitch Ladder / Horizon Guide */}
      <group position={[0, 0, -4.5]}>
        {/* Horizontal center bars */}
        <line>
          <bufferGeometry>
            <float32BufferAttribute
              attach="attributes-position"
              args={[new Float32Array([
                -1.2, 0, 0,   -0.4, 0, 0,
                0.4, 0, 0,    1.2, 0, 0,
                -0.4, 0.1, 0,  -0.4, -0.1, 0,
                0.4, 0.1, 0,   0.4, -0.1, 0
              ]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial 
            color={glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.8) : "#ffb700"} 
            toneMapped={false}
            opacity={glowActive ? 0.95 : 0.7} 
            transparent={true} 
          />
        </line>

        {/* Artificial Horizon Ring (Rotates) */}
        <group ref={artificialHorizonRef}>
          <mesh rotation={[0, 0, 0]}>
            <ringGeometry args={[1.8, 1.83, 32]} />
            <meshBasicMaterial 
              color={glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.5) : "#ffb700"} 
              toneMapped={false}
              opacity={glowActive ? 0.65 : 0.4} 
              transparent={true} 
            />
          </mesh>
          {/* Horizon marks */}
          <line>
            <bufferGeometry>
              <float32BufferAttribute
                attach="attributes-position"
                args={[new Float32Array([
                  -1.8, 0, 0, -1.5, 0, 0,
                  1.5, 0, 0, 1.8, 0, 0,
                  0, 1.8, 0, 0, 1.6, 0
                ]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial 
              color={glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.8) : "#ffb700"} 
              toneMapped={false}
              opacity={glowActive ? 0.8 : 0.5} 
              transparent={true} 
            />
          </line>
        </group>
      </group>

      {/* Dynamic Drift Diamond Reticle */}
      <group ref={driftIndicatorRef} position={[0, -1.5, -5.0]}>
        {/* Small glowing diamond showing vector velocity direction */}
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <ringGeometry args={[0.08, 0.12, 4]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ff007f").multiplyScalar(2.2) : "#ff007f"} 
            toneMapped={false}
            side={THREE.DoubleSide} 
          />
        </mesh>
        
        {/* Center reticle target dot */}
        <mesh>
          <circleGeometry args={[0.03, 8]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ff007f").multiplyScalar(2.2) : "#ff007f"} 
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Reticle guide circles for horizontal speed limits */}
      <group position={[0, -1.5, -5.0]}>
        <mesh>
          <ringGeometry args={[0.45, 0.48, 16]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.5) : "#00f0ff"} 
            toneMapped={false}
            opacity={glowActive ? 0.45 : 0.25} 
            transparent={true} 
          />
        </mesh>
        <mesh>
          <ringGeometry args={[1.0, 1.03, 16]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.5) : "#00f0ff"} 
            toneMapped={false}
            opacity={glowActive ? 0.25 : 0.12} 
            transparent={true} 
          />
        </mesh>
      </group>
    </group>
  );
}
