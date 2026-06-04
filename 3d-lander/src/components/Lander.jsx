import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { soundEngine } from './SoundEngine';
import { getTerrainHeight, terrainNoiseInstance, LANDING_PADS } from './Terrain';

// Lander configuration constants
const DRY_MASS = 1000;       // kg
const MAX_FUEL = 1000;       // kg (increased from 800)
const MAX_THRUST = 4500;     // N (enough to counter gravity and accelerate)
const FUEL_BURN_RATE = 15;   // kg/s at full throttle (decreased from 150)
const RCS_TORQUE = 2500;     // N*m for attitude control
const RCS_FORCE = 1200;      // N for translation control
const RCS_BURN_RATE = 1.5;   // kg/s per active thruster (decreased from 15)

// Moment of inertia tensor approximation (diagonal elements)
const I_XX = 1200;           // kg*m^2
const I_YY = 900;
const I_ZZ = 1200;

// Static geometries and configs for RCS pods and flames
const rcsPodGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
const rcsFlameGeom = new THREE.ConeGeometry(0.18, 1.2, 4);
rcsFlameGeom.translate(0, 0.6, 0); // shift origin to base of the cone (half of height 1.2)

const occludingMaterial = new THREE.MeshBasicMaterial({
  color: "#020204",
  depthWrite: true,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: 1.0,
  polygonOffsetUnits: 1.0
});

const RCS_JETS = [
  // Left Pod (pos: [-3.0, 0.5, 0])
  { podPos: [-3.0, 0.5, 0], jetPos: [-0.175, 0, 0], rot: [0, 0, Math.PI / 2], check: (input) => input.translateX > 0 }, // shoots Left (-X) when translating right (+X)
  { podPos: [-3.0, 0.5, 0], jetPos: [0, -0.175, 0], rot: [Math.PI, 0, 0], check: (input) => input.roll === 1 }, // shoots Down (-Y) when rolling right
  { podPos: [-3.0, 0.5, 0], jetPos: [0, 0, -0.175], rot: [-Math.PI / 2, 0, 0], check: (input) => input.yaw < 0 }, // shoots Forward (-Z) when yaw left
  { podPos: [-3.0, 0.5, 0], jetPos: [0, 0, 0.175], rot: [Math.PI / 2, 0, 0], check: (input) => input.yaw > 0 },  // shoots Backward (+Z) when yaw right

  // Right Pod (pos: [3.0, 0.5, 0])
  { podPos: [3.0, 0.5, 0], jetPos: [0.175, 0, 0], rot: [0, 0, -Math.PI / 2], check: (input) => input.translateX < 0 }, // shoots Right (+X) when translating left (-X)
  { podPos: [3.0, 0.5, 0], jetPos: [0, -0.175, 0], rot: [Math.PI, 0, 0], check: (input) => input.roll === -1 }, // shoots Down (-Y) when rolling left
  { podPos: [3.0, 0.5, 0], jetPos: [0, 0, 0.175], rot: [Math.PI / 2, 0, 0], check: (input) => input.yaw < 0 },    // shoots Backward (+Z) when yaw left
  { podPos: [3.0, 0.5, 0], jetPos: [0, 0, -0.175], rot: [-Math.PI / 2, 0, 0], check: (input) => input.yaw > 0 },   // shoots Forward (-Z) when yaw right

  // Front Pod (pos: [0, 0.5, -3.0])
  { podPos: [0, 0.5, -3.0], jetPos: [0, 0, -0.175], rot: [-Math.PI / 2, 0, 0], check: (input) => input.translateZ < 0 }, // shoots Forward (-Z) when translating backward
  { podPos: [0, 0.5, -3.0], jetPos: [0, -0.175, 0], rot: [Math.PI, 0, 0], check: (input) => input.pitch === 1 },  // shoots Down (-Y) when pitching up

  // Back Pod (pos: [0, 0.5, 3.0])
  { podPos: [0, 0.5, 3.0], jetPos: [0, 0, 0.175], rot: [Math.PI / 2, 0, 0], check: (input) => input.translateZ > 0 },  // shoots Backward (+Z) when translating forward
  { podPos: [0, 0.5, 3.0], jetPos: [0, -0.175, 0], rot: [Math.PI, 0, 0], check: (input) => input.pitch === -1 } // shoots Down (-Y) when pitching down
];

export function Lander({ gameState, setGameState, inputRef, telemetryRef, cameraRef, glowActive, hiddenLineActive }) {
  const landerRef = useRef();
  const visualGroupRef = useRef();
  const flameGroupRef = useRef();
  const blobRefs = useRef([]);
  if (blobRefs.current.length === 0) {
    for (let i = 0; i < 8; i++) {
      blobRefs.current.push(React.createRef());
    }
  }

  const rcsFlameRefs = useRef([]);
  if (rcsFlameRefs.current.length === 0) {
    for (let i = 0; i < 12; i++) {
      rcsFlameRefs.current.push(React.createRef());
    }
  }

  const rcsFlameMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: glowActive ? new THREE.Color("#ff5100").multiplyScalar(3.0) : "#ff5100",
      toneMapped: false,
      wireframe: true
    });
  }, [glowActive]);

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

  const flameBlobs = useRef([
    { y: 0, xOff: 0.15, zOff: -0.08, speed: 8.0, scale: 2.0 },
    { y: -0.7, xOff: -0.15, zOff: 0.15, speed: 9.0, scale: 1.8 },
    { y: -1.4, xOff: 0.08, zOff: -0.15, speed: 7.5, scale: 1.5 },
    { y: -2.1, xOff: -0.08, zOff: 0.08, speed: 8.5, scale: 1.2 },
    { y: -2.8, xOff: 0.12, zOff: -0.12, speed: 7.0, scale: 0.9 },
    { y: -3.5, xOff: -0.12, zOff: 0.12, speed: 8.0, scale: 0.6 },
    { y: -4.2, xOff: 0.05, zOff: -0.05, speed: 9.5, scale: 0.4 },
    { y: -4.9, xOff: 0.0, zOff: 0.0, speed: 10.0, scale: 0.2 },
  ]);

  // Re-initialization when resetting levels
  useEffect(() => {
    window.__physicsState = physicsState;
  }, []);

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
        cameraFocusMode: input.cameraFocusMode || 0,
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

    // --- PROCEDURAL FLAME BLOB UPDATES ---
    const isThrottling = gameState === 'playing' && throttle > 0.05;
    if (flameGroupRef.current) {
      flameGroupRef.current.visible = isThrottling;
    }
    if (isThrottling) {
      flameBlobs.current.forEach((blob, index) => {
        blob.y -= dt * blob.speed * (0.5 + 0.5 * throttle);
        if (blob.y < -6.0) {
          blob.y = 0;
          blob.xOff = (Math.random() - 0.5) * 0.5;
          blob.zOff = (Math.random() - 0.5) * 0.5;
        }

        const ref = blobRefs.current[index]?.current;
        if (ref) {
          const currentY = blob.y;
          const progress = Math.min(Math.max(-currentY / 6.0, 0), 1);
          const scaleFactor = (1.0 - progress) * blob.scale * (0.3 + 0.7 * throttle);
          
          if (scaleFactor <= 0.01) {
            ref.visible = false;
          } else {
            ref.visible = true;
            ref.position.set(blob.xOff, -1.5 + currentY, blob.zOff);
            ref.scale.setScalar(scaleFactor);
          }
        }
      });
    }

    // --- RCS JETS FLAME ANIMATION ---
    RCS_JETS.forEach((jet, index) => {
      const ref = rcsFlameRefs.current[index]?.current;
      if (ref) {
        const isFiring = hasFuel && gameState === 'playing' && jet.check(input);
        ref.visible = isFiring;
        if (isFiring) {
          // Flicker scale along height (Y axis in translated cone space)
          const flicker = 0.5 + Math.random() * 0.8;
          ref.scale.set(1.0, flicker, 1.0);
        }
      }
    });

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
      cameraFocusMode: input.cameraFocusMode || 0,
    };
  });

  // Render components for visual plumes
  const inputState = inputRef.current;

  return (
    <group ref={landerRef}>
      <group ref={visualGroupRef}>
        {/* 3D Wireframe Lander Geometry */}
        
        {/* Lander Core Chassis (Octagonal cylinder shape) */}
        <mesh position={[0, 0, 0]} visible={hiddenLineActive}>
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
  
        {/* Lander Cockpit Geodesic Dome */}
        <mesh position={[0, 1.2, 0]} visible={hiddenLineActive}>
          <dodecahedronGeometry args={[2.2, 1]} />
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
          <dodecahedronGeometry args={[2.2, 1]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
            toneMapped={false}
            wireframe={true} 
          />
        </mesh>

        {/* Top Docking / Hatch Ring */}
        <mesh position={[0, 3.2, 0]} rotation={[Math.PI / 2, 0, 0]} visible={hiddenLineActive}>
          <cylinderGeometry args={[0.6, 0.6, 0.4, 6]} />
          <meshBasicMaterial 
            color="#020204"
            depthWrite={true}
            toneMapped={false}
            polygonOffset={true}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        <mesh position={[0, 3.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 0.4, 6]} />
          <meshBasicMaterial 
            color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
            toneMapped={false}
            wireframe={true} 
          />
        </mesh>

        {/* Sensor Spire & Communications Antenna Array */}
        <lineSegments>
          <bufferGeometry>
            <float32BufferAttribute
              attach="attributes-position"
              args={[new Float32Array([
                // Main antenna spire
                0, 3.4, 0,  0, 4.6, 0,
                // Left whisker
                0, 3.2, 0, -0.5, 3.9, 0,
                // Right whisker
                0, 3.2, 0,  0.5, 3.9, 0
              ]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial 
            color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
            toneMapped={false}
          />
        </lineSegments>
  
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
              <mesh position={[1.5, -0.6, 0]} rotation={[0, 0, 0]} visible={hiddenLineActive}>
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
        <mesh position={[0, -1.2, 0]} visible={hiddenLineActive}>
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
  
        {/* Procedural engine thruster fire (metaball-like dynamic wireframe blobs) */}
        <group ref={flameGroupRef} visible={false}>
          {flameBlobs.current.map((blob, index) => (
            <group key={index} ref={blobRefs.current[index]}>
              {/* Solid background mesh to occlude terrain/lander legs */}
              <mesh visible={hiddenLineActive}>
                <icosahedronGeometry args={[0.8, 0]} />
                <meshBasicMaterial 
                  color="#020204"
                  depthWrite={true}
                  toneMapped={false}
                  polygonOffset={true}
                  polygonOffsetFactor={1.0}
                  polygonOffsetUnits={1.0}
                />
              </mesh>
              {/* Wireframe glowing flame mesh */}
              <mesh>
                <icosahedronGeometry args={[0.8, 0]} />
                <meshBasicMaterial 
                  color={glowActive ? new THREE.Color("#ff5100").multiplyScalar(3.0) : "#ff5100"} 
                  toneMapped={false}
                  wireframe={true} 
                />
              </mesh>
            </group>
          ))}
        </group>

        {/* Physical RCS Pod Housings */}
        {[
          [-3.0, 0.5, 0],
          [3.0, 0.5, 0],
          [0, 0.5, -3.0],
          [0, 0.5, 3.0]
        ].map((pos, idx) => (
          <group key={idx} position={pos}>
            <mesh visible={hiddenLineActive} geometry={rcsPodGeom} material={occludingMaterial} />
            <mesh geometry={rcsPodGeom}>
              <meshBasicMaterial 
                color={glowActive ? new THREE.Color("#ffffff").multiplyScalar(1.8) : "#ffffff"} 
                toneMapped={false}
                wireframe={true} 
              />
            </mesh>
          </group>
        ))}

        {/* RCS Jets Flames */}
        {RCS_JETS.map((jet, index) => {
          const nozzlePos = [
            jet.podPos[0] + jet.jetPos[0],
            jet.podPos[1] + jet.jetPos[1],
            jet.podPos[2] + jet.jetPos[2]
          ];
          return (
            <group 
              key={index} 
              ref={rcsFlameRefs.current[index]} 
              position={nozzlePos} 
              rotation={jet.rot}
              visible={false}
            >
              <mesh visible={hiddenLineActive} geometry={rcsFlameGeom} material={occludingMaterial} />
              <mesh geometry={rcsFlameGeom} material={rcsFlameMaterial} />
            </group>
          );
        })}
  
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
