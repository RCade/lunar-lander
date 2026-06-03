import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Static geometries to prevent allocation and garbage collection overhead
const canopyRingGeom = new THREE.TorusGeometry(2.0, 0.03, 8, 24, Math.PI);

const canopyStrutsGeom = new THREE.BufferGeometry();
canopyStrutsGeom.setAttribute('position', new THREE.Float32BufferAttribute([
  -1.5, -1.0, -2.5,  -1.0, 1.2, -2.0,
  1.5, -1.0, -2.5,  1.0, 1.2, -2.0,
  -2.0, -1.0, -2.5,  2.0, -1.0, -2.5,
  -1.0, 1.2, -2.0,   1.0, 1.2, -2.0
], 3));

const floorWindowGeom = new THREE.RingGeometry(1.2, 1.3, 8);

const horizonBarsGeom = new THREE.BufferGeometry();
horizonBarsGeom.setAttribute('position', new THREE.Float32BufferAttribute([
  -1.2, 0, 0,   -0.4, 0, 0,
  0.4, 0, 0,    1.2, 0, 0,
  -0.4, 0.1, 0,  -0.4, -0.1, 0,
  0.4, 0.1, 0,   0.4, -0.1, 0
], 3));

const horizonRingGeom = new THREE.RingGeometry(1.8, 1.83, 32);

const horizonMarksGeom = new THREE.BufferGeometry();
horizonMarksGeom.setAttribute('position', new THREE.Float32BufferAttribute([
  -1.8, 0, 0, -1.5, 0, 0,
  1.5, 0, 0, 1.8, 0, 0,
  0, 1.8, 0, 0, 1.6, 0
], 3));

const driftDiamondGeom = new THREE.RingGeometry(0.08, 0.12, 4);
const reticleCenterGeom = new THREE.CircleGeometry(0.03, 8);
const speedLimit1Geom = new THREE.RingGeometry(0.45, 0.48, 16);
const speedLimit2Geom = new THREE.RingGeometry(1.0, 1.03, 16);

export function Cockpit({ telemetryRef, glowActive, gameState }) {
  const cockpitRef = useRef();
  const artificialHorizonRef = useRef();
  const driftIndicatorRef = useRef();

  // Memoize materials based on glowActive status
  const canopyMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#ff5d00").multiplyScalar(1.5) : new THREE.Color("#ff5d00"),
      toneMapped: false,
      opacity: glowActive ? 0.65 : 0.4,
      transparent: true
    });
  }, [glowActive]);

  const strutsMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.8) : new THREE.Color("#00f0ff"),
      toneMapped: false,
      opacity: glowActive ? 0.65 : 0.35,
      transparent: true
    });
  }, [glowActive]);

  const floorWindowMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.8) : new THREE.Color("#00f0ff"),
      toneMapped: false,
      opacity: glowActive ? 0.9 : 0.6,
      transparent: true
    });
  }, [glowActive]);

  const pitchCenterMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.8) : new THREE.Color("#ffb700"),
      toneMapped: false,
      opacity: glowActive ? 0.95 : 0.7,
      transparent: true
    });
  }, [glowActive]);

  const horizonRingMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.5) : new THREE.Color("#ffb700"),
      toneMapped: false,
      opacity: glowActive ? 0.65 : 0.4,
      transparent: true
    });
  }, [glowActive]);

  const horizonMarksMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: glowActive ? new THREE.Color("#ffb700").multiplyScalar(1.8) : new THREE.Color("#ffb700"),
      toneMapped: false,
      opacity: glowActive ? 0.8 : 0.5,
      transparent: true
    });
  }, [glowActive]);

  const driftDiamondMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#ff007f").multiplyScalar(2.2) : new THREE.Color("#ff007f"),
      toneMapped: false,
      side: THREE.DoubleSide
    });
  }, [glowActive]);

  const driftCenterMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#ff007f").multiplyScalar(2.2) : new THREE.Color("#ff007f"),
      toneMapped: false
    });
  }, [glowActive]);

  const speedLimitMaterial1 = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.5) : new THREE.Color("#00f0ff"),
      toneMapped: false,
      opacity: glowActive ? 0.45 : 0.25,
      transparent: true
    });
  }, [glowActive]);

  const speedLimitMaterial2 = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#00f0ff").multiplyScalar(1.5) : new THREE.Color("#00f0ff"),
      toneMapped: false,
      opacity: glowActive ? 0.25 : 0.12,
      transparent: true
    });
  }, [glowActive]);

  useFrame((state) => {
    const cam = state.camera;
    const tel = telemetryRef.current;

    if (!cockpitRef.current) return;

    // Persistently mounted but toggle visibility dynamically inside useFrame
    const isVisible = tel && tel.cameraMode === 1 && gameState === 'playing';
    if (cockpitRef.current.visible !== isVisible) {
      cockpitRef.current.visible = isVisible;
    }

    if (!isVisible || !tel || !tel.position || !tel.upVector || !tel.velocity) return;

    // Cockpit must follow the camera position and rotation exactly (1st-person locking)
    cockpitRef.current.position.copy(cam.position);
    cockpitRef.current.quaternion.copy(cam.quaternion);

    // Update dynamic HUD overlays inside the cockpit frame:
    
    // 1. Artificial Horizon Rotation (opposite of lander rotation)
    if (artificialHorizonRef.current) {
      const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const upProj = tel.upVector.dot(localRight);
      artificialHorizonRef.current.rotation.set(0, 0, upProj * 2.0);
    }

    // 2. Horizontal Drift Diamond (moves relative to landing path)
    if (driftIndicatorRef.current) {
      const camRot = cam.quaternion.clone();
      const localVel = tel.velocity.clone().applyQuaternion(camRot.invert());

      const xHUD = THREE.MathUtils.clamp(-localVel.x * 0.4, -2.5, 2.5);
      const yHUD = THREE.MathUtils.clamp(-localVel.z * 0.4, -2.5, 2.5);

      driftIndicatorRef.current.position.set(xHUD, yHUD - 1.5, -5.0);
    }
  });

  return (
    <group ref={cockpitRef} visible={false}>
      {/* Canopy Structural Ribs */}
      <mesh position={[0, 0.5, -2]} geometry={canopyRingGeom} material={canopyMaterial} />

      {/* Vertical columns and horizontal cockpit struts */}
      <lineSegments geometry={canopyStrutsGeom} material={strutsMaterial} />

      {/* Floor window outline (looking down at terrain) */}
      <mesh position={[0, -2.0, -2.5]} rotation={[-Math.PI / 2.2, 0, 0]} geometry={floorWindowGeom} material={floorWindowMaterial} />

      {/* --- Dynamic Holographic HUD Elements (Projected in front of camera) --- */}

      {/* Pitch Ladder / Horizon Guide */}
      <group position={[0, 0, -4.5]}>
        <lineSegments geometry={horizonBarsGeom} material={pitchCenterMaterial} />

        {/* Artificial Horizon Ring (Rotates) */}
        <group ref={artificialHorizonRef}>
          <mesh rotation={[0, 0, 0]} geometry={horizonRingGeom} material={horizonRingMaterial} />
          <lineSegments geometry={horizonMarksGeom} material={horizonMarksMaterial} />
        </group>
      </group>

      {/* Dynamic Drift Diamond Reticle */}
      <group ref={driftIndicatorRef} position={[0, -1.5, -5.0]}>
        <mesh rotation={[0, 0, Math.PI / 4]} geometry={driftDiamondGeom} material={driftDiamondMaterial} />
        <mesh geometry={reticleCenterGeom} material={driftCenterMaterial} />
      </group>

      {/* Reticle guide circles for horizontal speed limits */}
      <group position={[0, -1.5, -5.0]}>
        <mesh geometry={speedLimit1Geom} material={speedLimitMaterial1} />
        <mesh geometry={speedLimit2Geom} material={speedLimitMaterial2} />
      </group>
    </group>
  );
}
