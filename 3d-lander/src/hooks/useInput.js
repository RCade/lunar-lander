import { useEffect, useRef } from 'react';

export function useInput() {
  const inputs = useRef({
    throttle: 0,     // 0 to 1
    pitch: 0,        // -1 to 1 (X torque)
    roll: 0,         // -1 to 1 (Z torque)
    yaw: 0,          // -1 to 1 (Y torque)
    translateX: 0,   // -1 to 1 (lateral translation)
    translateZ: 0,   // -1 to 1 (longitudinal translation)
    sasActive: true, // SAS is active by default
    cameraMode: 3,   // 3 for 3rd person, 1 for 1st person
  });

  const keysPressed = useRef({});

  useEffect(() => {
    const handleKeyDown = (e) => {
      keysPressed.current[e.code] = true;

      // Handle toggle keys
      if (e.code === 'KeyT') {
        inputs.current.sasActive = !inputs.current.sasActive;
        console.log(`SAS Mode: ${inputs.current.sasActive ? 'ON' : 'OFF'}`);
      }
      if (e.code === 'KeyC') {
        inputs.current.cameraMode = inputs.current.cameraMode === 3 ? 1 : 3;
        console.log(`Camera Mode: ${inputs.current.cameraMode}rd Person`);
      }
    };

    const handleKeyUp = (e) => {
      keysPressed.current[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Update analog values on each frame (dt matches frame loop, typically in a useFrame)
  const updateInputs = (dt) => {
    const keys = keysPressed.current;
    
    // 1. Throttle Controls (Spacebar to increase, Shift to decrease/decay)
    if (keys['Space']) {
      inputs.current.throttle = Math.min(1.0, inputs.current.throttle + dt * 4.0);
    } else {
      inputs.current.throttle = Math.max(0.0, inputs.current.throttle - dt * 3.0);
    }

    // 2. Grip Button Translation Toggle emulation (Left Shift)
    const isShiftHeld = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
    inputs.current.gripMode = isShiftHeld;

    // Reset dynamics
    inputs.current.pitch = 0;
    inputs.current.roll = 0;
    inputs.current.yaw = 0;
    inputs.current.translateX = 0;
    inputs.current.translateZ = 0;

    if (isShiftHeld) {
      // Translation Mode: Arrow keys or WASD translate local X/Z (Inverted X, Original Z)
      if (keys['ArrowUp'] || keys['KeyW']) inputs.current.translateZ = 1;    // Forward
      if (keys['ArrowDown'] || keys['KeyS']) inputs.current.translateZ = -1;  // Backward
      if (keys['ArrowLeft'] || keys['KeyA']) inputs.current.translateX = 1;   // Left is now Right
      if (keys['ArrowRight'] || keys['KeyD']) inputs.current.translateX = -1; // Right is now Left
    } else {
      // Rotation Mode (Inverted Roll/Yaw, Original Pitch)
      // Pitch (Up/Down arrows or I/K keys)
      if (keys['ArrowUp'] || keys['KeyI']) inputs.current.pitch = -1;    // Nose Down (negative torque)
      if (keys['ArrowDown'] || keys['KeyK']) inputs.current.pitch = 1;   // Nose Up (positive torque)

      // Roll (Left/Right arrows or J/L keys)
      if (keys['ArrowLeft'] || keys['KeyJ']) inputs.current.roll = 1;    // Roll Left is now Roll Right
      if (keys['ArrowRight'] || keys['KeyL']) inputs.current.roll = -1;  // Roll Right is now Roll Left

      // Yaw (A/D or Q/E keys)
      if (keys['KeyQ'] || keys['KeyA']) inputs.current.yaw = 1;          // Yaw Left is now Yaw Right
      if (keys['KeyE'] || keys['KeyD']) inputs.current.yaw = -1;         // Yaw Right is now Yaw Left
    }
  };

  return { inputs, updateInputs };
}
