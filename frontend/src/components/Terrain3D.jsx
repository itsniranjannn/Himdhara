import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// A procedural Himalayan valley drawn like a survey sheet: contour lines, a flowing river,
// one pin per station of the active basin, and a flood wave that runs down the channel and
// lights each pin as it passes. The terrain is generated, not surveyed.
const DEPTH = 14;
const WIDTH = 9;
const RISK_HEX = { NORMAL: null, WATCH: "watch", WARNING: "warning", CRITICAL: "critical", STALE: "stale" };

const riverX = (z) => Math.sin(z * 0.55) * 1.1 + Math.sin(z * 1.3 + 1) * 0.35;
const ridgeNoise = (x, z) => Math.sin(x * 1.7 + z * 0.9) * 0.5 + Math.sin(x * 3.1 - z * 2.3 + 1.3) * 0.25 + Math.sin(x * 6.2 + z * 5.1 + 2.1) * 0.125 + Math.sin(x * 11.3 - z * 9.7) * 0.06;
function heightAt(x, z) {
  const upstream = 1 - (z + DEPTH / 2) / DEPTH;
  const valley = Math.min(1, Math.pow(Math.abs(x - riverX(z)) / 3.4, 1.35));
  return valley * (0.5 + (ridgeNoise(x, z) + 1.1) * 1.35 * (0.45 + upstream)) + upstream * 1.7;
}

const css = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};
const palette = () => ({
  paper: new THREE.Color(css("--surface-1", "#f8f3e6")),
  ink: new THREE.Color(css("--text-1", "#15222a")),
  brand: new THREE.Color(css("--brand", "#1b4f7b")),
  accent: new THREE.Color(css("--accent", "#b82e14")),
  watch: new THREE.Color(css("--watch", "#85600a")),
  warning: new THREE.Color(css("--warning", "#a64709")),
  critical: new THREE.Color(css("--critical", "#b3122a")),
  stale: new THREE.Color(css("--stale", "#52626a")),
});

const TERRAIN_VERT = `
  varying float vH; varying vec3 vPos; varying float vD;
  void main() {
    vH = position.y; vPos = position;
    float rx = sin(position.z * 0.55) * 1.1 + sin(position.z * 1.3 + 1.0) * 0.35;
    vD = abs(position.x - rx);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const TERRAIN_FRAG = `
  uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uBrand;
  varying float vH; varying vec3 vPos; varying float vD;
  float contour(float h, float step) {
    float v = h / step;
    float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 0.0001);
    return 1.0 - clamp(d, 0.0, 1.0);
  }
  void main() {
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    float light = dot(n, normalize(vec3(-0.5, 0.8, 0.35))) * 0.5 + 0.5;
    vec3 col = uPaper * mix(0.72, 1.06, light);
    col = mix(col, uPaper * 0.82, smoothstep(1.0, 4.5, vH) * 0.35);
    float minor = contour(vH, 0.22);
    float major = contour(vH, 1.1);
    col = mix(col, uInk, minor * 0.28);
    col = mix(col, uInk, major * 0.7);
    float bank = 1.0 - smoothstep(0.35, 1.25, vD);
    col = mix(col, uBrand, bank * 0.28);
    gl_FragColor = vec4(col, 1.0);
  }`;
const RIVER_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIVER_FRAG = `
  uniform float uTime; uniform vec3 uBrand; uniform vec3 uLight;
  varying vec2 vUv;
  void main() {
    float stripe = sin(vUv.y * 140.0 - uTime * 5.0) * 0.5 + 0.5;
    float edge = smoothstep(0.0, 0.22, vUv.x) * (1.0 - smoothstep(0.78, 1.0, vUv.x));
    vec3 col = mix(uBrand, uLight, stripe * 0.55);
    gl_FragColor = vec4(col, 0.95 * edge);
  }`;

function buildTerrain(colors) {
  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, 150, 210);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
    uniforms: { uPaper: { value: colors.paper }, uInk: { value: colors.ink }, uBrand: { value: colors.brand } },
  });
  return new THREE.Mesh(geometry, material);
}

function buildRiver(colors) {
  const steps = 260, half = 0.17;
  const positions = [], uvs = [], indices = [];
  const curve = [];
  for (let i = 0; i <= steps; i++) {
    const z = -DEPTH / 2 + (DEPTH * i) / steps;
    const x = riverX(z);
    const y = heightAt(x, z) + 0.05;
    curve.push(new THREE.Vector3(x, y, z));
    const ahead = riverX(z + 0.05) - x;
    const norm = new THREE.Vector2(1, -ahead / 0.05).normalize();
    positions.push(x - norm.x * half, y, z - norm.y * half, x + norm.x * half, y, z + norm.y * half);
    uvs.push(0, i / steps, 1, i / steps);
    if (i < steps) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uBrand: { value: colors.brand }, uLight: { value: colors.brand.clone().lerp(colors.paper, 0.5) } },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return { mesh, curve, material };
}

const pointOnCurve = (curve, t) => {
  const f = Math.min(Math.max(t, 0), 1) * (curve.length - 1);
  const i = Math.floor(f), j = Math.min(i + 1, curve.length - 1);
  return curve[i].clone().lerp(curve[j], f - i);
};

const webglAvailable = () => {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
};

export default function Terrain3D({ stations = [], reduced = false }) {
  const mount = useRef(null);
  const labels = useRef(null);
  const [supported] = useState(webglAvailable);
  const key = stations.map((s) => `${s.name}:${s.risk}`).join("|");

  useEffect(() => {
    const host = mount.current;
    if (!host) return undefined;
    if (!supported) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const world = new THREE.Group();
    scene.add(world);
    let colors = palette();
    const terrain = buildTerrain(colors);
    const river = buildRiver(colors);
    world.add(terrain, river.mesh);
    world.position.y = -1.6;

    const items = stations.length ? stations : [{ name: "Station", risk: "NORMAL" }];
    const pins = items.map((item, index) => {
      const t = (index + 0.5) / items.length * 0.86 + 0.07;
      const base = pointOnCurve(river.curve, t);
      const group = new THREE.Group();
      group.position.copy(base);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), new THREE.MeshBasicMaterial({ color: colors.ink }));
      stem.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshBasicMaterial({ color: colors.brand }));
      head.position.y = 0.95;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: colors.accent, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
      group.add(stem, head, ring);
      world.add(group);
      const key = RISK_HEX[item.risk];
      const own = key ? colors[key] : null;
      if (own) head.material.color.copy(own);
      return { t, group, head, ring, own, flash: 0, base: own ? own.clone() : colors.brand.clone() };
    });

    const wave = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), new THREE.MeshBasicMaterial({ color: colors.accent }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 48), new THREE.MeshBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    world.add(wave, halo);

    // HTML labels (plain text nodes, never innerHTML)
    const labelHost = labels.current;
    const tags = items.map((item) => {
      const el = document.createElement("span");
      el.className = "terrain-label";
      el.textContent = item.name;
      labelHost?.appendChild(el);
      return el;
    });

    camera.position.set(9.6, 7.6, 12.4);
    camera.lookAt(0, 0.1, 0);

    const resize = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 500;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(() => { resize(); draw(0); });
    observer.observe(host);

    const themeWatcher = new MutationObserver(() => {
      colors = palette();
      terrain.material.uniforms.uPaper.value.copy(colors.paper);
      terrain.material.uniforms.uInk.value.copy(colors.ink);
      terrain.material.uniforms.uBrand.value.copy(colors.brand);
      river.material.uniforms.uBrand.value.copy(colors.brand);
      river.material.uniforms.uLight.value.copy(colors.brand).lerp(colors.paper, 0.5);
      wave.material.color.copy(colors.accent);
      halo.material.color.copy(colors.accent);
      pins.forEach((p) => { const k = RISK_HEX[items[pins.indexOf(p)].risk]; p.base = (k ? colors[k] : colors.brand).clone(); p.head.material.color.copy(p.base); p.ring.material.color.copy(colors.accent); });
      draw(0);
    });
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const pointer = { x: 0, y: 0 };
    const onPointer = (event) => {
      const box = host.getBoundingClientRect();
      pointer.x = ((event.clientX - box.left) / box.width - 0.5) * 2;
      pointer.y = ((event.clientY - box.top) / box.height - 0.5) * 2;
    };
    host.addEventListener("pointermove", onPointer);

    const projected = new THREE.Vector3();
    let time = 0, last = performance.now(), frame = 0, running = false, visible = true;
    const CYCLE = 9;

    function draw(delta) {
      time += delta;
      const spin = Math.sin(time * 0.18) * 0.28 - 0.35 + pointer.x * 0.22;
      world.rotation.y += (spin - world.rotation.y) * 0.06;
      world.rotation.x += (pointer.y * 0.05 - world.rotation.x) * 0.06;
      river.material.uniforms.uTime.value = time;
      const t = reduced ? 0.55 : (time % CYCLE) / CYCLE;
      const point = pointOnCurve(river.curve, t);
      wave.position.copy(point).add(new THREE.Vector3(0, 0.2, 0));
      halo.position.copy(point).add(new THREE.Vector3(0, 0.08, 0));
      halo.scale.setScalar(1 + Math.sin(time * 6) * 0.25);
      pins.forEach((pin, i) => {
        const near = Math.abs(t - pin.t) < 0.035 && !reduced;
        pin.flash = near ? 1 : Math.max(0, pin.flash - delta * 0.7);
        pin.head.material.color.copy(pin.base).lerp(colors.accent, pin.flash);
        pin.head.scale.setScalar(1 + pin.flash * 0.9);
        pin.ring.material.opacity = pin.flash * 0.9;
        pin.ring.scale.setScalar(1 + (1 - pin.flash) * 2.4);
        projected.copy(pin.group.position).add(new THREE.Vector3(0, 1.15, 0));
        world.localToWorld(projected);
        projected.project(camera);
        const tag = tags[i];
        if (tag) tag.style.transform = `translate(${(projected.x * 0.5 + 0.5) * host.clientWidth}px, ${(-projected.y * 0.5 + 0.5) * host.clientHeight}px) translate(-50%, -100%)`;
        if (tag) tag.classList.toggle("hot", pin.flash > 0.3);
      });
      renderer.render(scene, camera);
    }
    const loop = (now) => {
      if (!running) return;
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      draw(delta);
      frame = requestAnimationFrame(loop);
    };
    const start = () => { if (running || reduced || !visible || document.hidden) return; running = true; last = performance.now(); frame = requestAnimationFrame(loop); };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); else stop(); }, { threshold: 0.05 });
    io.observe(host);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    draw(0);
    start();

    return () => {
      stop();
      io.disconnect(); observer.disconnect(); themeWatcher.disconnect();
      host.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      tags.forEach((el) => el.remove());
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        materials.forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // `stations` is summarised by `key`, so the scene only rebuilds when the pins actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, supported]);

  if (!supported) return <div className="terrain-fallback">3D view needs WebGL, which this browser has turned off. Everything else still works.</div>;
  return <div className="terrain" ref={mount} role="img" aria-label="Three-dimensional contour model of a river valley with station pins and a flood wave moving downstream"><div className="terrain-labels" ref={labels} /></div>;
}
