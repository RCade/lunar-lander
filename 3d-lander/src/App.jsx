import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useInput } from './hooks/useInput';
import { soundEngine } from './components/SoundEngine';
import { Lander } from './components/Lander';
import { Terrain, LANDING_PADS } from './components/Terrain';
import { Starfield } from './components/Starfield';
import { Cockpit } from './components/Cockpit';
import { EffectComposer, Bloom, SMAA } from '@react-three/postprocessing';
import { ThreeWayViewport } from './components/ThreeWayViewport';

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
// --- 3D Camera Spring-Damper Controller ---
function CameraController({ telemetryRef }) {
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
    const cameraMode = tel.cameraMode;
    const cameraFocusMode = tel.cameraFocusMode || 0;

    const dt = Math.min(delta, 0.03); // clamp time step to prevent physics explosion
    if (state.clock.getElapsedTime() % 1 < 0.05) { // Log once every second
      console.log("DEBUG TELEMETRY JSON: " + JSON.stringify({
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        landerPos: [landerPos.x, landerPos.y, landerPos.z],
        forward: [localForward.x, localForward.y, localForward.z],
        up: [up.x, up.y, up.z],
        velCamera: [velCamera.current.x, velCamera.current.y, velCamera.current.z],
        isFirstFrame: isFirstFrame.current,
        cameraMode: cameraMode,
        cameraFocusMode: cameraFocusMode
      }));
    }

    if (cameraMode === 3) {
      // --- 3rd-Person Chase Camera Spring-Damper ---
      // Position target is behind and above the lander, dynamically rotated to align the pad in the background if focus lock is active
      let idealCameraPos;
      if (cameraFocusMode >= 1 && cameraFocusMode <= 3) {
        const pad = LANDING_PADS[cameraFocusMode - 1];
        const padPos = new THREE.Vector3(pad.x, pad.y, pad.z);
        const distance = landerPos.distanceTo(padPos);

        if (distance > 0.1) {
          const dirToPadNormalized = new THREE.Vector3().subVectors(padPos, landerPos).normalize();
          idealCameraPos = landerPos.clone()
            .addScaledVector(dirToPadNormalized, -16.0)
            .addScaledVector(up, 7.5);
        } else {
          idealCameraPos = landerPos.clone()
            .addScaledVector(up, 7.5)
            .addScaledVector(localForward, -16.0);
        }
      } else {
        idealCameraPos = landerPos.clone()
          .addScaledVector(up, 7.5)                // 7.5 units above
          .addScaledVector(localForward, -16.0);    // 16 units behind
      }

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

      // Target lookat is slightly in front of the lander to anticipate movement, or directly at the lander when pad lock is active
      let lookAtTarget;
      if (cameraFocusMode >= 1 && cameraFocusMode <= 3) {
        lookAtTarget = landerPos.clone();
      } else {
        lookAtTarget = landerPos.clone().addScaledVector(localForward, 3.0);
      }
      camera.lookAt(lookAtTarget);
    } else {
      // --- 1st-Person Cockpit Camera ---
      // Lock position straight inside the capsule cockpit
      const cockpitOffset = up.clone().multiplyScalar(1.2); // pilot eye height
      camera.position.copy(landerPos).add(cockpitOffset);

      // Look directly at pad if lock is active, otherwise straight forward
      if (cameraFocusMode >= 1 && cameraFocusMode <= 3) {
        const pad = LANDING_PADS[cameraFocusMode - 1];
        const padPos = new THREE.Vector3(pad.x, pad.y, pad.z);
        camera.lookAt(padPos);
      } else {
        const lookTarget = camera.position.clone().add(localForward.clone().multiplyScalar(10));
        camera.lookAt(lookTarget);
      }

      // Reset chase spring states
      velCamera.current.set(0, 0, 0);
      isFirstFrame.current = true;
    }
  });

  return null;
}

// Memoized 3D canvas wrapper to completely avoid React reconciliation on telemetry updates
const SimulationCanvas = React.memo(({
  glowActive,
  hiddenLineActive,
  splitViewActive,
  gameState,
  setGameState,
  inputs,
  telemetryRef,
  antialiasActive,
  setUiTelemetry
}) => {
  return (
    <Canvas
      dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1}
      gl={{ 
        antialias: false, // Disable native context AA to avoid double resolves with composer
        powerPreference: 'high-performance', 
        alpha: false, 
        stencil: false, 
        depth: true,
        toneMapping: THREE.NoToneMapping 
      }}
      onCreated={({ gl }) => {
        gl.setClearColor('#020204');
      }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.15} />
        <Terrain glowActive={glowActive} hiddenLineActive={hiddenLineActive} />
        <Lander
          gameState={gameState}
          setGameState={setGameState}
          inputRef={inputs}
          telemetryRef={telemetryRef}
          glowActive={glowActive}
          hiddenLineActive={hiddenLineActive}
        />
        <Starfield count={600} />
        <Cockpit telemetryRef={telemetryRef} glowActive={glowActive} gameState={gameState} />
        <CameraController telemetryRef={telemetryRef} />
        <TelemetryListener telemetryRef={telemetryRef} setUiTelemetry={setUiTelemetry} />
        {splitViewActive && <ThreeWayViewport telemetryRef={telemetryRef} />}
        {!splitViewActive && (
          <EffectComposer multisampling={0}>
            <Bloom 
              intensity={glowActive ? 2.2 : 0.0} 
              luminanceThreshold={0.0} 
              luminanceSmoothing={glowActive ? 0.8 : 0.0}
              height={300}
            />
            {antialiasActive && <SMAA />}
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
  );
});

export default function App() {
  const [gameState, setGameState] = useState('menu'); // menu, playing, landed, crashed
  const [glowActive, setGlowActive] = useState(false);
  const [antialiasActive, setAntialiasActive] = useState(false);
  const [splitViewActive, setSplitViewActive] = useState(false);
  const [hiddenLineActive, setHiddenLineActive] = useState(true);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(2500);
  const [isMuted, setIsMuted] = useState(false);
  const [logs, setLogs] = useState([
    { text: 'Flight deck systems offline', time: '0.0s' },
    { text: 'Waiting for boot command...', time: '0.0s' }
  ]);

  // Synchronize React score and highScore state with index.html header elements
  useEffect(() => {
    const scoreEl = document.getElementById('score-val');
    if (scoreEl) {
      scoreEl.textContent = String(score).padStart(5, '0');
    }
  }, [score]);

  useEffect(() => {
    const highScoreEl = document.getElementById('hiscore-val');
    if (highScoreEl) {
      highScoreEl.textContent = String(highScore).padStart(5, '0');
    }
    if (score > highScore) {
      setHighScore(score);
    }
  }, [score, highScore]);

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
    cameraFocusMode: 0,
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
    cameraFocusMode: 0,
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

  // Keep latest updateInputs in a ref to avoid tearing down the animation frame loop on re-renders
  const updateInputsRef = useRef(updateInputs);
  useEffect(() => {
    updateInputsRef.current = updateInputs;
  }, [updateInputs]);

  // Keyboard loop hook for updating analog controls
  useEffect(() => {
    let animId;
    let lastT = performance.now();
    let frames = 0;
    let lastFpsUpdate = lastT;

    const loop = (now) => {
      frames++;
      const dt = (now - lastT) / 1000;
      lastT = now;
      
      // Call inputs update via stable ref
      if (updateInputsRef.current) {
        updateInputsRef.current(dt);
      }

      // Update FPS counter every 500ms
      if (now - lastFpsUpdate > 500) {
        const fps = Math.round((frames * 1000) / (now - lastFpsUpdate));
        const fpsEl = document.getElementById('fps-val');
        if (fpsEl) {
          fpsEl.textContent = String(fps);
          // Color code according to performance threshold
          if (fps >= 55) {
            fpsEl.className = 'color-green';
          } else if (fps >= 30) {
            fpsEl.className = 'color-amber';
          } else {
            fpsEl.className = 'color-red';
          }
        }
        frames = 0;
        lastFpsUpdate = now;
      }

      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Listen for render deck toggle shortcut keys
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyG') {
        setGlowActive(prev => {
          const next = !prev;
          addLog(`Vector Glow ${next ? 'ONLINE' : 'OFFLINE'}`);
          return next;
        });
      }
      if (e.code === 'KeyA') {
        setAntialiasActive(prev => {
          const next = !prev;
          addLog(`Anti-Aliasing ${next ? 'SMOOTH' : 'JAGGED'}`);
          return next;
        });
      }
      if (e.code === 'KeyV') {
        setSplitViewActive(prev => {
          const next = !prev;
          addLog(`Viewport Layout ${next ? '3-WAY SPLIT' : 'SINGLE VIEW'}`);
          return next;
        });
      }
      if (e.code === 'KeyH') {
        setHiddenLineActive(prev => {
          const next = !prev;
          addLog(`Hidden Line Occlusion ${next ? 'ONLINE' : 'OFFLINE'}`);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    <div className="game-container">
      
      {/* --- Left Telemetry Sidebar Panel --- */}
      <div className="sidebar">
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

        {/* Flight Assist controls */}
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
          <div className="key-row" style={{ marginTop: '6px' }}>
            <span>Focus Lock</span>
            <span className="kbd-key">
              {uiTelemetry.cameraFocusMode === 0 ? 'FREELOOK' :
               uiTelemetry.cameraFocusMode === 1 ? 'EASY (1X)' :
               uiTelemetry.cameraFocusMode === 2 ? 'MEDIUM (2X)' : 'HARD (4X)'} [0-3]
            </span>
          </div>
        </div>

        {/* Rendering options controls */}
        <div className="info-block">
          <h3>Rendering Deck</h3>
          <div 
            className="key-row" 
            style={{ cursor: 'pointer' }}
            onClick={() => setGlowActive(p => {
              const next = !p;
              addLog(`Vector Glow ${next ? 'ONLINE' : 'OFFLINE'}`);
              return next;
            })}
          >
            <span>Vector Glow</span>
            <span className={glowActive ? 'color-green' : 'color-red'} style={{ fontWeight: 'bold' }}>
              {glowActive ? 'ONLINE' : 'OFFLINE'} [G]
            </span>
          </div>
          <div 
            className="key-row" 
            style={{ cursor: 'pointer', marginTop: '6px' }}
            onClick={() => setAntialiasActive(p => {
              const next = !p;
              addLog(`Anti-Aliasing ${next ? 'SMOOTH' : 'JAGGED'}`);
              return next;
            })}
          >
            <span>Anti-Aliasing</span>
            <span className={antialiasActive ? 'color-green' : 'color-red'} style={{ fontWeight: 'bold' }}>
              {antialiasActive ? 'SMOOTH' : 'JAGGED'} [A]
            </span>
          </div>
          <div 
            className="key-row" 
            style={{ cursor: 'pointer', marginTop: '6px' }}
            onClick={() => setSplitViewActive(p => {
              const next = !p;
              addLog(`Viewport Layout ${next ? '3-WAY SPLIT' : 'SINGLE VIEW'}`);
              return next;
            })}
          >
            <span>Viewport Layout</span>
            <span className={splitViewActive ? 'color-green' : 'color-red'} style={{ fontWeight: 'bold' }}>
              {splitViewActive ? '3-WAY' : 'SINGLE'} [V]
            </span>
          </div>
          <div 
            className="key-row" 
            style={{ cursor: 'pointer', marginTop: '6px' }}
            onClick={() => setHiddenLineActive(p => {
              const next = !p;
              addLog(`Hidden Line Occlusion ${next ? 'ONLINE' : 'OFFLINE'}`);
              return next;
            })}
          >
            <span>Hidden Line</span>
            <span className={hiddenLineActive ? 'color-green' : 'color-red'} style={{ fontWeight: 'bold' }}>
              {hiddenLineActive ? 'ONLINE' : 'OFFLINE'} [H]
            </span>
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
      <div className="monitor-cabinet">
        <div className="screen-wrapper">
          
          {/* Memoized React Three Fiber Canvas */}
          <SimulationCanvas
            glowActive={glowActive}
            hiddenLineActive={hiddenLineActive}
            splitViewActive={splitViewActive}
            gameState={gameState}
            setGameState={setGameState}
            inputs={inputs}
            telemetryRef={telemetryRef}
            antialiasActive={antialiasActive}
            setUiTelemetry={setUiTelemetry}
          />

          {/* Viewport split screen borders */}
          {splitViewActive && (
            <div className="split-view-borders">
              <div className="border-horizontal"></div>
              <div className="border-vertical-1"></div>
              <div className="border-vertical-2"></div>
            </div>
          )}

          {/* Viewport labels */}
          {splitViewActive && (
            <div className="viewport-labels">
              <div className="label-top">[ ACTIVE CAMERA / 3D ]</div>
              <div className="label-bottom-left">[ FRONT VIEW ]</div>
              <div className="label-bottom-middle">[ LEFT VIEW ]</div>
              <div className="label-bottom-right">[ MODULE RADAR ]</div>
            </div>
          )}

          {/* Bottom-right Radar Panel */}
          {splitViewActive && (
            <div className="radar-panel">
              <div className="radar-svg-container">
                <svg viewBox="-50 -50 100 100" className="radar-grid">
                  <circle cx="0" cy="0" r="15" fill="none" stroke="rgba(255, 183, 0, 0.15)" strokeWidth="1" />
                  <circle cx="0" cy="0" r="30" fill="none" stroke="rgba(255, 183, 0, 0.25)" strokeWidth="1" />
                  <circle cx="0" cy="0" r="45" fill="none" stroke="rgba(255, 183, 0, 0.15)" strokeWidth="1" strokeDasharray="2,2" />
                  <line x1="-50" y1="0" x2="50" y2="0" stroke="rgba(255, 183, 0, 0.2)" strokeWidth="1" />
                  <line x1="0" y1="-50" x2="0" y2="50" stroke="rgba(255, 183, 0, 0.2)" strokeWidth="1" />
                  
                  {LANDING_PADS.map((pad, idx) => {
                    const dx = pad.x - uiTelemetry.position?.x;
                    const dz = pad.z - uiTelemetry.position?.z;
                    const scale = 0.35;
                    const svgX = dx * scale;
                    const svgY = dz * scale;
                    const svgR = pad.radius * scale;
                    const dist = Math.sqrt(svgX * svgX + svgY * svgY);
                    
                    if (dist < 48) {
                      return (
                        <g key={idx}>
                          <circle cx={svgX} cy={svgY} r={svgR} fill="none" stroke={pad.color} strokeWidth="1.5" />
                          <text x={svgX} y={svgY + 2} fill={pad.color} textAnchor="middle" style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '4.5px' }}>
                            {pad.multiplier}x
                          </text>
                        </g>
                      );
                    }
                    return null;
                  })}
                  
                  <circle cx="0" cy="0" r="2.5" fill="var(--vector-cyan)" />
                  <line 
                    x1="0" 
                    y1="0" 
                    x2={uiTelemetry.forwardVector ? -uiTelemetry.forwardVector.x * 6 : 0} 
                    y2={uiTelemetry.forwardVector ? -uiTelemetry.forwardVector.z * 6 : -6} 
                    stroke="var(--vector-cyan)" 
                    strokeWidth="1.5" 
                  />
                </svg>
              </div>
              <div className="radar-stats">
                <div>LAT X: <span className="color-cyan">{uiTelemetry.position ? Math.round(uiTelemetry.position.x) : 0} m</span></div>
                <div>LAT Z: <span className="color-cyan">{uiTelemetry.position ? Math.round(uiTelemetry.position.z) : 0} m</span></div>
                <div>PITCH: <span className={uiTelemetry.pitch > 8.5 ? 'color-red' : 'color-green'}>{Math.round(uiTelemetry.pitch)}°</span></div>
                <div>CORE: <span className="color-green">NOMINAL</span></div>
              </div>
            </div>
          )}

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
