"use client";

import { useEffect, useRef } from "react";

import * as THREE from "three";

import { Button } from "@/components/ui/button";
import { evaluateAlarms } from "@/lib/fermentation/insights";
import type { ProcessState } from "@/lib/fermentation/model";
import { useFermentation } from "@/stores/fermentation-store";

const CALLOUTS = [
  { id: "motor", label: "Motor" },
  { id: "ph", label: "pH probe" },
  { id: "temperature", label: "Temp probe" },
  { id: "dissolvedOxygen", label: "DO probe" },
  { id: "impeller", label: "Impeller" },
  { id: "sparger", label: "Sparger" },
  { id: "broth", label: "Broth" },
] as const;

const COPY: Record<string, string> = {
  impeller: "Six-blade disc on the shaft. Speed follows the agitation setpoint.",
  sparger: "Ring under the impeller. Bubble count follows aeration.",
  ph: "Gold immersion probe. The reading is the simulated broth pH.",
  temperature: "Red jacket probe. The reading is the simulated broth temperature.",
  dissolvedOxygen: "Green probe, percent of air saturation.",
  broth: "Working volume. The level follows the feed.",
  motor: "Top drive. It turns the shaft at the agitation setpoint.",
};

const GLASS_R = 0.68;
const GLASS_H = 2;
const LIQUID_H = 1.35;

export function ReactorView({ readings }: { readings?: Partial<Record<string, string>> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const readingsRef = useRef(readings);
  readingsRef.current = readings;
  const selected = useFermentation((s) => s.selectedPart);
  const dissect = useFermentation((s) => s.dissect);
  const state = useFermentation((s) => s.live.state);
  const setpoints = useFermentation((s) => s.live.setpoints);
  const scenario = useFermentation((s) => s.live.scenario);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const setDissect = useFermentation((s) => s.setDissect);
  const setSelected = useFermentation((s) => s.setSelectedPart);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0xf7f6f3, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 80);
    camera.position.set(0, 0.2, 5.8);
    const pivot = new THREE.Group();
    scene.add(pivot);
    scene.add(new THREE.AmbientLight(0xffffff, 0.92));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(3, 5, 4);
    scene.add(key);

    const built = buildReactor();
    pivot.add(built.root);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let dragging = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    let ry = 0.55;
    let rx = 0.22;
    let zoom = 1;
    const down = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      lx = event.clientX;
      ly = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      moved += Math.abs(event.clientX - lx) + Math.abs(event.clientY - ly);
      ry += (event.clientX - lx) * 0.013;
      rx += (event.clientY - ly) * 0.008;
      rx = Math.max(-0.35, Math.min(0.85, rx));
      lx = event.clientX;
      ly = event.clientY;
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      if (moved > 6) return;
      const rect = canvas.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(built.root, true)[0];
      let node: THREE.Object3D | null = hit?.object ?? null;
      while (node && !node.userData.partId) node = node.parent;
      useFermentation
        .getState()
        .setSelectedPart(typeof node?.userData.partId === "string" ? node.userData.partId : null);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom = Math.max(0.55, Math.min(2.2, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointermove", move);
    canvas.addEventListener("wheel", wheel, { passive: false });

    let raf = 0;
    let spin = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const live = useFermentation.getState();
      if (!dragging && !live.dissect) ry += 0.003;
      pivot.rotation.y = ry;
      pivot.rotation.x = rx;
      camera.fov = 32 / zoom;
      camera.updateProjectionMatrix();
      const open = live.dissect ? 1 : 0;
      for (const item of built.parts) {
        const target = item.userData.explode as THREE.Vector3;
        item.position.lerp(open ? target : built.zero, 0.08);
      }
      spin += (live.live.state.agitation / 60) * 0.016 * Math.PI * 2;
      built.spin.rotation.y = spin;
      const fill = Math.min(1, Math.max(0.28, (live.live.state.volume - 700) / 1100));
      built.liquid.scale.y = fill;
      built.liquid.position.y = -GLASS_H / 2 + 0.1 + (LIQUID_H * fill) / 2;
      built.brothMarker.position.y = built.liquid.position.y + (LIQUID_H * fill) / 2;
      built.bubbles.forEach((bubble, index) => {
        const cycle = (performance.now() / 1400 + index * 0.17) % 1;
        bubble.position.y = -0.78 + cycle * (built.brothMarker.position.y + 0.78);
        bubble.position.x = Math.cos(index * 1.7) * 0.16;
        bubble.position.z = Math.sin(index * 1.7) * 0.16;
        const mat = bubble.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.min(0.85, 0.25 + live.live.state.aeration / 3);
      });
      renderer.render(scene, camera);
      paintCallouts(
        canvas,
        svgRef.current,
        chipRefs.current,
        built.markers,
        camera,
        live.live.state,
        live.selectedPart,
        readingsRef.current,
      );
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointermove", move);
      canvas.removeEventListener("wheel", wheel);
      renderer.dispose();
    };
  }, []);

  const active = evaluateAlarms(state, null, setpoints, scenario, sensitivity);
  const part = CALLOUTS.find((item) => item.id === selected) ?? null;
  const hot = active.some((item) => item.partId === (part?.id ?? ""));

  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-lg border bg-[#f7f6f3]">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab touch-none active:cursor-grabbing" />
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0 z-[4] overflow-visible"
        width="100%"
        height="100%"
      />
      {CALLOUTS.map((callout, index) => (
        <button
          key={callout.id}
          type="button"
          ref={(node) => {
            chipRefs.current[index] = node;
          }}
          style={{ display: "none" }}
          className="absolute z-[5] flex items-center gap-1.5 whitespace-nowrap rounded-md border border-black/40 bg-white/95 px-2 py-0.5 font-medium text-[11px] leading-tight"
          onClick={() => setSelected(callout.id)}
        >
          <span className="block size-1.5 shrink-0 rounded-full bg-[#e6502e]" />
          <span />
        </button>
      ))}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[6] flex flex-col items-center gap-2">
        <div className="pointer-events-none max-w-56 rounded-md border bg-white/95 px-3 py-1.5 text-center">
          <div className="font-medium text-[13px] text-neutral-900">{part ? part.label : "Bioreactor BR-101"}</div>
          <div className="text-[11px] text-neutral-600">
            {calloutCaption(part?.id, state, readings)}
            {hot ? " This part is outside its band." : ""}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={dissect ? "default" : "outline"}
          className="pointer-events-auto"
          onClick={() => setDissect(!dissect)}
        >
          {dissect ? "Assemble" : "Dissect"}
        </Button>
      </div>
    </div>
  );
}

function paintCallouts(
  canvas: HTMLCanvasElement,
  svg: SVGSVGElement | null,
  chips: (HTMLButtonElement | null)[],
  markers: THREE.Object3D[],
  camera: THREE.PerspectiveCamera,
  state: ProcessState,
  selected: string | null,
  readings?: Partial<Record<string, string>>,
) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const world = new THREE.Vector3();
  const hits: { index: number; sx: number; sy: number }[] = [];

  markers.forEach((marker, index) => {
    const chip = chips[index];
    marker.getWorldPosition(world);
    const projected = world.clone().project(camera);
    if (projected.z >= 1) {
      if (chip) chip.style.display = "none";
      return;
    }
    hits.push({
      index,
      sx: (projected.x * 0.5 + 0.5) * width,
      sy: (-projected.y * 0.5 + 0.5) * height,
    });
  });

  const left = hits.filter((hit) => hit.sx < width / 2).sort((a, b) => a.sy - b.sy);
  const right = hits.filter((hit) => hit.sx >= width / 2).sort((a, b) => a.sy - b.sy);
  for (const column of [layoutColumn(left, "left", width, height), layoutColumn(right, "right", width, height)]) {
    for (const item of column) {
      const chip = chips[item.index];
      const callout = CALLOUTS[item.index];
      const marker = markers[item.index];
      if (!chip || !callout || !marker) continue;
      chip.style.display = "flex";
      chip.style.left = `${item.x}px`;
      chip.style.top = `${item.y}px`;
      chip.style.transform = item.side === "left" ? "translate(0, -50%)" : "translate(-100%, -50%)";
      const text = chip.querySelector("span:last-child");
      if (text) text.textContent = `${callout.label} · ${readings?.[callout.id] ?? reading(callout.id, state)}`;
      const chipWidth = chip.offsetWidth || 108;
      const x2 = item.side === "left" ? item.x + chipWidth : item.x - chipWidth;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(item.sx));
      line.setAttribute("y1", String(item.sy));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(item.y));
      line.setAttribute("stroke", "#e6502e");
      line.setAttribute("stroke-width", callout.id === selected ? "2.2" : "1.2");
      line.setAttribute("stroke-dasharray", "3 2");
      line.setAttribute("opacity", "0.8");
      svg.appendChild(line);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(item.sx));
      dot.setAttribute("cy", String(item.sy));
      dot.setAttribute("r", callout.id === selected ? "4.5" : "3");
      dot.setAttribute("fill", "#e6502e");
      svg.appendChild(dot);
    }
  }
}

function layoutColumn(
  hits: { index: number; sx: number; sy: number }[],
  side: "left" | "right",
  width: number,
  height: number,
) {
  const top = 18;
  const bottom = height - 108;
  const gap = 30;
  const placed = hits.map((hit) => ({ ...hit, side, x: side === "left" ? 10 : width - 10, y: hit.sy }));
  let cursor = top;
  for (const item of placed) {
    item.y = Math.max(cursor, Math.min(bottom, item.sy));
    cursor = item.y + gap;
  }
  const last = placed.at(-1);
  if (last && last.y > bottom && placed.length > 1) {
    const step = (bottom - top) / (placed.length - 1);
    placed.forEach((item, index) => {
      item.y = top + index * step;
    });
  }
  return placed;
}

function calloutCaption(id: string | undefined, state: ProcessState, readings?: Partial<Record<string, string>>) {
  if (!id) {
    return readings
      ? "Penicillin, IndPenSim. This is not the yeast protein run."
      : "Drag to orbit. Scroll to zoom. Click a part.";
  }
  const value = readings?.[id] ?? reading(id, state);
  return readings ? value : `${value} · ${COPY[id]}`;
}

function reading(id: string, state: ProcessState) {
  if (id === "ph") return state.ph.toFixed(2);
  if (id === "temperature") return `${state.temperature.toFixed(1)}°C`;
  if (id === "dissolvedOxygen") return `${state.dissolvedOxygen.toFixed(1)}%`;
  if (id === "impeller" || id === "motor") return `${state.agitation.toFixed(0)} rpm`;
  if (id === "sparger") return `${state.aeration.toFixed(2)} vvm`;
  return `${state.volume.toFixed(0)} L`;
}

function buildReactor() {
  const root = new THREE.Group();
  const parts: THREE.Group[] = [];
  const markers: THREE.Object3D[] = [];
  const zero = new THREE.Vector3();

  const jacket = part(root, "jacket", [0, 0, 0]);
  const glassGeo = new THREE.CylinderGeometry(GLASS_R, GLASS_R, GLASS_H, 32, 1, true);
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.MeshBasicMaterial({
      color: 0xd7dee6,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.renderOrder = 3;
  jacket.add(glass);
  jacket.add(edges(glassGeo));
  jacket.add(rim(GLASS_R, GLASS_H / 2));
  jacket.add(rim(GLASS_R, -GLASS_H / 2));
  const foot = solidCyl(GLASS_R + 0.1, 0.08, 0x1a1a1a);
  foot.position.y = -GLASS_H / 2 - 0.04;
  jacket.add(foot);
  for (let i = 0; i < 4; i++) {
    const baffle = solidBox(0.035, 1.45, 0.1, 0xc2cad2);
    const angle = (i / 4) * Math.PI * 2 + 0.5;
    baffle.position.set(Math.cos(angle) * 0.5, -0.08, Math.sin(angle) * 0.5);
    baffle.lookAt(0, -0.08, 0);
    jacket.add(baffle);
  }
  noRaycast(jacket);

  const liquidGeo = new THREE.CylinderGeometry(0.56, 0.56, LIQUID_H, 28);
  const liquid = new THREE.Mesh(
    liquidGeo,
    new THREE.MeshBasicMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  liquid.renderOrder = 2;
  const broth = part(root, "broth", [0.9, 0, 0.15]);
  broth.add(liquid);
  const brothMarker = marker(broth, 0, 0.2, 0.5);

  const spin = new THREE.Group();
  const shaft = solidCyl(0.032, 1.55, 0xb0b8c0);
  shaft.position.y = 0.22;
  spin.add(shaft);
  const disc = solidCyl(0.16, 0.045, 0xc2cad2);
  disc.position.y = -0.32;
  spin.add(disc);
  for (let i = 0; i < 6; i++) {
    const blade = solidBox(0.26, 0.1, 0.028, 0x1a1a1a);
    const angle = (i / 6) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 0.24, -0.32, Math.sin(angle) * 0.24);
    blade.lookAt(0, -0.32, 0);
    spin.add(blade);
  }
  const impeller = part(root, "impeller", [-1.05, 0.08, 0.2]);
  impeller.add(spin);
  marker(impeller, 0.4, -0.32, 0);

  const sparger = part(root, "sparger", [0.15, -0.2, 0.95]);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.02, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0xb0b8c0 }),
  );
  ring.position.y = -0.8;
  ring.rotation.x = Math.PI / 2;
  sparger.add(ring);
  const bubbles = Array.from({ length: 8 }, () => {
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.8 }),
    );
    bubble.position.y = -0.7;
    return bubble;
  });
  for (const bubble of bubbles) sparger.add(bubble);
  marker(sparger, 0.22, -0.8, 0);

  addProbe(root, "ph", 0xdda000, -0.3, 0.02, [-0.95, 0.2, -0.15]);
  addProbe(root, "temperature", 0xd63b2a, 0.3, -0.08, [0.95, 0.28, -0.1]);
  addProbe(root, "dissolvedOxygen", 0x22a84a, 0.02, 0.32, [0.05, 0.18, 1.05]);

  const motor = part(root, "motor", [0, 0.72, 0]);
  const plate = solidCyl(0.2, 0.06, 0x1a1a1a);
  plate.position.y = 1.1;
  motor.add(plate);
  const housing = solidBox(0.3, 0.26, 0.3, 0x1a1a1a);
  housing.position.y = 1.28;
  motor.add(housing);
  marker(motor, 0.16, 1.28, 0.16);

  const byName = new Map(root.children.map((child) => [child.name, child]));
  for (const callout of CALLOUTS) {
    const host = byName.get(callout.id);
    const found = host?.children.find((child) => child.name === `mark:${callout.id}`);
    if (found) markers.push(found);
  }
  parts.push(...(root.children.filter((child) => child.userData.partId && child.name !== "jacket") as THREE.Group[]));
  return { root, parts, markers, liquid, spin, bubbles, brothMarker, zero };
}

function addProbe(
  root: THREE.Group,
  id: string,
  color: number,
  x: number,
  z: number,
  explode: [number, number, number],
) {
  const group = part(root, id, explode);
  const rod = solidCyl(0.028, 1.42, color);
  rod.position.set(x, 0.46, z);
  group.add(rod);
  const cap = solidBox(0.11, 0.09, 0.11, color);
  cap.position.set(x, 1.22, z);
  group.add(cap);
  marker(group, x, 1.26, z);
}

function marker(group: THREE.Group, x: number, y: number, z: number) {
  const point = new THREE.Object3D();
  point.name = `mark:${group.name}`;
  point.position.set(x, y, z);
  group.add(point);
  return point;
}

function part(parent: THREE.Group, id: string, explode: [number, number, number]) {
  const group = new THREE.Group();
  group.name = id;
  group.userData.partId = id;
  group.userData.explode = new THREE.Vector3(...explode);
  parent.add(group);
  return group;
}

function noRaycast(object: THREE.Object3D) {
  object.traverse((node) => {
    node.raycast = () => undefined;
  });
}

function edges(geometry: THREE.BufferGeometry) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 20),
    new THREE.LineBasicMaterial({ color: 0x141414 }),
  );
}

function rim(radius: number, y: number) {
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.028, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
  );
  torus.rotation.x = Math.PI / 2;
  torus.position.y = y;
  return torus;
}

function solidCyl(radius: number, height: number, color: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 20);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1 }),
  );
  group.add(mesh);
  group.add(edges(geometry));
  return group;
}

function solidBox(w: number, h: number, d: number, color: number) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1 })),
  );
  group.add(edges(geometry));
  return group;
}
