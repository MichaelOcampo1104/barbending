import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture } from 'three';
import { useStore } from '../store.js';

// The orientation widget in the corner: the same axes and heads as drei's GizmoViewport, but a click on
// a head asks the store for the matching preset view (exactly along the axis, orthographic) instead of
// drei's own tween, which stops up to 0.6 degrees short of the axis and keeps the perspective camera.
// Meant to be a child of drei's GizmoHelper, which places it in the corner and keeps it in step with
// the main camera. Positive heads put the camera on that side of the model.
const FONT = '18px Inter var, Arial, sans-serif';

function Axis({ color, rotation }) {
  return (
    <group rotation={rotation}>
      <mesh position={[0.4, 0, 0]}>
        <boxGeometry args={[0.8, 0.05, 0.05]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function AxisHead({ position, color, label, labelColor, view }) {
  const gl = useThree((s) => s.gl);
  const [active, setActive] = useState(false);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (label) {
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = labelColor;
      ctx.fillText(label, 32, 41);
    }
    return new CanvasTexture(canvas);
  }, [color, label, labelColor]);
  useEffect(() => () => texture.dispose(), [texture]);
  const scale = (label ? 1 : 0.75) * (active ? 1.2 : 1);
  return (
    <sprite
      position={position}
      scale={scale}
      onPointerOver={(e) => { e.stopPropagation(); setActive(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setActive(false); }}
      onPointerDown={(e) => { e.stopPropagation(); useStore.getState().requestView(view); }}
    >
      <spriteMaterial
        map={texture}
        map-anisotropy={gl.capabilities.getMaxAnisotropy() || 1}
        alphaTest={0.3}
        opacity={label ? 1 : 0.75}
        toneMapped={false}
      />
    </sprite>
  );
}

// labels / axisColors are given for the scene's x, y (up), z axes.
export default function AxisGizmo({ labels = ['X', 'Y', 'Z'], axisColors = ['#ff2060', '#20df80', '#2080ff'], labelColor = '#000' }) {
  const [cx, cy, cz] = axisColors;
  return (
    <group scale={40}>
      <Axis color={cx} rotation={[0, 0, 0]} />
      <Axis color={cy} rotation={[0, 0, Math.PI / 2]} />
      <Axis color={cz} rotation={[0, -Math.PI / 2, 0]} />
      <AxisHead position={[1, 0, 0]} color={cx} label={labels[0]} labelColor={labelColor} view="right" />
      <AxisHead position={[0, 1, 0]} color={cy} label={labels[1]} labelColor={labelColor} view="top" />
      <AxisHead position={[0, 0, 1]} color={cz} label={labels[2]} labelColor={labelColor} view="front" />
      <AxisHead position={[-1, 0, 0]} color={cx} view="left" />
      <AxisHead position={[0, -1, 0]} color={cy} view="bottom" />
      <AxisHead position={[0, 0, -1]} color={cz} view="back" />
    </group>
  );
}
