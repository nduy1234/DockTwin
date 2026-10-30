"use client";

import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
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
};

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
  level,
  selected,
  onSelect,
}: {
  p: Placed;
  reefer: boolean;
  down: boolean;
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

  return (
    <mesh position={p.pos} {...handlers}>
      {p.kind === "reefer_plug" ? (
        <cylinderGeometry args={[p.size[0] / 2, p.size[0] / 2, p.size[1], 12]} />
      ) : (
        <boxGeometry args={p.size} />
      )}
      <meshStandardMaterial
        color={color}
        emissive={level ? LEVEL_COLOR[level] : hover ? "#f4f1ea" : "#000000"}
        emissiveIntensity={level ? 0.55 : hover ? 0.15 : 0}
      />
      {(selected || level) && <Edges color={selected ? "#f4f1ea" : LEVEL_COLOR[level!]} lineWidth={selected ? 2 : 1} />}
    </mesh>
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
  const center: [number, number, number] = [(min[0]! + max[0]!) / 2, 0, (min[2]! + max[2]!) / 2];
  const radius = Math.max(18, Math.hypot(max[0]! - min[0]!, max[2]! - min[2]!) / 2);
  const camera: [number, number, number] = [center[0] + radius * 1.1, radius * 1.3, center[2] - radius * 1.7];
  return { center, radius, camera };
}
