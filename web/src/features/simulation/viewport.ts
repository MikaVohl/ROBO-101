import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { GeometrySpec, ModelMessage, StateMessage } from './types';

/** Draw MuJoCo geometry and transforms; physics stays in the UV server. */
export class RobotViewport {
  readonly container: HTMLElement;
  readonly showcase: boolean;
  readonly scene: THREE.Scene;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  readonly matrix: THREE.Matrix4;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly orbit: OrbitControls;
  readonly observer: ResizeObserver;
  model?: ModelMessage;

  constructor(container: HTMLElement, { showcase = false } = {}) {
    this.container = container;
    this.showcase = showcase;
    this.scene = new THREE.Scene();
    this.meshes = [];
    this.matrix = new THREE.Matrix4();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x18181c, 0);
    container.prepend(this.renderer.domElement);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = showcase ? 0.75 : 0.6;
    this.orbit.maxDistance = showcase ? 2.8 : 12;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.AmbientLight(0xd6d6d6, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-2, -3, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -4;
    key.shadow.camera.right = key.shadow.camera.top = 4;
    key.shadow.normalBias = 0.015;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd6dde2, 1.2);
    fill.position.set(3, 2, 4);
    this.scene.add(fill);
    const grid = new THREE.GridHelper(8, 40, 0x626265, 0x424245);
    grid.visible = !showcase;
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    this.scene.add(grid);
    this.observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.observer.observe(container);
    this.resetCamera();
    this.renderer.setAnimationLoop(() => {
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  geometry(spec: GeometrySpec) {
    const [x, y, z] = spec.size;
    switch (spec.kind) {
      case 'plane':
        return new THREE.PlaneGeometry(x * 2, y * 2);
      case 'box':
        return new THREE.BoxGeometry(x * 2, y * 2, z * 2);
      case 'sphere':
        return new THREE.SphereGeometry(x, 24, 16);
      case 'cylinder':
        return new THREE.CylinderGeometry(x, x, y * 2, 32).rotateX(Math.PI / 2);
      case 'capsule':
        return new THREE.CapsuleGeometry(x, y * 2, 8, 20).rotateX(Math.PI / 2);
      default:
        throw new Error(`Unsupported geometry: ${spec.kind}`);
    }
  }

  load(model: ModelMessage) {
    this.model = model;
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes = model.geoms.map((spec) => {
      let color = new THREE.Color().setRGB(spec.rgba[0], spec.rgba[1], spec.rgba[2]);
      if (spec.kind === 'plane') color = new THREE.Color(0x262527);
      else if (spec.rgba[0] < 0.3 && spec.rgba[2] > 0.8) color = new THREE.Color(0xaab3ba);
      else if (spec.rgba[0] < 0.2 && spec.rgba[1] > 0.6) color = new THREE.Color(0x60cbb7);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.56,
        metalness: spec.kind === 'plane' ? 0 : 0.16,
        transparent: spec.rgba[3] < 1,
        opacity: spec.rgba[3],
      });
      const mesh = new THREE.Mesh(this.geometry(spec), material);
      mesh.castShadow = spec.kind !== 'plane';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    });
    this.resetCamera();
  }

  update(frame: StateMessage) {
    const hidden = new Set(frame.hidden_geoms ?? []);
    frame.positions.forEach((position, i) => {
      const mesh = this.meshes[i];
      if (!mesh) return;
      mesh.visible = !hidden.has(i);
      mesh.position.fromArray(position);
      const r = frame.rotations[i];
      this.matrix.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      mesh.quaternion.setFromRotationMatrix(this.matrix);
    });
  }

  resetCamera() {
    if (this.showcase) {
      this.camera.position.set(0.95, 0.75, 0.86);
      this.orbit.target.set(-0.08, 0.03, 0.25);
    } else if (this.model?.scene === 'arm') {
      this.camera.position.set(0.9, -1.6, 1.8);
      this.orbit.target.set(-0.85, 0.65, 0.6);
    } else {
      this.camera.position.set(2.7, -3.5, 2.9);
      this.orbit.target.set(-0.25, 0, 0.3);
    }
    this.orbit.update();
  }
  dispose() {
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.orbit.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
