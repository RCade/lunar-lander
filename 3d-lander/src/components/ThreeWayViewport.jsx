import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function ThreeWayViewport({ telemetryRef }) {
  const { gl, scene } = useThree();

  // Create Front and Left Orthographic Cameras
  // Args: left, right, top, bottom, near, far
  const frontCameraRef = useRef(new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 1000));
  const leftCameraRef = useRef(new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 1000));

  useFrame((state) => {
    const { gl, scene, camera, size } = state;
    const landerPos = telemetryRef.current?.position;
    if (!landerPos) return;

    const w = size.width;
    const h = size.height;

    // Split: Top 65% height, Bottom 35% height split into 3 columns
    const topH = h * 0.65;
    const botH = h - topH;
    const botW = w / 3;

    const aspect = botW / botH;
    const orthoSize = 30; // 30 meters horizontal span

    // 1. Update Front Camera: looks at lander along the positive Z-axis
    const frontCam = frontCameraRef.current;
    frontCam.position.set(landerPos.x, landerPos.y, landerPos.z + 40);
    frontCam.lookAt(landerPos);
    
    // Maintain orthographic aspect ratio without stretch
    frontCam.left = -orthoSize / 2;
    frontCam.right = orthoSize / 2;
    frontCam.top = (orthoSize / aspect) / 2;
    frontCam.bottom = -(orthoSize / aspect) / 2;
    frontCam.updateProjectionMatrix();

    // 2. Update Left Camera: looks at lander along the negative X-axis
    const leftCam = leftCameraRef.current;
    leftCam.position.set(landerPos.x - 40, landerPos.y, landerPos.z);
    leftCam.lookAt(landerPos);
    
    leftCam.left = -orthoSize / 2;
    leftCam.right = orthoSize / 2;
    leftCam.top = (orthoSize / aspect) / 2;
    leftCam.bottom = -(orthoSize / aspect) / 2;
    leftCam.updateProjectionMatrix();

    // 3. Clear Screen Buffer
    gl.autoClear = false;
    gl.setViewport(0, 0, w, h);
    gl.setScissor(0, 0, w, h);
    gl.setScissorTest(false);
    gl.setClearColor('#020204');
    gl.clear();

    // --- Render 1: TOP Perspective Viewport (3D view) ---
    gl.setViewport(0, botH, w, topH);
    gl.setScissor(0, botH, w, topH);
    gl.setScissorTest(true);
    
    // Temporarily set main camera aspect ratio to top viewport aspect
    const oldAspect = camera.aspect;
    camera.aspect = w / topH;
    camera.updateProjectionMatrix();
    
    gl.render(scene, camera);
    
    // Restore main camera aspect ratio
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();

    // --- Render 2: BOTTOM LEFT Orthographic Viewport (FRONT view) ---
    gl.setViewport(0, 0, botW, botH);
    gl.setScissor(0, 0, botW, botH);
    gl.setScissorTest(true);
    gl.render(scene, frontCam);

    // --- Render 3: BOTTOM MIDDLE Orthographic Viewport (LEFT view) ---
    gl.setViewport(botW, 0, botW, botH);
    gl.setScissor(botW, 0, botW, botH);
    gl.setScissorTest(true);
    gl.render(scene, leftCam);

    // --- Render 4: BOTTOM RIGHT Viewport (Reserved for Radar) ---
    gl.setViewport(botW * 2, 0, botW, botH);
    gl.setScissor(botW * 2, 0, botW, botH);
    gl.setScissorTest(true);
    // (Already cleared to black, no scene rendering needed)

    // Reset scissor test so other parts of the framework/next frames clear correctly
    gl.setScissorTest(false);
  }, 1); // priority = 1 disables R3F default render pass

  return null;
}
