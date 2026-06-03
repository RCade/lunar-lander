import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { soundEngine } from './SoundEngine';
import { getTerrainHeight, terrainNoiseInstance, LANDING_PADS } from './Terrain';

// Lander configuration constants
const DRY_MASS = 1000;       // kg
const MAX_FUEL = 800;        // kg
const MAX_THRUST = 4500;     // N (enough to counter gravity and accelerate)
const FUEL_BURN_RATE = 150;  // kg/s at full throttle
const RCS_TORQUE = 2500;     // N*m for attitude control
const RCS_FORCE = 1200;      // N for translation control
const RCS_BURN_RATE = 15;    // kg/s per active thruster

// Moment of inertia tensor approximation (diagonal elements)
const I_XX = 1200;           // kg*m^2
const I_YY = 900;
const I_ZZ = 1200;

export function Lander({ gameState, setGameState, inputRef, telemetryRef, cameraRef, glowActive }) {
  const landerRef = useRef();
  const visualGroupRef = useRef();

  // Physics state refs to avoid React re-render lags
  const physicsState = useRef({
    position: new THREE.Vector3(0, 150, 0), // Start floating high
    velocity: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    fuel: MAX_FUEL,
    thrustInput: 0,
    sasActive: true,
  });

  // Re-initialization when resetting levels
  useEffect(() => {
    if (gameState === 'playing') {
      physicsState.current.position.set(0, 150, 0);
      physicsState.current.velocity.set(10, 0, -5); // Add initial drifting speed for fun
      physicsState.current.quaternion.set(0, 0, 0, 1);
      physicsState.current.angularVelocity.set(0, 0, 0);
      physicsState.current.fuel = MAX_FUEL;
      soundEngine.init();
      soundEngine.stopAlarm();
    }
  }, [gameState]);

  useFrame((state, delta) => {
    // Clamp delta to prevent massive physics steps when window loses focus
    const dt = Math.min(delta, 0.05);
    const pState = physicsState.current;
    const input = inputRef.current;

    if (gameState !== 'playing') {
      soundEngine.setThrustLevel(0);
      
      // Sync visual mesh and write baseline telemetry even when not playing (e.g. menu)
      if (landerRef.current) {
        landerRef.current.position.copy(pState.position);
        landerRef.current.quaternion.copy(pState.quaternion);
        if (visualGroupRef.current) {
          visualGroupRef.current.visible = (input.cameraMode === 3);
        }
      }
      
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(pState.quaternion);
      const localForward = new THREE.Vector3(0, 0, -1).applyQuaternion(pState.quaternion);
      const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(pState.quaternion);
      const terrainHeight = getTerrainHeight(pState.position.x, pState.position.z, terrainNoiseInstance);
      
      telemetryRef.current = {
        altitude: Math.max(0, pState.position.y - terrainHeight - 1.2),
        vVel: pState.velocity.y,
        hVel: Math.sqrt(pState.velocity.x * pState.velocity.x + pState.velocity.z * pState.velocity.z),
        fuelPct: (pState.fuel / MAX_FUEL) * 100,
        pitch: Math.acos(THREE.MathUtils.clamp(localUp.dot(new THREE.Vector3(0, 1, 0)), -1, 1)) * (180 / Math.PI),
        position: pState.position.clone(),
        velocity: pState.velocity.clone(),
        upVector: localUp.clone(),
        forwardVector: localForward.clone(),
        rightVector: localRight.clone(),
        sasActive: input.sasActive,
        cameraMode: input.cameraMode,
      };
      return;
    }

    // Apply keyboard controls decay
    // (inputs updateInputs must run on every frame)
    // Note: useInput updates inputs.current directly, which is handled in parent App.jsx
    
    // Check if we have fuel
    const hasFuel = pState.fuel > 0;
    const throttle = hasFuel ? input.throttle : 0;
    
    // Calculate fuel consumption
    let activeRcsCount = 0;
    if (hasFuel) {
      if (input.pitch !== 0) activeRcsCount++;
      if (input.roll !== 0) activeRcsCount++;
      if (input.yaw !== 0) activeRcsCount++;
      if (input.translateX !== 0) activeRcsCount++;
      if (input.translateZ !== 0) activeRcsCount++;
    }

    const fuelConsumed = (throttle * FUEL_BURN_RATE + activeRcsCount * RCS_BURN_RATE) * dt;
    pState.fuel = Math.max(0, pState.fuel - fuelConsumed);

    // Compute mass
    const mass = DRY_MASS + pState.fuel;

    // Get current attitude vectors from quaternion
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(pState.quaternion);
    const localForward = new THREE.Vector3(0, 0, -1).applyQuaternion(pState.quaternion);
    const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(pState.quaternion);

    // --- TRANSLATIONAL PHYSICS ---
    // 1. Gravity Force
    const F_gravity = new THREE.Vector3(0, -1.62 * mass, 0);

    // 2. Main Thruster Force
    const F_thrust = localUp.clone().multiplyScalar(throttle * MAX_THRUST);

    // 3. RCS Translation Force (Grip Squeezed Mode)
    const F_rcs = new THREE.Vector3(0, 0, 0);
    if (hasFuel) {
      if (input.translateX !== 0) {
        F_rcs.add(localRight.clone().multiplyScalar(input.translateX * RCS_FORCE));
      }
      if (input.translateZ !== 0) {
        F_rcs.add(localForward.clone().multiplyScalar(input.translateZ * RCS_FORCE));
      }
    }

    // Net Force and Acceleration
    const F_net = new THREE.Vector3().addVectors(F_gravity, F_thrust).add(F_rcs);
    const acceleration = F_net.divideScalar(mass);

    // Integrate Linear Velocity & Position
    pState.velocity.addScaledVector(acceleration, dt);
    pState.position.addScaledVector(pState.velocity, dt);

    // --- ROTATIONAL PHYSICS ---
    const torques = new THREE.Vector3(0, 0, 0);
    if (hasFuel) {
      // Manual control torques (pitch -> X, yaw -> Y, roll -> Z)
      torques.x += input.pitch * RCS_TORQUE;
      torques.y += input.yaw * RCS_TORQUE;
      torques.z += input.roll * RCS_TORQUE;
    }

    // SAS Dampening (fired if manual controls are zero)
    if (input.sasActive) {
      const dampFactor = 5.0; // strength of SAS damping
      if (input.pitch === 0) torques.x -= pState.angularVelocity.x * dampFactor * I_XX;
      if (input.yaw === 0) torques.y -= pState.angularVelocity.y * dampFactor * I_YY;
      if (input.roll === 0) torques.z -= pState.angularVelocity.z * dampFactor * I_ZZ;
    }

    // Angular Acceleration in local coordinates: alpha = I^-1 * torque
    const angularAcc = new THREE.Vector3(
      torques.x / I_XX,
      torques.y / I_YY,
      torques.z / I_ZZ
    );

    // Integrate Angular Velocity
    pState.angularVelocity.addScaledVector(angularAcc, dt);

    // Integrate Orientation Quaternion
    const qSpin = new THREE.Quaternion(
      pState.angularVelocity.x * dt * 0.5,
      pState.angularVelocity.y * dt * 0.5,
      pState.angularVelocity.z * dt * 0.5,
      1.0
    );
    pState.quaternion.multiply(qSpin).normalize();

    // Sync object to 3D scene
    if (landerRef.current) {
      landerRef.current.position.copy(pState.position);
      landerRef.current.quaternion.copy(pState.quaternion);
      if (visualGroupRef.current) {
        visualGroupRef.current.visible = (input.cameraMode === 3);
      }
    }

    // --- SOUND GRAPH UPDATES ---
    soundEngine.setThrustLevel(throttle);
    const lowFuel = pState.fuel < MAX_FUEL * 0.2;
    const criticalVelocity = pState.velocity.y < -2.0;

    if (lowFuel || (pState.position.y < 35 && criticalVelocity)) {
      soundEngine.startAlarm(pState.position.y < 15); // Fast warning beep close to terrain
    } else {
      soundEngine.stopAlarm();
    }

    // --- COLLISION DETECTION ---
    const terrainHeight = getTerrainHeight(pState.position.x, pState.position.z, terrainNoiseInstance);

    if (pState.position.y <= terrainHeight + 1.2) { // 1.2 is structural lander height offset
      pState.position.y = terrainHeight + 1.2;
      pState.velocity.set(0, 0, 0);
      pState.angularVelocity.set(0, 0, 0);
      soundEngine.stopAlarm();

      // Check Landing Status
      let landedSafety = false;
      let padMultiplier = 1;
      let landedPadColor = '#ffffff';

      // Check if over a landing pad
      for (const pad of LANDING_PADS) {
        const dx = pState.position.x - pad.x;
        const dz = pState.position.z - pad.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= pad.radius) {
          // Landing checks
          const vSpeed = Math.abs(pState.velocity.y); // Note: velocity was set to zero on contact, so check preceding vertical velocity!
          // Since we want actual landing speed, we read it from telemetryRef or look ahead
          landedSafety = true;
          padMultiplier = pad.multiplier;
          landedPadColor = pad.color;
          break;
        }
      }

      // Re-sample preceding velocities (before impact dampening)
      const finalVSpeed = Math.abs(telemetryRef.current.vVel);
      const finalHSpeed = telemetryRef.current.hVel;
      const tiltAngle = Math.acos(localUp.dot(new THREE.Vector3(0, 1, 0))) * (180 / Math.PI);

      if (landedSafety && finalVSpeed <= 2.2 && finalHSpeed <= 1.2 && tiltAngle <= 8.5) {
        // Success
        setGameState('landed');
        soundEngine.playLandingTune();
      } else {
        // Crash
        setGameState('crashed');
        soundEngine.playExplosion();
      }
    }

    // --- WRITE TELEMETRY REF FOR HUD ---
    const tilt = Math.acos(THREE.MathUtils.clamp(localUp.dot(new THREE.Vector3(0, 1, 0)), -1, 1)) * (180 / Math.PI);
    telemetryRef.current = {
      altitude: Math.max(0, pState.position.y - terrainHeight - 1.2),
      vVel: pState.velocity.y,
      hVel: Math.sqrt(pState.velocity.x * pState.velocity.x + pState.velocity.z * pState.velocity.z),
      fuelPct: (pState.fuel / MAX_FUEL) * 100,
      pitch: tilt,
      position: pState.position.clone(),
      velocity: pState.velocity.clone(),
      upVector: localUp.clone(),
      forwardVector: localForward.clone(),
      rightVector: localRight.clone(),
      sasActive: input.sasActive,
      cameraMode: input.cameraMode,
    };
  });

  // Render components for visual plumes
  const inputState = inputRef.current;

  return (
    <group ref={landerRef}>
      <group ref={visualGroupRef}>
        {/* 3D Wireframe Lander Geometry */}
        
        {/* Lander Core Chassis (Octagonal cylinder shape) */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[2.5, 3.5, 2.0, 8]} />
          <meshBasicMaterial 
            color="#020204"
            depthWrite={true}
            toneMapped={false}
            polygonOffset={true}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[2.5, 3.5, 2.0, 8]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
            toneMapped={false}
            wireframe={true} 
          />
        </mesh>
  
        {/* Lander Cockpit Sphere Dome */}
        <mesh position={[0, 1.2, 0]}>
          <sphereGeometry args={[2.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial 
            color="#020204"
            depthWrite={true}
            toneMapped={false}
            polygonOffset={true}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        <mesh position={[0, 1.2, 0]}>
          <sphereGeometry args={[2.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#00ffb7").multiplyScalar(2.0) : "#00ffb7"} 
            toneMapped={false}
            wireframe={true} 
          />
        </mesh>
  
        {/* Landing Legs / Struts */}
        {/* Four landing struts placed at 45 degree intervals */}
        {[0, 1, 2, 3].map((i) => {
          const angle = (i * Math.PI) / 2 + Math.PI / 4;
          const x = Math.cos(angle) * 3.2;
          const z = Math.sin(angle) * 3.2;
          return (
            <group key={i} rotation={[0, -angle, 0]} position={[0, -1.0, 0]}>
              {/* Primary leg strut */}
              <line>
                <bufferGeometry>
                  <float32BufferAttribute
                    attach="attributes-position"
                    args={[new Float32Array([0, 0.5, 0, 1.5, -0.6, 0]), 3]}
                  />
                </bufferGeometry>
                <lineBasicMaterial 
                  color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
                  toneMapped={false}
                />
              </line>
              
              {/* Footpad */}
              <mesh position={[1.5, -0.6, 0]} rotation={[0, 0, 0]}>
                <cylinderGeometry args={[0.6, 0.6, 0.15, 6]} />
                <meshBasicMaterial 
                  color="#020204"
                  depthWrite={true}
                  toneMapped={false}
                  polygonOffset={true}
                  polygonOffsetFactor={1}
                  polygonOffsetUnits={1}
                />
              </mesh>
              <mesh position={[1.5, -0.6, 0]} rotation={[0, 0, 0]}>
                <cylinderGeometry args={[0.6, 0.6, 0.15, 6]} />
                <meshBasicMaterial 
                  color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
                  toneMapped={false}
                  wireframe={true} 
                />
              </mesh>
            </group>
          );
        })}
  
        {/* Main Engine Nozzle */}
        <mesh position={[0, -1.2, 0]}>
          <cylinderGeometry args={[0.3, 0.8, 0.6, 6]} />
          <meshBasicMaterial 
            color="#020204"
            depthWrite={true}
            toneMapped={false}
            polygonOffset={true}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        <mesh position={[0, -1.2, 0]}>
          <cylinderGeometry args={[0.3, 0.8, 0.6, 6]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.5) : "#ffffff"} 
            toneMapped={false}
            wireframe={true} 
          />
        </mesh>
  
        {/* Main engine thruster fire (vector lines) */}
        {gameState === 'playing' && inputRef.current.throttle > 0.05 && (
          <mesh position={[0, -2.0, 0]} scale={[1, inputRef.current.throttle * 2.5, 1]}>
            <coneGeometry args={[0.6, 1.2, 6, 1, true]} />
            <meshBasicMaterial 
              color={glowActive ? new THREE.Color("#ff5100").multiplyScalar(3.0) : "#ff5100"} 
              toneMapped={false}
              wireframe={true} 
            />
          </mesh>
        )}
  
        {/* RCS Jets HUD Visualizer (lines shooting out) */}
        {gameState === 'playing' && inputRef.current.yaw !== 0 && (
          <group position={[0, 0.8, 0]}>
            {/* Small line representing gas firing left/right */}
            <line>
              <bufferGeometry>
                <float32BufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([
                    0, 0, 0, 
                    inputRef.current.yaw * 1.5, 0, 0
                  ]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial 
                color={glowActive ? new THREE.Color("#00f0ff").multiplyScalar(2.2) : "#00f0ff"} 
                toneMapped={false}
              />
            </line>
          </group>
        )}
  
        {/* Direction indicators for Pitch and Roll RCS */}
        {gameState === 'playing' && (inputRef.current.pitch !== 0 || inputRef.current.roll !== 0) && (
          <group position={[0, 1.8, 0]}>
            <line>
              <bufferGeometry>
                <float32BufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([
                    0, 0, 0,
                    inputRef.current.roll * 1.2, -inputRef.current.pitch * 1.2, 0
                  ]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial 
                color={glowActive ? new THREE.Color("#00ff88").multiplyScalar(2.2) : "#00ff88"} 
                toneMapped={false}
              />
            </line>
          </group>
        )}
      </group>
    </group>
  );
}
