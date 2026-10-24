"use client";

import { useEffect, useRef, useState } from "react";

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { Button } from "@/components/ui/button";
import { modelAlarms } from "@/lib/fermentation/insights";
import type { ProcessState, Setpoints } from "@/lib/fermentation/model";
import { useFermentation } from "@/stores/fermentation-store";

const CALLOUTS = [
  { id: "motor", label: "Motor", color: "#94a3b8", side: "left" },
  { id: "temperature", label: "Temp probe", color: "#ef4444", side: "left" },
  { id: "impeller", label: "Impeller", color: "#38bdf8", side: "left" },
  { id: "sparger", label: "Sparger", color: "#a5b4fc", side: "left" },
  { id: "ph", label: "pH probe", color: "#f5b700", side: "right" },
  { id: "dissolvedOxygen", label: "DO probe", color: "#22c55e", side: "right" },
  { id: "broth", label: "Broth", color: "#f59e0b", side: "right" },
] as const;

type CalloutId = (typeof CALLOUTS)[number]["id"];

const COPY: Record<CalloutId, string> = {
  impeller: "Twin six-blade Rushton turbines. Speed follows the agitation setpoint.",
  sparger: "Ring under the impellers. Bubble count and speed follow aeration.",
  ph: "Gold immersion probe. The reading is the simulated broth pH.",
  temperature: "Red probe in the jacket zone. The reading is the simulated broth temperature.",
  dissolvedOxygen: "Green probe, percent of air saturation.",
  broth: "Yeast broth. It darkens as biomass grows and rises with the sugar feed.",
  motor: "Top drive. It turns the shaft at the agitation setpoint.",
};

const R = 0.7; // vessel radius
const H = 1.9; // straight-wall height
const BOTTOM = -H / 2;
const TOP = H / 2;
const FLOOR = -1.56;
const MAX_BUBBLES = 140;
const MAX_CELLS = 220;
const MAX_DROPS = 6;

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
};

export function ReactorView({ readings }: { readings?: Partial<Record<string, string>> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const readingsRef = useRef(readings);
  readingsRef.current = readings;
  const [noGl, setNoGl] = useState(false);
  const selected = useFermentation((s) => s.selectedPart);
  const dissect = useFermentation((s) => s.dissect);
  const state = useFermentation((s) => s.live.state);
  const setpoints = useFermentation((s) => s.live.setpoints);
  const status = useFermentation((s) => s.live.status);
  const samples = useFermentation((s) => s.live.samples);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const setDissect = useFermentation((s) => s.setDissect);
  const setSelected = useFermentation((s) => s.setSelectedPart);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // Browsers with WebGL off get a note instead of a crashed dashboard.
      setNoGl(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
    camera.position.set(0, 0.45, 7.2);
    camera.lookAt(0, 0.02, 0);

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.9);
    rim.position.set(-4, 2.5, -4);
    scene.add(rim);
    const glow = new THREE.PointLight(0xffc773, 0.0, 3, 2);
    glow.position.set(0, -0.3, 0);
    scene.add(glow);

    const pivot = new THREE.Group();
    scene.add(pivot);
    const built = buildReactor();
    pivot.add(built.root);
    scene.add(built.stage);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickParts = built.parts.filter((group) => group.userData.pickable);

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

    const pick = (clientX: number, clientY: number): string | null => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(pickParts, true)[0];
      let node: THREE.Object3D | null = hit?.object ?? null;
      while (node && !node.userData.partId) node = node.parent;
      return typeof node?.userData.partId === "string" ? node.userData.partId : null;
    };

    let dragging = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    let ry = 0.6;
    let rx = 0.12;
    let zoom = 1;
    let idleSince = performance.now();
    let hovered: string | null = null;
    const down = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      lx = event.clientX;
      ly = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) {
        hovered = pick(event.clientX, event.clientY);
        canvas.style.cursor = hovered ? "pointer" : "grab";
        return;
      }
      moved += Math.abs(event.clientX - lx) + Math.abs(event.clientY - ly);
      ry += (event.clientX - lx) * 0.012;
      rx = Math.max(-0.3, Math.min(0.75, rx + (event.clientY - ly) * 0.007));
      lx = event.clientX;
      ly = event.clientY;
      idleSince = performance.now();
    };
    const up = (event: PointerEvent) => {
      // Only a press that started on the canvas counts; clicks elsewhere on the page leave the selection alone.
      if (!dragging) return;
      dragging = false;
      idleSince = performance.now();
      if (moved > 6) return;
      useFermentation.getState().setSelectedPart(pick(event.clientX, event.clientY));
    };
    const leave = () => {
      hovered = null;
    };
    const wheel = (event: WheelEvent) => {
      // Plain scrolling scrolls the page; Ctrl/⌘ + scroll (and trackpad pinch) zooms the vessel.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom = Math.max(0.6, Math.min(2.4, zoom * (event.deltaY > 0 ? 0.93 : 1.07)));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const dummy = new THREE.Object3D();
    const brothLow = new THREE.Color(0xf1e4b3);
    const brothHigh = new THREE.Color(0xb98a4e);
    const ringOk = new THREE.Color(0x2dd4bf);
    const ringBad = new THREE.Color(0xef4444);
    const coolJacket = new THREE.Color(0x2563eb);
    const hotJacket = new THREE.Color(0xea580c);
    const acidColor = new THREE.Color(0xf59e0b);
    const goldColor = new THREE.Color(0xf5b700);
    const baseColor = new THREE.Color(0x818cf8);
    const coolGlow = new THREE.Color(0x7dd3fc);
    const warmGlow = new THREE.Color(0xff8a3d);
    const shown = { agitation: 350, aeration: 1.2, feedRate: 0.35, temperature: 30, ph: 5, dissolvedOxygen: 30 };
    const ledColors: Record<string, number> = {
      running: 0x22c55e,
      paused: 0xf59e0b,
      idle: 0x64748b,
      finished: 0x60a5fa,
    };
    let hot = new Set<string>();
    let frame = 0;
    let spin = 0;
    let last = performance.now();
    const layout = new Map<number, number>();
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const store = useFermentation.getState();
      const s = store.live.state;

      if (frame++ % 15 === 0) {
        const alarms = store.live.samples.length > 1 ? modelAlarms(store.live.samples, store.sensitivity) : [];
        hot = new Set(alarms.map((alarm) => alarm.partId));
      }

      const autoSpin = !dragging && !store.dissect && !store.selectedPart && now - idleSince > 3500;
      if (autoSpin) ry += dt * 0.18;
      pivot.rotation.y = ry;
      pivot.rotation.x = rx;
      camera.fov = 34 / zoom;
      camera.updateProjectionMatrix();

      const open = store.dissect ? 1 : 0;
      for (const group of built.parts) {
        const target = group.userData.explode as THREE.Vector3;
        group.position.lerp(open ? target : built.zero, 0.08);
      }

      // Actuators follow the knobs immediately. A finished batch otherwise keeps the last reading.
      const replay = readingsRef.current !== undefined;
      const knobs = store.live.setpoints;
      const ease = 1 - Math.exp(-8 * dt);
      shown.agitation += ((replay ? s.agitation : knobs.agitation) - shown.agitation) * ease;
      shown.aeration += ((replay ? s.aeration : knobs.aeration) - shown.aeration) * ease;
      shown.feedRate += ((replay ? s.feedRate : knobs.feedRate) - shown.feedRate) * ease;
      shown.temperature += ((replay ? s.temperature : knobs.temperature) - shown.temperature) * ease;
      shown.ph += ((replay ? s.ph : knobs.ph) - shown.ph) * ease;
      shown.dissolvedOxygen += ((replay ? s.dissolvedOxygen : knobs.dissolvedOxygen) - shown.dissolvedOxygen) * ease;

      // Impellers turn at the agitation speed (slowed for the eye; full speed would blur).
      spin += (shown.agitation / 60) * dt * Math.PI * 2 * 0.35;
      built.spin.rotation.y = spin;
      built.motorFan.rotation.y = spin * 1.5;

      // Broth level follows volume; colour follows biomass, then the pH and temperature knobs.
      const fill = THREE.MathUtils.clamp((s.volume - 600) / 1000, 0.42, 0.93);
      const surfaceY = BOTTOM + H * fill;
      built.liquid.scale.y = fill;
      built.liquid.position.y = BOTTOM + (H * fill) / 2;
      built.surface.position.y = surfaceY;
      built.brothMarker.position.y = surfaceY - 0.08;
      const biomassT = THREE.MathUtils.clamp(s.biomass / 24, 0, 1);
      built.brothMaterial.color.copy(brothLow).lerp(brothHigh, biomassT);
      if (!replay) {
        const warmth = THREE.MathUtils.clamp((shown.temperature - 30) / 12, -1, 1);
        const phTint = THREE.MathUtils.clamp((5 - shown.ph) / 1.5, -1, 1);
        built.brothMaterial.color.offsetHSL(warmth * 0.04 + phTint * -0.08, Math.abs(phTint) * 0.22, warmth * -0.08);
      }
      built.surfaceMaterial.color.copy(built.brothMaterial.color).offsetHSL(0, 0, 0.06);
      built.bottomBroth.material = built.brothMaterial;
      const tempT = THREE.MathUtils.clamp((shown.temperature - 25) / 11, 0, 1);
      glow.color.copy(coolGlow).lerp(warmGlow, tempT);
      glow.intensity = 0.35 + biomassT * 0.7 + (replay ? 0 : tempT * 0.55);
      for (const material of built.jackets) {
        material.emissive.copy(coolJacket).lerp(hotJacket, tempT);
        material.emissiveIntensity = replay ? 0 : 0.2 + tempT * 1.3;
      }
      paintProbe(
        built.probes["ph:head"],
        acidColor,
        goldColor,
        baseColor,
        THREE.MathUtils.clamp((shown.ph - 4) / 2.5, 0, 1),
      );
      const tempMat = built.probes["temperature:head"];
      if (tempMat) {
        tempMat.emissive.copy(coolJacket).lerp(hotJacket, tempT);
        tempMat.emissiveIntensity = 0.45 + tempT * 1.2;
      }
      const doHead = built.probes["dissolvedOxygen:head"];
      if (doHead) {
        doHead.emissive.setHex(0x22c55e);
        doHead.emissiveIntensity = 0.2 + THREE.MathUtils.clamp(shown.dissolvedOxygen / 60, 0, 1) * 1.6;
      }
      const doTip = built.probes["dissolvedOxygen:tip"];
      if (doTip) {
        doTip.emissive.setHex(0x22c55e);
        doTip.emissiveIntensity = 0.15 + THREE.MathUtils.clamp(s.dissolvedOxygen / 60, 0, 1) * 1.8;
      }

      // Swirl and vortex on the surface, deeper with agitation.
      const swirl = THREE.MathUtils.clamp(shown.agitation / 600, 0.1, 1);
      const pos = built.surface.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = built.surfaceBase[i * 2] ?? 0;
        const z = built.surfaceBase[i * 2 + 1] ?? 0;
        const r = Math.hypot(x, z) / (R - 0.03);
        const a = Math.atan2(z, x);
        const vortex = -0.09 * swirl * (1 - r) ** 2;
        const ripple = 0.012 * swirl * Math.sin(a * 3 + t * 4 * swirl + r * 7);
        pos.setY(i, vortex + ripple);
      }
      pos.needsUpdate = true;
      built.surface.geometry.computeVertexNormals();
      built.foam.position.y = surfaceY + 0.006;
      (built.foam.material as THREE.MeshStandardMaterial).opacity = THREE.MathUtils.clamp(
        (shown.aeration - 0.2) / 1.8,
        0.04,
        0.9,
      );

      // Bubbles: how many and how fast follow aeration.
      const active = Math.round(THREE.MathUtils.clamp(shown.aeration / 2.2, 0.08, 1) * MAX_BUBBLES);
      const rise = 0.35 + shown.aeration * 0.45;
      for (let i = 0; i < MAX_BUBBLES; i++) {
        const b = built.bubbleState[i];
        if (!b) continue;
        b.y += rise * b.speed * dt;
        if (b.y > surfaceY - 0.02) {
          b.y = BOTTOM + 0.12;
          b.angle = Math.random() * Math.PI * 2;
          b.radius = 0.18 + Math.random() * 0.06;
        }
        const wobble = Math.sin(t * 5 + i) * 0.015;
        const swirlAngle = b.angle + (b.y - BOTTOM) * swirl * 1.4;
        const spread = b.radius + (b.y - BOTTOM) * 0.12;
        dummy.position.set(Math.cos(swirlAngle) * spread + wobble, b.y, Math.sin(swirlAngle) * spread);
        const size = b.size * (0.45 + shown.aeration * 0.55) * (0.7 + (b.y - BOTTOM) / H);
        dummy.scale.setScalar(i < active ? size : 0.0001);
        dummy.updateMatrix();
        built.bubbles.setMatrixAt(i, dummy.matrix);
      }
      built.bubbles.instanceMatrix.needsUpdate = true;

      // Yeast specks: more of them as biomass grows, carried round by the impeller.
      const cells = Math.round(biomassT * MAX_CELLS);
      for (let i = 0; i < MAX_CELLS; i++) {
        const c = built.cellState[i];
        if (!c) continue;
        c.angle += dt * (0.4 + swirl * 1.6) * c.speed;
        const y = BOTTOM + 0.08 + c.height * (surfaceY - BOTTOM - 0.12);
        dummy.position.set(Math.cos(c.angle) * c.radius, y + Math.sin(t * 2 + i) * 0.02, Math.sin(c.angle) * c.radius);
        dummy.scale.setScalar(i < cells ? 1 : 0.0001);
        dummy.updateMatrix();
        built.cells.setMatrixAt(i, dummy.matrix);
      }
      built.cells.instanceMatrix.needsUpdate = true;

      // Feed drops: fall from the inlet at a rate set by the feed pump.
      const dropEvery = 1.6 / Math.max(0.05, shown.feedRate * 4);
      for (let i = 0; i < MAX_DROPS; i++) {
        const phase = (((t / dropEvery + i / MAX_DROPS) % 1) + 1) % 1;
        const y = TOP - 0.02 - phase * (TOP - surfaceY);
        dummy.position.set(built.inlet.x, y, built.inlet.z);
        const dropScale = shown.feedRate > 0.02 && i < Math.ceil(shown.feedRate * 8) ? 0.7 + shown.feedRate : 0.0001;
        dummy.scale.setScalar(dropScale);
        dummy.updateMatrix();
        built.drops.setMatrixAt(i, dummy.matrix);
      }
      built.drops.instanceMatrix.needsUpdate = true;

      // Status: motor LED by batch state, base ring red when Model A suspects a fault.
      (built.led.material as THREE.MeshStandardMaterial).emissive.setHex(ledColors[store.live.status] ?? 0x64748b);
      const faulty = hot.size > 0;
      const ringMat = built.statusRing.material as THREE.MeshStandardMaterial;
      ringMat.emissive.copy(faulty ? ringBad : ringOk);
      ringMat.emissiveIntensity = faulty ? 1.2 + Math.sin(t * 6) * 0.8 : 0.6;

      // Part highlight: selected, hovered, or outside its band.
      for (const group of built.parts) {
        const id = group.userData.partId as string;
        let level = 0;
        if (id === store.selectedPart) level = 0.55;
        else if (id === hovered) level = 0.3;
        const alarm = hot.has(id) ? 0.35 + Math.sin(t * 6) * 0.25 : 0;
        group.traverse((node) => {
          if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return;
          if (node.userData.keepEmissive) return;
          node.material.emissive.set(alarm > 0 ? 0xef4444 : 0x38bdf8);
          node.material.emissiveIntensity = Math.max(level, alarm);
        });
      }

      renderer.render(scene, camera);
      paintCallouts(
        canvas,
        svgRef.current,
        chipRefs.current,
        built.markers,
        camera,
        s,
        store.selectedPart,
        hot,
        layout,
        readingsRef.current,
        replay ? undefined : knobs,
      );
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.InstancedMesh) {
          node.geometry.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) material.dispose();
        }
      });
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  const hotParts = new Set(samples.length > 1 ? modelAlarms(samples, sensitivity).map((alarm) => alarm.partId) : []);
  const part = CALLOUTS.find((item) => item.id === selected) ?? null;

  return (
    <div
      className="relative h-[500px] w-full overflow-hidden rounded-lg border"
      style={{ background: "radial-gradient(ellipse at 50% 35%, #233142 0%, #121a24 55%, #0a0f15 100%)" }}
    >
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab touch-pan-y active:cursor-grabbing" />
      {noGl ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-slate-300 text-sm">
          The 3D vessel needs WebGL, which this browser has turned off. Sensor cards and models keep working.
        </p>
      ) : null}
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
          style={{ display: "none", borderColor: selected === callout.id ? callout.color : undefined }}
          className="absolute z-[5] flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/15 bg-slate-950/80 px-2.5 py-1 text-left shadow-lg backdrop-blur-sm transition-colors hover:border-white/40"
          onClick={() => setSelected(selected === callout.id ? null : callout.id)}
        >
          <span className="block size-2 shrink-0 rounded-full" style={{ background: callout.color }} />
          <span className="flex flex-col leading-tight">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">{callout.label}</span>
            <span data-value className="font-semibold text-[12px] text-white tabular-nums" />
          </span>
        </button>
      ))}
      <div className="pointer-events-none absolute top-3 left-3 z-[6] flex items-center gap-2">
        <span className="rounded-full border border-white/15 bg-slate-950/70 px-2.5 py-0.5 font-medium text-[11px] text-slate-200 backdrop-blur-sm">
          BR-101 · {readings ? "Replay" : (STATUS_LABEL[status] ?? status)}
        </span>
        {!readings && hotParts.size > 0 ? (
          <span className="rounded-full border border-red-400/50 bg-red-500/20 px-2.5 py-0.5 font-medium text-[11px] text-red-200">
            Fault suspected
          </span>
        ) : null}
      </div>
      <div className="absolute top-3 right-3 z-[6]">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 bg-slate-950/70 text-slate-100 backdrop-blur-sm hover:bg-slate-900"
          onClick={() => setDissect(!dissect)}
        >
          {dissect ? "Assemble" : "Dissect"}
        </Button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[6] flex justify-center px-3">
        <div className="max-w-80 rounded-lg border border-white/15 bg-slate-950/80 px-3 py-2 text-center backdrop-blur-sm">
          <div className="font-medium text-[13px] text-white">{part ? part.label : "Bioreactor BR-101"}</div>
          <div className="text-[11px] text-slate-300">
            {calloutCaption(part?.id, state, readings, readings ? undefined : setpoints)}
            {part && hotParts.has(part.id) ? " This part is outside its normal band." : ""}
          </div>
        </div>
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
  hot: Set<string>,
  layout: Map<number, number>,
  readings?: Partial<Record<string, string>>,
  knobs?: Setpoints,
) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const world = new THREE.Vector3();
  const columns: Record<"left" | "right", { index: number; sx: number; sy: number }[]> = { left: [], right: [] };

  markers.forEach((marker, index) => {
    const callout = CALLOUTS[index];
    if (!callout) return;
    marker.getWorldPosition(world);
    const p = world.project(camera);
    columns[callout.side].push({ index, sx: (p.x * 0.5 + 0.5) * width, sy: (-p.y * 0.5 + 0.5) * height });
  });

  const top = 70;
  const bottom = height - 96;
  const gap = 40;
  for (const side of ["left", "right"] as const) {
    // Each part keeps its side; chips are ordered by height and eased toward their slot so they never jump.
    const items = columns[side].sort((a, b) => a.sy - b.sy);
    const targets: number[] = [];
    let cursor = top;
    for (const item of items) {
      const y = Math.max(cursor, Math.min(bottom, item.sy));
      targets.push(y);
      cursor = y + gap;
    }
    const overflow = (targets.at(-1) ?? 0) - bottom;
    if (overflow > 0) for (let i = 0; i < targets.length; i++) targets[i] = (targets[i] ?? 0) - overflow;

    items.forEach((item, order) => {
      const chip = chips[item.index];
      const callout = CALLOUTS[item.index];
      if (!chip || !callout) return;
      const target = targets[order] ?? item.sy;
      const prev = layout.get(item.index) ?? target;
      const y = prev + (target - prev) * 0.2;
      layout.set(item.index, y);

      chip.style.display = "flex";
      const x = side === "left" ? 12 : width - 12;
      chip.style.left = `${x}px`;
      chip.style.top = `${y}px`;
      chip.style.transform = side === "left" ? "translate(0, -50%)" : "translate(-100%, -50%)";
      const value = chip.querySelector<HTMLElement>("[data-value]");
      const text = readings?.[callout.id] ?? reading(callout.id, state, knobs);
      if (value && value.textContent !== text) value.textContent = text;

      const chipWidth = chip.offsetWidth || 110;
      const edge = side === "left" ? x + chipWidth : x - chipWidth;
      const elbow = side === "left" ? edge + 22 : edge - 22;
      const isSelected = callout.id === selected;
      const color = hot.has(callout.id) ? "#ef4444" : callout.color;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${item.sx} ${item.sy} L ${elbow} ${y} L ${edge} ${y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", isSelected ? "2" : "1.2");
      path.setAttribute("opacity", isSelected ? "1" : "0.7");
      svg.appendChild(path);
      const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      halo.setAttribute("cx", String(item.sx));
      halo.setAttribute("cy", String(item.sy));
      halo.setAttribute("r", isSelected ? "8" : "6");
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", color);
      halo.setAttribute("opacity", "0.45");
      svg.appendChild(halo);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(item.sx));
      dot.setAttribute("cy", String(item.sy));
      dot.setAttribute("r", "3");
      dot.setAttribute("fill", color);
      svg.appendChild(dot);
    });
  }
}

function calloutCaption(
  id: string | undefined,
  state: ProcessState,
  readings?: Partial<Record<string, string>>,
  knobs?: Setpoints,
) {
  if (!id) {
    return readings
      ? "Penicillin, IndPenSim. This is not the yeast protein run."
      : "Drag to rotate · Ctrl/⌘ + scroll to zoom · Click a part";
  }
  const value = readings?.[id] ?? reading(id, state, knobs);
  return readings ? value : `${value} · ${COPY[id as CalloutId]}`;
}

function reading(id: string, state: ProcessState, knobs?: Setpoints) {
  if (id === "ph") {
    if (knobs && Math.abs(knobs.ph - state.ph) >= 0.05) return `set ${knobs.ph.toFixed(2)}`;
    return state.ph.toFixed(2);
  }
  if (id === "temperature") {
    if (knobs && Math.abs(knobs.temperature - state.temperature) >= 0.2)
      return `set ${knobs.temperature.toFixed(1)} °C`;
    return `${state.temperature.toFixed(1)} °C`;
  }
  if (id === "dissolvedOxygen") return `${state.dissolvedOxygen.toFixed(1)} %`;
  if (id === "impeller" || id === "motor") return `${(knobs?.agitation ?? state.agitation).toFixed(0)} rpm`;
  if (id === "sparger") return `${(knobs?.aeration ?? state.aeration).toFixed(2)} vvm`;
  return `${state.volume.toFixed(0)} L · ${state.biomass.toFixed(1)} g/L yeast`;
}

function paintProbe(
  material: THREE.MeshStandardMaterial | undefined,
  low: THREE.Color,
  mid: THREE.Color,
  high: THREE.Color,
  t: number,
) {
  if (!material) return;
  if (t < 0.4) material.emissive.copy(low).lerp(mid, t / 0.4);
  else material.emissive.copy(mid).lerp(high, (t - 0.4) / 0.6);
  material.emissiveIntensity = 0.85;
}

// ---------------------------------------------------------------- model

const steel = (roughness = 0.28) =>
  new THREE.MeshStandardMaterial({ color: 0xc9d1da, metalness: 1, roughness, envMapIntensity: 1.1 });
const darkMetal = () => new THREE.MeshStandardMaterial({ color: 0x1f2933, metalness: 0.7, roughness: 0.35 });
const plastic = (color: number) => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.4 });

function buildReactor() {
  const root = new THREE.Group();
  const parts: THREE.Group[] = [];
  const markers: THREE.Object3D[] = [];
  const zero = new THREE.Vector3();

  // Stage: floor disc and status ring, outside the pivot so it stays put while the vessel turns.
  const stage = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.9, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.3, roughness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR;
  floor.receiveShadow = true;
  stage.add(floor);
  const statusRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.015, 8, 96),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x2dd4bf, emissiveIntensity: 0.6 }),
  );
  statusRing.rotation.x = Math.PI / 2;
  statusRing.position.y = FLOOR + 0.01;
  stage.add(statusRing);

  // Frame: glass, dished bottom, head plate with bolts, jacket bands, stand, baffles. Not pickable.
  const frame = part(root, "frame", [0, 0, 0], false);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xeaf6ff,
    metalness: 0,
    roughness: 0.04,
    transmission: 0.95,
    thickness: 0.04,
    ior: 1.45,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true), glassMaterial);
  glass.renderOrder = 5;
  frame.add(glass);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    glassMaterial,
  );
  dish.scale.y = 0.32;
  dish.position.y = BOTTOM;
  dish.renderOrder = 5;
  frame.add(dish);
  const headPlate = mesh(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.08, 64), steel(0.22));
  headPlate.position.y = TOP + 0.04;
  frame.add(headPlate);
  for (let i = 0; i < 16; i++) {
    const bolt = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 10), darkMetal());
    const a = (i / 16) * Math.PI * 2;
    bolt.position.set(Math.cos(a) * (R + 0.05), TOP + 0.1, Math.sin(a) * (R + 0.05));
    frame.add(bolt);
  }
  for (const y of [TOP - 0.05, BOTTOM + 0.05, 0.1, -0.45]) {
    const band = mesh(new THREE.TorusGeometry(R + 0.012, y === 0.1 || y === -0.45 ? 0.012 : 0.03, 12, 72), steel(0.3));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    if (y === 0.1 || y === -0.45) band.userData.jacket = true;
    frame.add(band);
  }
  const legRing = mesh(new THREE.TorusGeometry(R * 0.85, 0.03, 10, 48), steel(0.35));
  legRing.rotation.x = Math.PI / 2;
  legRing.position.y = BOTTOM - 0.12;
  frame.add(legRing);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const legTop = new THREE.Vector3(Math.cos(a) * R * 0.85, BOTTOM - 0.12, Math.sin(a) * R * 0.85);
    const legFoot = new THREE.Vector3(Math.cos(a) * R * 1.1, FLOOR + 0.03, Math.sin(a) * R * 1.1);
    frame.add(tube([legTop, legFoot], 0.035, steel(0.35)));
    const foot = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.04, 20), darkMetal());
    foot.position.copy(legFoot);
    frame.add(foot);
  }
  for (let i = 0; i < 4; i++) {
    const baffle = mesh(new THREE.BoxGeometry(0.03, H * 0.82, 0.09), steel(0.25));
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    baffle.position.set(Math.cos(a) * (R - 0.09), -0.05, Math.sin(a) * (R - 0.09));
    baffle.lookAt(0, -0.05, 0);
    frame.add(baffle);
  }
  // Off-gas line out of the head plate.
  frame.add(
    tube(
      [
        new THREE.Vector3(-0.42, TOP + 0.08, -0.32),
        new THREE.Vector3(-0.42, TOP + 0.45, -0.32),
        new THREE.Vector3(-0.75, TOP + 0.6, -0.4),
      ],
      0.035,
      steel(0.3),
    ),
  );

  // Feed: a sugar bottle on the stage, silicone tube into a head-plate port, drops into the broth.
  const inlet = new THREE.Vector3(0.42, TOP, 0.2);
  const feed = part(root, "feed", [0.6, 0, 0.4], false);
  const bottle = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.45, 32), glassMaterial);
  bottle.position.set(1.35, FLOOR + 0.23, 0.35);
  feed.add(bottle);
  const syrup = mesh(
    new THREE.CylinderGeometry(0.155, 0.155, 0.32, 32),
    new THREE.MeshStandardMaterial({ color: 0xd99a2b, roughness: 0.2, transparent: true, opacity: 0.85 }),
  );
  syrup.position.set(1.35, FLOOR + 0.17, 0.35);
  feed.add(syrup);
  const bottleCap = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 20), plastic(0x2563eb));
  bottleCap.position.set(1.35, FLOOR + 0.48, 0.35);
  feed.add(bottleCap);
  feed.add(
    tube(
      [
        new THREE.Vector3(1.35, FLOOR + 0.5, 0.35),
        new THREE.Vector3(1.35, TOP + 0.55, 0.35),
        new THREE.Vector3(0.9, TOP + 0.55, 0.25),
        new THREE.Vector3(inlet.x, TOP + 0.35, inlet.z),
        new THREE.Vector3(inlet.x, TOP + 0.08, inlet.z),
      ],
      0.022,
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, transparent: true, opacity: 0.7 }),
    ),
  );
  const pump = mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), plastic(0x334155));
  pump.position.set(1.35, TOP + 0.05, 0.35);
  feed.add(pump);
  const dropMaterial = new THREE.MeshStandardMaterial({ color: 0xe0a33a, roughness: 0.15 });
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 10, 8), dropMaterial, MAX_DROPS);
  drops.frustumCulled = false;
  root.add(drops);

  // Broth: liquid body, dished bottom, animated surface, foam, yeast specks.
  const broth = part(root, "broth", [0.95, 0, 0.15], true);
  const brothMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf1e4b3,
    roughness: 0.25,
    transmission: 0.35,
    thickness: 1,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  const liquid = mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, H, 64, 1, true), brothMaterial);
  liquid.renderOrder = 2;
  broth.add(liquid);
  const bottomBroth = mesh(
    new THREE.SphereGeometry(R - 0.03, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    brothMaterial,
  );
  bottomBroth.scale.y = 0.3;
  bottomBroth.position.y = BOTTOM;
  bottomBroth.renderOrder = 2;
  broth.add(bottomBroth);
  const surfaceGeometry = new THREE.RingGeometry(0.001, R - 0.03, 64, 10);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surfaceBase = new Float32Array((surfaceGeometry.attributes.position as THREE.BufferAttribute).count * 2);
  const surfacePos = surfaceGeometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < surfacePos.count; i++) {
    surfaceBase[i * 2] = surfacePos.getX(i);
    surfaceBase[i * 2 + 1] = surfacePos.getZ(i);
  }
  const surfaceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf5ebc4,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  const surface = mesh(surfaceGeometry, surfaceMaterial);
  surface.renderOrder = 3;
  broth.add(surface);
  const foam = mesh(
    new THREE.RingGeometry(R - 0.2, R - 0.03, 64, 1),
    new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      roughness: 0.9,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.renderOrder = 4;
  foam.userData.keepEmissive = true;
  broth.add(foam);
  const cells = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.012, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.6 }),
    MAX_CELLS,
  );
  cells.frustumCulled = false;
  cells.userData.keepEmissive = true;
  broth.add(cells);
  const cellState = Array.from({ length: MAX_CELLS }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 0.08 + Math.random() * (R - 0.16),
    height: Math.random(),
    speed: 0.6 + Math.random() * 0.8,
  }));
  const brothMarker = marker(broth, R * 0.72, 0, R * 0.35);

  // Agitation: shaft with twin Rushton turbines.
  const impeller = part(root, "impeller", [-1.1, 0.05, 0.2], true);
  const spin = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.03, 0.03, H + 0.25, 16), steel(0.18));
  shaft.position.y = 0.1;
  spin.add(shaft);
  for (const y of [-0.62, -0.02]) {
    const disc = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 32), steel(0.2));
    disc.position.y = y;
    spin.add(disc);
    const hub = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), steel(0.2));
    hub.position.y = y;
    spin.add(hub);
    for (let i = 0; i < 6; i++) {
      const blade = mesh(new THREE.BoxGeometry(0.13, 0.1, 0.012), steel(0.25));
      const a = (i / 6) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.2, y, Math.sin(a) * 0.2);
      blade.rotation.y = -a;
      spin.add(blade);
    }
  }
  impeller.add(spin);
  marker(impeller, 0.27, -0.62, 0);

  // Aeration: sparger ring with holes and the air line through the dished bottom.
  const sparger = part(root, "sparger", [0.2, -0.25, 1.0], true);
  const ring = mesh(new THREE.TorusGeometry(0.22, 0.02, 12, 48), steel(0.3));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = BOTTOM + 0.1;
  sparger.add(ring);
  sparger.add(
    tube(
      [
        new THREE.Vector3(0.22, BOTTOM + 0.1, 0),
        new THREE.Vector3(0.3, BOTTOM - 0.1, 0),
        new THREE.Vector3(0.35, BOTTOM - 0.32, 0),
        new THREE.Vector3(-1.1, FLOOR + 0.12, -0.35),
      ],
      0.022,
      steel(0.3),
    ),
  );
  const filter = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 24), plastic(0xe2e8f0));
  filter.position.set(-1.1, FLOOR + 0.12, -0.35);
  sparger.add(filter);
  const bubbles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 0.35,
      roughness: 0.1,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
    MAX_BUBBLES,
  );
  bubbles.frustumCulled = false;
  bubbles.renderOrder = 4;
  bubbles.userData.keepEmissive = true;
  sparger.add(bubbles);
  const bubbleState = Array.from({ length: MAX_BUBBLES }, () => ({
    y: BOTTOM + 0.12 + Math.random() * H * 0.8,
    angle: Math.random() * Math.PI * 2,
    radius: 0.18 + Math.random() * 0.06,
    speed: 0.7 + Math.random() * 0.6,
    size: 0.02 + Math.random() * 0.025,
  }));
  marker(sparger, -0.22, BOTTOM + 0.1, 0);

  // Probes through the head plate, angled, with connector caps and cables.
  addProbe(root, "ph", 0xf5b700, new THREE.Vector3(-0.38, TOP, 0.28), [-1.0, 0.2, -0.2]);
  addProbe(root, "temperature", 0xef4444, new THREE.Vector3(0.18, TOP, -0.45), [1.0, 0.3, -0.2]);
  addProbe(root, "dissolvedOxygen", 0x22c55e, new THREE.Vector3(-0.1, TOP, 0.5), [0.05, 0.2, 1.1]);

  // Motor: housing with cooling fins, coupling, fan cap and a status LED.
  const motor = part(root, "motor", [0, 0.42, 0], true);
  const housing = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 40), darkMetal());
  housing.position.y = TOP + 0.38;
  motor.add(housing);
  for (let i = 0; i < 6; i++) {
    const fin = mesh(new THREE.TorusGeometry(0.205, 0.008, 6, 40), steel(0.4));
    fin.rotation.x = Math.PI / 2;
    fin.position.y = TOP + 0.22 + i * 0.06;
    motor.add(fin);
  }
  const coupling = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 24), steel(0.25));
  coupling.position.y = TOP + 0.13;
  motor.add(coupling);
  const cap = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 40), darkMetal());
  cap.position.y = TOP + 0.62;
  motor.add(cap);
  const motorFan = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const vane = mesh(new THREE.BoxGeometry(0.14, 0.01, 0.03), steel(0.3));
    vane.rotation.y = (i / 4) * Math.PI;
    motorFan.add(vane);
  }
  motorFan.position.y = TOP + 0.66;
  motor.add(motorFan);
  const led = mesh(
    new THREE.SphereGeometry(0.022, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x22c55e, emissiveIntensity: 2 }),
  );
  led.userData.keepEmissive = true;
  led.position.set(0, TOP + 0.48, 0.2);
  motor.add(led);
  marker(motor, 0.2, TOP + 0.4, 0.05);

  const byName = new Map(root.children.map((child) => [child.name, child]));
  for (const callout of CALLOUTS) {
    const host = byName.get(callout.id);
    const found = host?.children.find((child) => child.name === `mark:${callout.id}`);
    if (found) markers.push(found);
  }
  parts.push(...(root.children.filter((child) => child.userData.partId && child.name !== "frame") as THREE.Group[]));

  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh)) {
      const material = node.material as THREE.Material;
      if (!(material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0.5)) node.castShadow = true;
    }
  });

  const probes: Record<string, THREE.MeshStandardMaterial> = {};
  const jackets: THREE.MeshStandardMaterial[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (typeof node.userData.probeRole === "string" && node.material instanceof THREE.MeshStandardMaterial) {
      probes[node.userData.probeRole] = node.material;
    }
    if (node.userData.jacket && node.material instanceof THREE.MeshStandardMaterial) jackets.push(node.material);
  });

  return {
    root,
    stage,
    parts,
    markers,
    zero,
    spin,
    motorFan,
    led,
    statusRing,
    liquid,
    bottomBroth,
    surface,
    surfaceBase,
    surfaceMaterial,
    foam,
    brothMaterial,
    brothMarker,
    bubbles,
    bubbleState,
    cells,
    cellState,
    drops,
    inlet,
    probes,
    jackets,
  };
}

function addProbe(
  root: THREE.Group,
  id: string,
  color: number,
  port: THREE.Vector3,
  explode: [number, number, number],
) {
  const group = part(root, id, explode, true);
  const tip = new THREE.Vector3(port.x * 1.25, BOTTOM + 0.45, port.z * 1.25);
  group.add(tube([port.clone().setY(TOP + 0.12), tip], 0.022, steel(0.2)));
  const sensor = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.1, 16), plastic(color));
  sensor.position.copy(tip);
  sensor.userData.probeRole = `${id}:tip`;
  sensor.userData.keepEmissive = true;
  group.add(sensor);
  const head = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 20), plastic(color));
  head.position.set(port.x, TOP + 0.2, port.z);
  head.userData.probeRole = `${id}:head`;
  head.userData.keepEmissive = true;
  group.add(head);
  group.add(
    tube(
      [
        new THREE.Vector3(port.x, TOP + 0.27, port.z),
        new THREE.Vector3(port.x * 1.4, TOP + 0.55, port.z * 1.4),
        new THREE.Vector3(port.x * 2.2, TOP + 0.5, port.z * 2.2),
      ],
      0.01,
      plastic(0x0f172a),
    ),
  );
  marker(group, port.x, TOP + 0.28, port.z);
}

function tube(points: THREE.Vector3[], radius: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  return mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, 10, false), material);
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
  return new THREE.Mesh(geometry, material);
}

function marker(group: THREE.Group, x: number, y: number, z: number) {
  const point = new THREE.Object3D();
  point.name = `mark:${group.name}`;
  point.position.set(x, y, z);
  group.add(point);
  return point;
}

function part(parent: THREE.Group, id: string, explode: [number, number, number], pickable: boolean) {
  const group = new THREE.Group();
  group.name = id;
  group.userData.partId = id;
  group.userData.pickable = pickable;
  group.userData.explode = new THREE.Vector3(...explode);
  parent.add(group);
  return group;
}
