import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInput } from './hooks/useInput';
import { soundEngine } from './components/SoundEngine';
import { Lander } from './components/Lander';
import { Terrain, LANDING_PADS } from './components/Terrain';
import { Starfield } from './components/Starfield';
import { Cockpit } from './components/Cockpit';

// --- Throttled UI Telemetry Updater ---
// Read values from ref to keep canvas rendering at full framerate (no react re-render overhead)
function TelemetryListener({ telemetryRef, setUiTelemetry }) {
  const lastUpdate = useRef(0);
  
  useFrame((state) => {
    const now = state.clock.getElapsedTime();
    // Update HTML HUD UI every 100ms
    if (now - lastUpdate.current > 0.1 && telemetryRef.current) {
      setUiTelemetry({ ...telemetryRef.current });
      lastUpdate.current = now;
    }
  });
  return null;
}

// --- 3D Camera Spring-Damper Controller ---
function CameraController({ cameraMode, telemetryRef }) {
  const velCamera = useRef(new THREE.Vector3(0, 0, 0));
  const isFirstFrame = useRef(true);

  useFrame((state, delta) => {
    const tel = telemetryRef.current;
    if (!tel || !tel.position || !tel.upVector || !tel.velocity || !tel.forwardVector || !tel.rightVector) return;

    const camera = state.camera;
    const landerPos = tel.position;
    const up = tel.upVector;
    const localForward = tel.forwardVector;
    const localRight = tel.rightVector;

    const dt = Math.min(delta, 0.03); // clamp time step to prevent physics explosion
    if (state.clock.getElapsedTime() % 1 < 0.05) { // Log once every second
      console.log("DEBUG TELEMETRY JSON: " + JSON.stringify({
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        landerPos: [landerPos.x, landerPos.y, landerPos.z],
        forward: [localForward.x, localForward.y, localForward.z],
        up: [up.x, up.y, up.z],
        velCamera: [velCamera.current.x, velCamera.current.y, velCamera.current.z],
        isFirstFrame: isFirstFrame.current,
        cameraMode: cameraMode
      }));
    }

    if (cameraMode === 3) {
      // --- 3rd-Person Chase Camera Spring-Damper ---
      // Position target is behind and above the lander
      const idealCameraPos = landerPos.clone()
        .addScaledVector(up, 7.5)                // 7.5 units above
        .addScaledVector(localForward, -16.0);    // 16 units behind

      if (isFirstFrame.current) {
        camera.position.copy(idealCameraPos);
        isFirstFrame.current = false;
      }

      const stiffness = 8.0; // Spring constant
      const damping = 4.0;   // Damping constant

      // Distance error
      const err = idealCameraPos.clone().sub(camera.position);

      // Force = stiffness * error - damping * velocity
      const force = err.multiplyScalar(stiffness).addScaledVector(velCamera.current, -damping);

      // Integrate camera speed & location
      velCamera.current.addScaledVector(force, dt);
      camera.position.addScaledVector(velCamera.current, dt);

      // Target lookat is slightly in front of the lander to anticipate movement
      const lookAtTarget = landerPos.clone().addScaledVector(localForward, 3.0);
      camera.lookAt(lookAtTarget);
    } else {
      // --- 1st-Person Cockpit Camera ---
      // Lock position straight inside the capsule cockpit
      const cockpitOffset = up.clone().multiplyScalar(1.2); // pilot eye height
      camera.position.copy(landerPos).add(cockpitOffset);

      // Look straight forward relative to lander attitude
      const lookTarget = camera.position.clone().add(localForward.clone().multiplyScalar(10));
      camera.lookAt(lookTarget);

      // Reset chase spring states
      velCamera.current.set(0, 0, 0);
      isFirstFrame.current = true;
    }
  });

  return null;
}

export default function App() {
  const [gameState, setGameState] = useState('menu'); // menu, playing, landed, crashed
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(2500);
  const [isMuted, setIsMuted] = useState(false);
  const [logs, setLogs] = useState([
    { text: 'Flight deck systems offline', time: '0.0s' },
    { text: 'Waiting for boot command...', time: '0.0s' }
  ]);

  // Unified input capture hook
  const { inputs, updateInputs } = useInput();

  // Shared telemetry references (fast physics to flat HUD interface binding)
  const telemetryRef = useRef({
    altitude: 150,
    vVel: 0,
    hVel: 0,
    fuelPct: 100,
    pitch: 0,
    sasActive: true,
    cameraMode: 3,
  });

  // Local state copy for React UI rendering
  const [uiTelemetry, setUiTelemetry] = useState({
    altitude: 150,
    vVel: 0,
    hVel: 0,
    fuelPct: 100,
    pitch: 0,
    sasActive: true,
    cameraMode: 3,
  });

  const startTime = useRef(0);

  // Hook up sound synthesizer toggle
  const toggleMute = () => {
    const mutedState = soundEngine.toggleMute();
    setIsMuted(mutedState);
    addLog(`Synthesizer audio ${mutedState ? 'muted' : 'unmuted'}`);
  };

  // Telemetry logger helper
  const addLog = (text) => {
    const stamp = ((Date.now() - startTime.current) / 1000).toFixed(1);
    setLogs((prev) => [{ text, time: `${stamp}s` }, ...prev.slice(0, 7)]);
  };

  // Keyboard loop hook for updating analog controls
  useEffect(() => {
    let animId;
    let lastT = performance.now();
    const loop = (now) => {
      const dt = (now - lastT) / 1000;
      lastT = now;
      updateInputs(dt);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [updateInputs]);

  // Handle game state transitions
  const startGame = () => {
    startTime.current = Date.now();
    setGameState('playing');
    addLog('Rocket systems ignited');
    addLog('Attitude assistance initialized');
  };

  const handleNextLevel = () => {
    // Add leftover fuel to score
    const fuelBonus = Math.floor(telemetryRef.current.fuelPct * 10);
    setScore(s => s + 500 + fuelBonus);
    addLog(`Descent touchdown complete. Bonus +${500 + fuelBonus}`);
    setGameState('playing');
  };

  const handleRetry = () => {
    setScore(0);
    setGameState('playing');
    addLog('Respawning descent module...');
  };

  useEffect(() => {
    if (gameState === 'crashed') {
      addLog('COLLISION / EXPLOSION DETECTED');
    }
    if (gameState === 'landed') {
      addLog('TOUCHDOWN COMPLETED (SAFE)');
    }
  }, [gameState]);

  return (
    <div className="game-container" style={{ display: 'flex', width: '100%', maxWidth: '1300px', gap: '20px' }}>
      
      {/* --- Left Telemetry Sidebar Panel --- */}
      <div className="sidebar" style={{ flex: '0 0 310px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h2>TELEMETRY DECK</h2>
        
        {/* Fuel Meter block */}
        <div className="info-block">
          <h3>Fuel Stores</h3>
          <div className="fuel-meter-container">
            <div 
              className={`fuel-meter-bar ${uiTelemetry.fuelPct < 20 ? 'low' : ''}`} 
              style={{ width: `${uiTelemetry.fuelPct}%` }}
            ></div>
          </div>
          <div className="key-row" style={{ marginTop: '8px' }}>
            <span>FUEL STORES:</span>
            <span>{Math.round(uiTelemetry.fuelPct)}%</span>
          </div>
        </div>

        {/* Instrument telemetry grids */}
        <div className="info-block">
          <h3>Instrument Feeds</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="label">V. Velocity</span>
              <span className={`value ${Math.abs(uiTelemetry.vVel) > 2.2 ? 'color-red' : 'color-green'}`}>
                {uiTelemetry.vVel.toFixed(1)} m/s
              </span>
            </div>
            <div className="stat-card">
              <span className="label">H. Velocity</span>
              <span className={`value ${uiTelemetry.hVel > 1.2 ? 'color-red' : 'color-green'}`}>
                {uiTelemetry.hVel.toFixed(1)} m/s
              </span>
            </div>
            <div className="stat-card">
              <span className="label">Altitude</span>
              <span className="value">{Math.round(uiTelemetry.altitude)} m</span>
            </div>
            <div className="stat-card">
              <span className="label">Pitch / Tilt</span>
              <span className={`value ${uiTelemetry.pitch > 8.5 ? 'color-red' : 'color-green'}`}>
                {Math.round(uiTelemetry.pitch)}°
              </span>
            </div>
          </div>
        </div>

        {/* Flight control indicators */}
        <div className="info-block">
          <h3>Flight Assist</h3>
          <div className="key-row">
            <span>SAS Dampener</span>
            <span className={uiTelemetry.sasActive ? 'color-green' : 'color-red'} style={{ fontWeight: 'bold' }}>
              {uiTelemetry.sasActive ? 'ACTIVE' : 'OFF'} [T]
            </span>
          </div>
          <div className="key-row" style={{ marginTop: '6px' }}>
            <span>Active Camera</span>
            <span className="kbd-key">{uiTelemetry.cameraMode === 3 ? 'CHASE' : 'COCKPIT'} [C]</span>
          </div>
        </div>

        {/* Sound toggle panel */}
        <div className="info-block">
          <h3>Sound Card</h3>
          <div className="audio-toggle" onClick={toggleMute}>
            <span>Retro Synthesizer</span>
            <span className="audio-icon">{isMuted ? '🔇 MUTED' : '🔊 ON'}</span>
          </div>
        </div>

        {/* Live log feed */}
        <div className="info-block" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '130px' }}>
          <h3>Command Log</h3>
          <div className="log-list" style={{ flexGrow: 1 }}>
            {logs.map((log, i) => (
              <div key={i} className="log-item">
                <span>{log.text}</span>
                <span>{log.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- Central Cabinet monitor containing WebGL R3F Canvas --- */}
      <div className="monitor-cabinet" style={{ flex: 1, position: 'relative' }}>
        <div className="screen-wrapper">
          
          {/* React Three Fiber Canvas */}
          <Canvas
            gl={{ antialias: false }} // Keep it aliased for that sharp vector CRT look
            onCreated={({ gl }) => {
              gl.setClearColor('#020204');
            }}
          >
            <Suspense fallback={null}>
              {/* Direct ambient fill */}
              <ambientLight intensity={0.15} />

              {/* Procedural 3D Terrain */}
              <Terrain />

              {/* 3D Lander */}
              <Lander
                gameState={gameState}
                setGameState={setGameState}
                inputRef={inputs}
                telemetryRef={telemetryRef}
              />

              {/* Space particle field */}
              <Starfield count={600} />

              {/* First-person cockpit wireframe HUD */}
              {uiTelemetry.cameraMode === 1 && gameState === 'playing' && (
                <Cockpit telemetryRef={telemetryRef} />
              )}

              {/* Spring camera updates */}
              <CameraController cameraMode={uiTelemetry.cameraMode} telemetryRef={telemetryRef} />

              {/* Keep physics frame listener mapping to UI */}
              <TelemetryListener telemetryRef={telemetryRef} setUiTelemetry={setUiTelemetry} />
            </Suspense>
          </Canvas>

          {/* CRT screen visual layer effects */}
          <div className="scanlines"></div>
          <div className="crt-glare"></div>
          <div className="crt-flicker-overlay"></div>

          {/* Overlaid UI screens inside Cabinet */}

          {/* 1. Menu Boot Screen */}
          {gameState === 'menu' && (
            <div id="screen-start" className="overlay-screen">
              <h2 className="color-cyan" style={{ fontSize: '1.4rem' }}>APOLLO 3D SIMULATOR</h2>
              <p className="msg-primary" style={{ letterSpacing: '2px' }}>DESKTOP TESTING INTERFACE</p>
              <p className="msg-secondary" style={{ fontSize: '0.8rem' }}>
                Pilot the 3D Lunar Module using classic 6-DOF controls. Pitch, Roll, and Yaw vector stabilization is handled in dynamic vacuum flight.
                <br/><br/>
                Controls: <b>SPACEBAR</b> for Main Engine. <b>Arrows (or I/K/J/L)</b> to tilt. Hold <b>L-SHIFT + WASD</b> to translate laterally.
              </p>
              <button className="btn-arcade" onClick={startGame}>BOOT FLIGHT CORE</button>
            </div>
          )}

          {/* 2. Landing Success Screen */}
          {gameState === 'landed' && (
            <div id="screen-landed" className="overlay-screen">
              <h2 className="color-green" style={{ fontSize: '1.5rem' }}>TOUCHDOWN SUCCESSFUL</h2>
              <p className="msg-primary" style={{ color: '#39ff14' }}>DESCENT RATE STABLE (SAFE)</p>
              <p className="msg-secondary">
                Altitude: 0m. Landing Speed is safe. Core systems telemetry verification completed. Fuel stores harvested.
              </p>
              <button className="btn-arcade" onClick={handleNextLevel}>INIT NEXT DESCENT</button>
            </div>
          )}

          {/* 3. Crash Screen */}
          {gameState === 'crashed' && (
            <div id="screen-crashed" className="overlay-screen">
              <h2 className="color-red" style={{ fontSize: '1.5rem' }}>CRITICAL HULL EXPLOSION</h2>
              <p className="msg-primary" style={{ color: '#ff3c3c' }}>IMPACT STRUCTURAL FAILURE</p>
              <p className="msg-secondary">
                Module exceeded safe structural limits on terrain touchdown. Astronaut modules lost on surface.
              </p>
              <button className="btn-arcade" onClick={handleRetry}>REDEPLOY descent MODULE</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
