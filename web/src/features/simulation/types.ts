export type SceneName = 'lab' | 'arm' | 'car';
export type SimulationScene = SceneName | 'gripper' | 'stacking' | 'sorting';
export interface GeometrySpec {
  kind: 'plane' | 'box' | 'sphere' | 'capsule' | 'cylinder';
  size: [number, number, number];
  rgba: [number, number, number, number];
}
export interface ModelMessage {
  type: 'model';
  scene: SimulationScene;
  geoms: GeometrySpec[];
  arm_limits: [number, number][];
}
export interface StateMessage {
  type: 'state';
  scene: SimulationScene;
  time: number;
  demo: boolean;
  paused: boolean;
  linear: number;
  angular: number;
  positions: number[][];
  rotations: number[][];
  arm_targets: number[];
  gripper: number;
  hidden_geoms?: number[];
  task?: {
    phase: string;
    blocks: number[][];
    stacked?: number;
    cycle?: number;
    sorted?: number;
    retries?: number;
    replans?: number;
    seed?: number;
    batch?: number;
    target?: string | null;
    active?: number[];
    can_add?: boolean;
    can_move?: boolean;
  };
  arm?: { names: string[]; position: number[]; velocity: number[]; end_effector_xyz: number[] };
  car?: { position_xyz: number[]; orientation_wxyz: number[]; wheel_velocity: number[] };
}
export type SimulationMessage = ModelMessage | StateMessage | { type: 'error'; message: string };
export type SimulationCommand =
  | { action: 'scene'; scene: SimulationScene; seed?: number }
  | { action: 'arm'; positions: number[] }
  | { action: 'gripper'; opening: number }
  | { action: 'drive'; linear: number; angular: number }
  | { action: 'demo' | 'pause'; enabled: boolean }
  | { action: 'reset' | 'home' | 'add_block' | 'move_block' };
