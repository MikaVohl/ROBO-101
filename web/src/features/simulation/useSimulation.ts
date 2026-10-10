import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { RobotViewport } from './viewport';
import type { ModelMessage, StateMessage, SimulationMessage, SimulationCommand } from './types';

export function useSimulation(container: RefObject<HTMLDivElement | null>, showcase = false) {
  const socket = useRef<WebSocket | null>(null);
  const viewer = useRef<RobotViewport | null>(null);
  const latest = useRef<StateMessage | null>(null);
  const [model, setModel] = useState<ModelMessage | null>(null);
  const [frame, setFrame] = useState<StateMessage | null>(null);
  const [connection, setConnection] = useState('Connecting…');
  const [error, setError] = useState('');
  const send = useCallback((command: SimulationCommand) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      setError('');
      socket.current.send(JSON.stringify(command));
    }
  }, []);
  const resetCamera = useCallback(() => viewer.current?.resetCamera(), []);

  useEffect(() => {
    if (!container.current) return;
    let display: RobotViewport;
    try {
      display = new RobotViewport(container.current, { showcase });
    } catch {
      setError('Enable WebGL to view the simulation.');
      setConnection('3D view unavailable');
      return;
    }
    viewer.current = display;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let lastUiUpdate = 0;
    const connect = () => {
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        setConnection('Physics connected');
        if (showcase) {
          send({ action: 'scene', scene: 'sorting' });
          send({ action: 'demo', enabled: true });
          if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            send({ action: 'pause', enabled: true });
          }
        }
      };
      ws.onmessage = (event) => {
        if (disposed) return;
        const data = JSON.parse(event.data) as SimulationMessage;
        if (data.type === 'model') {
          display.load(data);
          setModel(data);
        } else if (data.type === 'state') {
          if (showcase && data.scene !== 'sorting') return;
          display.update(data);
          latest.current = data;
          // Render all physics frames, but update React's telemetry at ~10 Hz.
          if (performance.now() - lastUiUpdate > 90) {
            setFrame(data);
            lastUiUpdate = performance.now();
          }
        } else setError(data.message);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnection('Reconnecting…');
        reconnect = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      const ws = socket.current;
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
        else ws.close();
      }
      socket.current = null;
      latest.current = null;
      display.dispose();
      viewer.current = null;
    };
  }, [container, showcase, send]);
  return { model, frame, latest, connection, error, send, resetCamera };
}
