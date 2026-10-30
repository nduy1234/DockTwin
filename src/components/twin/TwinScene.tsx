"use client";

import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { layoutTwin, type Placed } from "@/engine/layout";
import type { LadderLevel, Scalar, TwinSpec } from "@/engine/schema";
import { LEVEL_COLOR } from "./colors";

const KIND_COLOR: Record<string, string> = {
  container: "#d9622b",
  reefer: "#e9e4d8",
  gate_lane: "#3a4f60",
  scale: "#8fa3b3",
  crane: "#d9a42b",
  reefer_plug: "#3f8f6b",
  yard_block: "#22394a",
  door: "#8fa3b3",
  gripper: "#d9622b",
  motor: "#d9a42b",
  sensor: "#3f8f6b",
  button: "#c0392b",
  actor: "#f4f1ea",
};

const num = (v: Scalar | undefined) => (typeof v === "number" ? v : undefined);

/** 0..1 open fraction from open_pct or a state word. */
function openness(live: Record<string, Scalar>): number {
  const pct = num(live.open_pct);
  if (pct !== undefined) return Math.max(0, Math.min(1, pct / 100));
  const s = String(live.state ?? "");
  return s === "open" || s === "released" ? 1 : s === "opening" || s === "closing" ? 0.5 : 0;
}

type Props = {
  spec: TwinSpec;
  state?: Record<string, Record<string, Scalar>>;
  levels?: Record<string, LadderLevel>;
  selected: string | null;
  onSelect: (id: string | null) => void;
};

export default function TwinScene({ spec, state, levels = {}, selected, onSelect }: Props) {
  const placed = useMemo(() => layoutTwin(spec), [spec]);
  const view = useMemo(() => frame(placed), [placed]);
  const initial = useMemo(
    () => Object.fromEntries(spec.objects.map((o) => [o.id, Object.fromEntries(o.props.map((p) => [p.key, p.value]))])),
    [spec],
  );

  return (
    <Canvas
      camera={{ position: view.camera, fov: 40, near: 0.5, far: 5000 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#13222e"]} />
      <hemisphereLight args={["#f4f1ea", "#13222e", 0.9]} />
      <directionalLight position={[60, 120, -40]} intensity={1.4} />
      <mesh rotation-x={-Math.PI / 2} position={[view.center[0], 0, view.center[2]]}>
        <planeGeometry args={[view.radius * 6, view.radius * 6]} />
        <meshStandardMaterial color="#1c3142" />
      </mesh>
      {placed.map((p) => (
        <TwinMesh
          key={p.id}
          p={p}
          reefer={spec.objects.find((o) => o.id === p.id)?.props.some((x) => x.key === "reefer" && x.value === true) ?? false}
          down={state?.[p.id]?.status === "down"}
          live={state?.[p.id] ?? initial[p.id] ?? {}}
          level={levels[p.id]}
          selected={selected === p.id}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls target={view.center} maxPolarAngle={Math.PI / 2.1} makeDefault />
    </Canvas>
  );
}

function TwinMesh({
  p,
  reefer,
  down,
  live,
  level,
  selected,
  onSelect,
}: {
  p: Placed;
  reefer: boolean;
  down: boolean;
  live: Record<string, Scalar>;
  level?: LadderLevel;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const base = p.kind === "container" && reefer ? KIND_COLOR.reefer : (KIND_COLOR[p.kind] ?? "#8fa3b3");
  const color = down ? "#5a2a2a" : base;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(p.id);
  };
  const handlers = {
    onClick: click,
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHover(false);
      document.body.style.cursor = "";
    },
  };

  if (p.kind === "crane") {
    const [w, h] = p.size;
    return (
      <group position={[p.pos[0], 0, p.pos[2]]} {...handlers}>
        {[-w / 2, w / 2].map((x) => (
          <mesh key={x} position={[x, h / 2, 0]}>
            <boxGeometry args={[1, h, 1]} />
            <meshStandardMaterial color={color} />
          </mesh>
        ))}
        <mesh position={[0, h, -10]}>
          <boxGeometry args={[w + 2, 1.5, 34]} />
          <meshStandardMaterial color={color} />
          {selected && <Edges color="#f4f1ea" />}
        </mesh>
      </group>
    );
  }

  const material = (
    <meshStandardMaterial
      color={color}
      emissive={level ? LEVEL_COLOR[level] : hover ? "#f4f1ea" : "#000000"}
      emissiveIntensity={level ? 0.55 : hover ? 0.15 : 0}
    />
  );
  const edges = (selected || level) && <Edges color={selected ? "#f4f1ea" : LEVEL_COLOR[level!]} lineWidth={selected ? 2 : 1} />;

  if (p.kind === "door") return <Door p={p} open={openness(live)} handlers={handlers} material={material} edges={edges} />;
  if (p.kind === "gripper") return <Gripper p={p} open={openness(live)} handlers={handlers} material={material} edges={edges} />;

  return (
    <mesh position={p.pos} {...handlers}>
      {p.kind === "reefer_plug" || p.kind === "actor" ? (
        <cylinderGeometry args={[p.size[0] / 2, p.size[0] / 2, p.size[1], 16]} />
      ) : (
        <boxGeometry args={p.size} />
      )}
      {material}
      {edges}
    </mesh>
  );
}

type PartProps = {
  p: Placed;
  open: number;
  handlers: Record<string, unknown>;
  material: React.ReactNode;
  edges: React.ReactNode;
};

/** Sliding door: static frame, panel eases toward its open fraction (visible during replay). */
function Door({ p, open, handlers, material, edges }: PartProps) {
  const panel = useRef<Mesh>(null);
  const [w, h, d] = p.size;
  useFrame((_, dt) => {
    if (!panel.current) return;
    const target = -open * w * 0.95;
    panel.current.position.x += (target - panel.current.position.x) * Math.min(1, dt * 6);
  });
  return (
    <group position={p.pos}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 + 0.1), 0, 0]}>
          <boxGeometry args={[0.2, h + 0.2, d + 0.1]} />
          <meshStandardMaterial color="#3a4f60" />
        </mesh>
      ))}
      <mesh position={[0, h / 2 + 0.1, 0]}>
        <boxGeometry args={[w + 0.4, 0.2, d + 0.1]} />
        <meshStandardMaterial color="#3a4f60" />
      </mesh>
      <mesh ref={panel} {...handlers}>
        <boxGeometry args={[w, h, d]} />
        {material}
        {edges}
      </mesh>
    </group>
  );
}

/** Gripper: palm plus two fingers whose gap eases toward open/closed. */
function Gripper({ p, open, handlers, material, edges }: PartProps) {
  const fingers = useRef<Group>(null);
  const [w, h] = p.size;
  useFrame((_, dt) => {
    const g = fingers.current;
    if (!g) return;
    const gap = 0.12 + open * w * 0.6;
    g.children.forEach((f, i) => {
      const target = (i === 0 ? -1 : 1) * gap;
      f.position.x += (target - f.position.x) * Math.min(1, dt * 6);
    });
  });
  return (
    <group position={p.pos} {...handlers}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w * 1.6, h * 0.3, w * 0.6]} />
        {material}
        {edges}
      </mesh>
      <group ref={fingers}>
        {[0, 1].map((i) => (
          <mesh key={i} position={[(i === 0 ? -1 : 1) * 0.3, -h * 0.1, 0]}>
            <boxGeometry args={[0.15, h, w * 0.5]} />
            {material}
          </mesh>
        ))}
      </group>
    </group>
  );
}


/** Camera that frames every placed object, looking from the gate toward the yard. */
function frame(placed: Placed[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of placed) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p.pos[k]! - p.size[k]! / 2);
      max[k] = Math.max(max[k]!, p.pos[k]! + p.size[k]! / 2);
    }
  }
  // Creator objects are human-scale: aim at door height and frame them closer and lower.
  const small = placed.every((p) => Math.max(...p.size) < 5);
  const center: [number, number, number] = [(min[0]! + max[0]!) / 2, small ? 1.2 : 0, (min[2]! + max[2]!) / 2];
  const radius = Math.max(small ? 5 : 18, Math.hypot(max[0]! - min[0]!, max[2]! - min[2]!) / 2);
  const camera: [number, number, number] = small
    ? [center[0] + radius * 0.7, center[1] + radius * 0.6, center[2] - radius * 1.6]
    : [center[0] + radius * 1.1, radius * 1.3, center[2] - radius * 1.7];
  return { center, radius, camera };
}
