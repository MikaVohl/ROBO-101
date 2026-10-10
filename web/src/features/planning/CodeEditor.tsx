import { useEffect, useRef, useState } from 'react';
import ace from 'ace-builds';
import type { Ace } from 'ace-builds';
import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/theme-tomorrow_night';
export function CodeEditor({
  source,
  change,
  visible,
}: {
  source: string;
  change: (source: string) => void;
  visible: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    editor = useRef<Ace.Editor | null>(null);
  const changing = useRef(false),
    sourceRef = useRef(source),
    changeRef = useRef(change);
  sourceRef.current = source;
  changeRef.current = change;
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    let instance: Ace.Editor;
    try {
      instance = ace.edit(container.current!);
    } catch {
      setFallback(true);
      return;
    }
    editor.current = instance;
    instance.setTheme('ace/theme/tomorrow_night');
    instance.session.setMode('ace/mode/python');
    instance.session.setUseWorker(false);
    instance.setOptions({
      fontSize: 13,
      showPrintMargin: false,
      tabSize: 4,
      useSoftTabs: true,
      wrap: true,
      textInputAriaLabel: 'Python solution editor',
    });
    instance.setValue(sourceRef.current, -1);
    instance.textInput.getElement().setAttribute('aria-label', 'Python solution editor');
    const onChange = () => {
      if (!changing.current) changeRef.current(instance.getValue());
    };
    instance.session.on('change', onChange);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      instance.session.off('change', onChange);
      instance.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (instance && instance.getValue() !== source) {
      changing.current = true;
      instance.setValue(source, -1);
      changing.current = false;
    }
  }, [source]);
  useEffect(() => {
    if (visible) editor.current?.resize();
  }, [visible]);
  return (
    <>
      <div ref={container} id="code-editor" aria-label="Python solution editor" hidden={fallback} />
      <textarea
        id="code-fallback"
        aria-label="Python solution editor"
        spellCheck={false}
        value={source}
        onChange={(event) => change(event.target.value)}
        hidden={!fallback}
      />
    </>
  );
}
